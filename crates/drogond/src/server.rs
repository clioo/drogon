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

/// First backoff step after a transient accept error; doubled per consecutive
/// error and capped at [`MAX_ACCEPT_BACKOFF`].
pub const DEFAULT_ACCEPT_ERROR_BACKOFF: Duration = Duration::from_millis(10);

/// A listener that keeps failing after this many consecutive transient
/// errors is treated as broken rather than kept in a retry loop forever.
pub const DEFAULT_MAX_CONSECUTIVE_ACCEPT_ERRORS: u32 = 8;

/// Upper bound for the exponential accept backoff.
const MAX_ACCEPT_BACKOFF: Duration = Duration::from_millis(500);

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
) -> std::io::Result<()> {
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
) -> std::io::Result<()> {
    run_accept_loop(
        move || listener.accept().map(|(stream, _)| stream),
        engine,
        token,
        max_connections,
        idle_timeout,
        DEFAULT_ACCEPT_ERROR_BACKOFF,
        DEFAULT_MAX_CONSECUTIVE_ACCEPT_ERRORS,
    )
}

/// The accept loop proper, parameterized by the accept source so tests can
/// inject deterministic transient errors ahead of real connections.
///
/// A transient accept error (fd exhaustion, `ECONNABORTED`, `EINTR`, …) is
/// retried with exponential backoff — but not forever: once more than
/// `max_consecutive_accept_errors` have accumulated without a successful
/// accept, the last error is returned. A fatal listener failure (bad
/// descriptor, invalid argument, non-socket endpoint, …) returns
/// immediately. Either way the error reaches the caller as a real error —
/// an honestly failing service beats a silently dead one.
#[cfg(unix)]
pub fn run_accept_loop(
    mut accept: impl FnMut() -> std::io::Result<UnixStream>,
    engine: Arc<Engine>,
    token: Arc<str>,
    max_connections: usize,
    idle_timeout: Duration,
    accept_error_backoff: Duration,
    max_consecutive_accept_errors: u32,
) -> std::io::Result<()> {
    let active = Arc::new(AtomicUsize::new(0));
    let mut consecutive_errors: u32 = 0;
    loop {
        let stream = match accept() {
            Ok(stream) => {
                consecutive_errors = 0;
                stream
            }
            Err(error) => {
                if is_fatal_accept_error(&error) {
                    return Err(error);
                }
                consecutive_errors += 1;
                if consecutive_errors > max_consecutive_accept_errors {
                    return Err(error);
                }
                let shift = (consecutive_errors - 1).min(6);
                let backoff = accept_error_backoff
                    .saturating_mul(1 << shift)
                    .min(MAX_ACCEPT_BACKOFF);
                std::thread::sleep(backoff);
                continue;
            }
        };
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

/// Fatal means "the listener itself is unusable": a bad descriptor, an
/// invalid argument, or a non-socket/unsupported endpoint. Everything else
/// (including `EMFILE`/`ENFILE` fd exhaustion, `ECONNABORTED`, `EINTR`,
/// `EAGAIN`, and Linux's pending-error `EPROTO` cases) is transient and
/// retried — up to the consecutive-error budget, after which the failure
/// surfaces to the caller.
///
/// Classification uses this host's libc constants rather than a numeric
/// table: errno values differ per platform (ENOTSOCK is 38 on Apple, 88 on
/// Linux GNU; EOPNOTSUPP is 102 on Apple, 95 on Linux GNU), and one
/// platform's fatal value can be another's unrelated errno (45 is ENOTSUP
/// on Apple but EL2NSYNC on Linux).
#[cfg(unix)]
fn is_fatal_accept_error(error: &std::io::Error) -> bool {
    let Some(code) = error.raw_os_error() else {
        // No OS errno behind this error (a synthesized/kind-only failure):
        // nothing says the listener itself is unusable.
        return false;
    };
    code == libc::EBADF
        || code == libc::EINVAL
        || code == libc::ENOTSOCK
        || code == libc::ENOTSUP
        || code == libc::EOPNOTSUPP
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

#[cfg(all(test, unix))]
mod tests {
    use super::is_fatal_accept_error;

    #[test]
    fn fatal_accept_classification_uses_host_errno_constants() {
        // The fatal set must be expressed with this host's libc constants,
        // never hand-picked numbers: the same errno name has different
        // values per platform (ENOTSOCK is 38 on Apple, 88 on Linux GNU;
        // EOPNOTSUPP is 102 on Apple, 95 on Linux GNU), and one platform's
        // value can be another platform's unrelated errno (45 is ENOTSUP on
        // Apple but EL2NSYNC on Linux).
        for code in [
            libc::EBADF,
            libc::EINVAL,
            libc::ENOTSOCK,
            libc::ENOTSUP,
            libc::EOPNOTSUPP,
        ] {
            assert!(
                is_fatal_accept_error(&std::io::Error::from_raw_os_error(code)),
                "errno {code} must classify as fatal on this host"
            );
        }
    }

    #[test]
    fn transient_accept_classification_stays_retryable() {
        for code in [
            libc::EINTR,
            libc::EAGAIN,
            libc::EMFILE,
            libc::ENFILE,
            libc::ENOBUFS,
            libc::ECONNABORTED,
        ] {
            assert!(
                !is_fatal_accept_error(&std::io::Error::from_raw_os_error(code)),
                "errno {code} must classify as transient on this host"
            );
        }
        // A kind-only error (no raw OS code) is never classified fatal.
        assert!(!is_fatal_accept_error(&std::io::Error::new(
            std::io::ErrorKind::ConnectionAborted,
            "injected abort"
        )));
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
