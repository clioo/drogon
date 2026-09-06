//! Connection handling: one thread per client, one dispatch per frame.
//! Closing/reloading a client (dropping the socket) must not touch any
//! session — that invariant lives entirely in `drogon_core::Engine`, which
//! never hears about a disconnect at all; this module only stops reading.

use std::io::BufReader;
#[cfg(unix)]
use std::os::unix::net::UnixStream;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use drogon_core::Engine;
use drogon_protocol::{Request, Response, RpcError};

use crate::framing::{read_frame, write_response};

/// Local IPC on a single-user data directory has no legitimate reason to
/// need more concurrent connections than this.
pub const DEFAULT_MAX_CONCURRENT_CONNECTIONS: usize = 64;

/// A connection that sends nothing at all for this long is dropped. This
/// bounds "a client opens connections and never sends anything" to a slot
/// held for at most this long, rather than permanently — a cap on
/// concurrent connections alone does not free a slot no one is using.
/// Generous on purpose: a real interactive client can sit idle between
/// keystrokes for a long time and must not be disconnected for that.
pub const DEFAULT_IDLE_TIMEOUT: Duration = Duration::from_secs(600);

#[cfg(unix)]
pub fn accept_loop(
    listener: std::os::unix::net::UnixListener,
    engine: Arc<Engine>,
    token: Arc<str>,
) {
    accept_loop_with_limits(
        listener,
        engine,
        token,
        DEFAULT_MAX_CONCURRENT_CONNECTIONS,
        DEFAULT_IDLE_TIMEOUT,
    )
}

/// Same as `accept_loop`, with the connection cap and idle deadline exposed
/// so tests can exercise real exhaustion-then-recovery behavior in
/// milliseconds instead of at production timescales.
#[cfg(unix)]
pub fn accept_loop_with_limits(
    listener: std::os::unix::net::UnixListener,
    engine: Arc<Engine>,
    token: Arc<str>,
    max_connections: usize,
    idle_timeout: Duration,
) {
    let active = Arc::new(AtomicUsize::new(0));
    for incoming in listener.incoming() {
        let Ok(stream) = incoming else { break };
        if active.fetch_add(1, Ordering::SeqCst) >= max_connections {
            active.fetch_sub(1, Ordering::SeqCst);
            // Why not send an error frame: an over-capacity connection has
            // no auth/frame exchange yet to answer within, and holding the
            // slot even briefly to write one defeats the cap. The client
            // sees an immediate close, which is distinguishable from a
            // hung server.
            drop(stream);
            continue;
        }
        let engine = engine.clone();
        let token = token.clone();
        let active = active.clone();
        std::thread::spawn(move || {
            let _ = handle_connection(stream, &engine, &token, idle_timeout);
            active.fetch_sub(1, Ordering::SeqCst);
        });
    }
}

#[cfg(unix)]
pub fn handle_connection(
    stream: UnixStream,
    engine: &Engine,
    token: &str,
    idle_timeout: Duration,
) -> std::io::Result<()> {
    stream.set_read_timeout(Some(idle_timeout))?;
    stream.set_write_timeout(Some(idle_timeout))?;
    let write_stream = stream.try_clone()?;
    let mut writer = write_stream;
    let mut reader = BufReader::new(stream);
    loop {
        let frame = match read_frame(&mut reader) {
            Ok(Some(frame)) => frame,
            Ok(None) => return Ok(()),
            // Covers three distinct causes identically: a garbled/oversized
            // frame (see framing.rs), an idle timeout with nothing sent
            // (`WouldBlock`/`TimedOut`), and any other transport error.
            // None has a requestId to answer against, so the connection
            // (and only this connection) is simply closed; no session
            // state is touched either way.
            Err(_) => return Ok(()),
        };
        let response = dispatch_frame(&frame, engine, token);
        write_response(&mut writer, &response)?;
    }
}

fn dispatch_frame(frame: &[u8], engine: &Engine, token: &str) -> Response {
    let request: Request = match serde_json::from_slice(frame) {
        Ok(request) => request,
        Err(_) => {
            // No parsed requestId to correlate an error response to;
            // synthesize one so the wire contract ("one request gets one
            // response") still holds for a caller who at least sent a
            // frame, even if this reply cannot be matched to anything.
            return Response::failure(
                "unknown".to_string(),
                RpcError::new(
                    "invalid_argument",
                    "frame did not parse as a request envelope",
                ),
            );
        }
    };
    if request.auth.as_deref() != Some(token) {
        return Response::failure(
            request.request_id,
            RpcError::new("unauthorized", "missing or invalid auth token"),
        );
    }
    engine.dispatch(request)
}
