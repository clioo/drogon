//! Local IPC transport: one connection per request, bounded frames, bounded
//! total time. Transport loss is `unverifiable` — never `exited`, never a
//! retry, and never a daemon launch.

use std::io;
use std::task::{Context, Poll};
use std::time::Duration;

use drogon_protocol::MAX_FRAME_BYTES;
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt, ReadBuf};

use crate::error::{CliError, invalid_argument, unverifiable};
use crate::paths::Endpoint;
use crate::wire;

/// Default bounded wait for a whole connect+write+read round trip.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
/// One local-model analysis can legitimately take minutes; the daemon kills
/// its own run at 240 s, so the client waits past that and reports the
/// daemon's own verdict rather than a client-side timeout of its own.
pub const ANALYSIS_TIMEOUT: Duration = Duration::from_secs(300);

/// Sends one request frame and waits for exactly one response frame.
/// Every local failure (connect, write, read, timeout, protocol) carries the
/// original request id so an ambiguous mutation stays replayable via
/// `--request-id`.
pub async fn roundtrip(
    endpoint: &Endpoint,
    auth_token: &str,
    method: &str,
    params: Value,
    request_id: &str,
    timeout: Duration,
) -> Result<wire::OkResponse, CliError> {
    let frame = wire::build_frame(request_id, auth_token, method, &params)?;
    let future = async {
        let mut stream = connect(endpoint, request_id).await?;
        stream.write_all(&frame).await.map_err(|err| {
            transport_loss(
                endpoint,
                request_id,
                format!("failed writing request: {err}"),
            )
        })?;
        stream.flush().await.map_err(|err| {
            transport_loss(
                endpoint,
                request_id,
                format!("failed writing request: {err}"),
            )
        })?;
        let response_frame = read_bounded_line(stream, MAX_FRAME_BYTES).await;
        match response_frame {
            Ok(frame) => wire::parse_response(&frame, request_id),
            Err(FrameError::TooLarge(limit)) => Err(CliError::local(
                invalid_argument(format!(
                    "response from {} exceeds the {limit}-byte protocol limit",
                    endpoint.describe()
                )),
                request_id,
            )),
            Err(FrameError::ConnectionClosed) => Err(transport_loss(
                endpoint,
                request_id,
                "service closed the connection before sending a complete response",
            )),
            Err(FrameError::Io(err)) => Err(transport_loss(
                endpoint,
                request_id,
                format!("failed reading response: {err}"),
            )),
        }
    };
    match tokio::time::timeout(timeout, future).await {
        Ok(result) => result,
        Err(_) => Err(transport_loss(
            endpoint,
            request_id,
            format!(
                "timed out after {}ms waiting for a response",
                timeout.as_millis()
            ),
        )),
    }
}

async fn connect(endpoint: &Endpoint, request_id: &str) -> Result<EndpointStream, CliError> {
    match endpoint {
        #[cfg(unix)]
        Endpoint::UnixSocket(path) => match tokio::net::UnixStream::connect(path).await {
            Ok(stream) => Ok(EndpointStream::Unix(stream)),
            Err(err) => Err(transport_loss(
                endpoint,
                request_id,
                format!("cannot connect: {err}"),
            )),
        },
        #[cfg(windows)]
        Endpoint::NamedPipe(name) => {
            match tokio::net::windows::named_pipe::ClientOptions::new().open(name) {
                Ok(client) => Ok(EndpointStream::Pipe(client)),
                Err(err) => Err(transport_loss(
                    endpoint,
                    request_id,
                    format!("cannot connect: {err}"),
                )),
            }
        }
    }
}

enum EndpointStream {
    #[cfg(unix)]
    Unix(tokio::net::UnixStream),
    #[cfg(windows)]
    Pipe(tokio::net::windows::named_pipe::NamedPipeClient),
}

impl AsyncRead for EndpointStream {
    fn poll_read(
        self: std::pin::Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        match self.get_mut() {
            #[cfg(unix)]
            EndpointStream::Unix(stream) => std::pin::Pin::new(stream).poll_read(cx, buf),
            #[cfg(windows)]
            EndpointStream::Pipe(pipe) => std::pin::Pin::new(pipe).poll_read(cx, buf),
        }
    }
}

impl EndpointStream {
    async fn write_all(&mut self, frame: &[u8]) -> io::Result<()> {
        match self {
            #[cfg(unix)]
            EndpointStream::Unix(stream) => AsyncWriteExt::write_all(stream, frame).await,
            #[cfg(windows)]
            EndpointStream::Pipe(pipe) => AsyncWriteExt::write_all(pipe, frame).await,
        }
    }

    async fn flush(&mut self) -> io::Result<()> {
        match self {
            #[cfg(unix)]
            EndpointStream::Unix(stream) => AsyncWriteExt::flush(stream).await,
            #[cfg(windows)]
            EndpointStream::Pipe(pipe) => AsyncWriteExt::flush(pipe).await,
        }
    }
}

#[derive(Debug)]
enum FrameError {
    TooLarge(usize),
    ConnectionClosed,
    Io(io::Error),
}

/// Reads one newline-terminated frame without ever buffering more than
/// `limit` bytes (plus one fixed chunk) — allocation stays bounded even when
/// a broken peer streams megabytes without a newline.
async fn read_bounded_line<R: AsyncRead + Unpin>(
    reader: R,
    limit: usize,
) -> Result<Vec<u8>, FrameError> {
    let mut reader = reader;
    let mut buffer: Vec<u8> = Vec::with_capacity(4096);
    let mut chunk = [0u8; 8192];
    loop {
        let read = reader.read(&mut chunk).await.map_err(FrameError::Io)?;
        if read == 0 {
            return Err(FrameError::ConnectionClosed);
        }
        if let Some(newline) = chunk[..read].iter().position(|byte| *byte == b'\n') {
            buffer.extend_from_slice(&chunk[..newline]);
            if buffer.len() > limit {
                return Err(FrameError::TooLarge(limit));
            }
            // One request, one response: bytes after the first newline are
            // irrelevant because the connection is dropped right after.
            return Ok(buffer);
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > limit {
            return Err(FrameError::TooLarge(limit));
        }
    }
}

fn transport_loss(endpoint: &Endpoint, request_id: &str, detail: impl Into<String>) -> CliError {
    CliError::local(
        unverifiable(format!("{}: {}", endpoint.describe(), detail.into())),
        request_id,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_all(bytes: &[u8]) -> Result<Vec<u8>, FrameError> {
        // Block the runtime for the duration of a pure in-memory read.
        futures_block(read_bounded_line(bytes, MAX_FRAME_BYTES))
    }

    fn futures_block<F: std::future::Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap()
            .block_on(future)
    }

    #[test]
    fn complete_line_is_returned_without_trailing_newline() {
        let frame = read_all(b"{\"ok\":true}\n").unwrap();
        assert_eq!(frame, b"{\"ok\":true}");
    }

    #[test]
    fn newlineless_flood_hits_the_limit_without_unbounded_allocation() {
        let flood = vec![b'x'; MAX_FRAME_BYTES + 64 * 1024];
        match read_all(&flood) {
            Err(FrameError::TooLarge(limit)) => assert_eq!(limit, MAX_FRAME_BYTES),
            other => panic!("expected TooLarge, got {other:?}"),
        }
    }

    #[test]
    fn peer_close_without_newline_is_a_distinct_error() {
        match read_all(b"partial response") {
            Err(FrameError::ConnectionClosed) => {}
            other => panic!("expected ConnectionClosed, got {other:?}"),
        }
    }

    #[test]
    fn empty_response_is_connection_closed() {
        match read_all(b"") {
            Err(FrameError::ConnectionClosed) => {}
            other => panic!("expected ConnectionClosed, got {other:?}"),
        }
    }

    #[test]
    fn frame_exactly_at_limit_is_accepted() {
        let mut bytes = vec![b'a'; MAX_FRAME_BYTES - 1];
        bytes.push(b'\n');
        let frame = read_all(&bytes).unwrap();
        assert_eq!(frame.len(), MAX_FRAME_BYTES - 1);
    }
}
