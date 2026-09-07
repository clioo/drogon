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
#[cfg(unix)]
use crate::service_quiescence::{
    ConnectionRegistry, DEFAULT_DRAIN_TIMEOUT, DEFAULT_QUIESCENCE_POLL, QuiesceGate,
};

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
///
/// This is the production entry: the listener is polled nonblocking with a
/// bounded interval, and an admitted `runtime.shutdown` is observed at that
/// poll point (see `run_accept_loop_inner`). Accepted streams are put back
/// to blocking mode — handlers use blocking read/write deadlines, and a
/// paused client must not look like a transport error to its handler.
#[cfg(unix)]
pub fn accept_loop_with_limits(
    listener: std::os::unix::net::UnixListener,
    engine: Arc<Engine>,
    token: Arc<str>,
    max_connections: usize,
    idle_timeout: Duration,
) -> std::io::Result<()> {
    listener.set_nonblocking(true)?;
    run_accept_loop_inner(
        move || {
            let (stream, _) = listener.accept()?;
            stream.set_nonblocking(false)?;
            Ok(stream)
        },
        engine,
        token,
        QuiesceGate::default(),
        AcceptLoopConfig {
            max_connections,
            idle_timeout,
            accept_error_backoff: DEFAULT_ACCEPT_ERROR_BACKOFF,
            max_consecutive_accept_errors: DEFAULT_MAX_CONSECUTIVE_ACCEPT_ERRORS,
            // The production accept source is nonblocking: an empty queue
            // (`WouldBlock`) is the idle poll point, never an error.
            poll_on_would_block: true,
            quiescence_poll: DEFAULT_QUIESCENCE_POLL,
            drain_timeout: DEFAULT_DRAIN_TIMEOUT,
        },
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
/// An admitted shutdown instead drains connections and returns `Ok(())`
/// after its reply write is attempted; callers must allow this normal exit.
#[cfg(unix)]
pub fn run_accept_loop(
    accept: impl FnMut() -> std::io::Result<UnixStream>,
    engine: Arc<Engine>,
    token: Arc<str>,
    max_connections: usize,
    idle_timeout: Duration,
    accept_error_backoff: Duration,
    max_consecutive_accept_errors: u32,
) -> std::io::Result<()> {
    run_accept_loop_inner(
        accept,
        engine,
        token,
        QuiesceGate::default(),
        AcceptLoopConfig {
            max_connections,
            idle_timeout,
            accept_error_backoff,
            max_consecutive_accept_errors,
            // Injected accept sources keep the exact pre-quiescence error
            // contract: a `WouldBlock` they return is an ordinary transient
            // error and consumes the budget like any other.
            poll_on_would_block: false,
            quiescence_poll: DEFAULT_QUIESCENCE_POLL,
            drain_timeout: DEFAULT_DRAIN_TIMEOUT,
        },
    )
}

/// Tuning bundle for the accept loop; see the constants each field falls
/// back to in `accept_loop_with_limits` and `run_accept_loop`.
#[cfg(unix)]
#[derive(Clone, Copy)]
struct AcceptLoopConfig {
    max_connections: usize,
    idle_timeout: Duration,
    accept_error_backoff: Duration,
    max_consecutive_accept_errors: u32,
    /// Whether a `WouldBlock` from the accept source means "no connection
    /// pending" (production nonblocking listener) or is an ordinary
    /// transient error (injected sources, preserving their public budget
    /// semantics byte for byte).
    poll_on_would_block: bool,
    quiescence_poll: Duration,
    drain_timeout: Duration,
}

/// The quiescence-aware loop. Everything documented on `run_accept_loop`
/// still holds; additionally:
///
/// - Before each `accept`, an authorized [`QuiesceGate`] ends the loop: the
///   gate is set by the handler that served an admitted
///   `runtime.shutdown`, only after the reply write was attempted, so the
///   listener never stops on the core flag alone (which flips before the
///   reply exists).
/// - A `WouldBlock` from the *production* nonblocking accept source is not
///   an accept failure: it means no connection is pending, and the loop
///   sleeps `quiescence_poll` and re-checks the gate — the bounded wake
///   mechanism, which never consumes the transient-error budget and never
///   reconnects to a socket pathname. Injected accept sources
///   (`run_accept_loop`) keep the exact pre-quiescence error contract for
///   every error they return, including `WouldBlock`.
/// - On exit through the gate, [`ConnectionRegistry::drain`] disposes active
///   connections within `drain_timeout` and the loop returns `Ok(())`, so
///   the caller (`drogond::serve`) releases the exclusive data-dir lock
///   through the normal drop path. Fatal and budget-exhausted accept errors
///   still return their original error unchanged; a fatal error mid-service
///   keeps its existing meaning and does not drain.
#[cfg(unix)]
fn run_accept_loop_inner(
    mut accept: impl FnMut() -> std::io::Result<UnixStream>,
    engine: Arc<Engine>,
    token: Arc<str>,
    gate: QuiesceGate,
    config: AcceptLoopConfig,
) -> std::io::Result<()> {
    let AcceptLoopConfig {
        max_connections,
        idle_timeout,
        accept_error_backoff,
        max_consecutive_accept_errors,
        poll_on_would_block,
        quiescence_poll,
        drain_timeout,
    } = config;
    let registry = Arc::new(ConnectionRegistry::new());
    let active = Arc::new(AtomicUsize::new(0));
    let mut consecutive_errors: u32 = 0;
    loop {
        if gate.is_authorized() {
            // Shutdown was admitted and its reply already attempted: stop
            // accepting and dispose of live connections, bounded.
            break;
        }
        let stream = match accept() {
            Ok(stream) => {
                consecutive_errors = 0;
                stream
            }
            Err(error) => {
                // Only the production nonblocking accept source reaches
                // this arm with no connection pending; it is the quiescence
                // poll point, not a failure, and never burns the budget.
                // Injected sources keep the pre-quiescence contract, where
                // a `WouldBlock` is an ordinary transient error.
                if poll_on_would_block && error.kind() == std::io::ErrorKind::WouldBlock {
                    std::thread::sleep(quiescence_poll);
                    continue;
                }
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
        // A client can race with the admission: once draining starts, never
        // hand a late-arriving connection to a handler.
        if gate.is_authorized() {
            drop(stream);
            break;
        }
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
        // Never admit a handler whose transport cannot be drained.
        let registered = match stream.try_clone() {
            Ok(registered) => registered,
            Err(_) => {
                active.fetch_sub(1, Ordering::SeqCst);
                continue;
            }
        };
        let registration = registry.register(registered);
        let engine = engine.clone();
        let token = token.clone();
        let active = active.clone();
        let gate = gate.clone();
        std::thread::spawn(move || {
            let _registration = registration;
            let _ = connection_loop(stream, &engine, &token, idle_timeout, Some(&gate));
            active.fetch_sub(1, Ordering::SeqCst);
        });
    }
    registry.drain(drain_timeout);
    Ok(())
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
    connection_loop(stream, engine, token, idle_timeout, None)
}

/// One connection, one dispatch per frame. With a `gate` (the accept loop's
/// tracked handlers), a frame whose dispatch is an *admitted*
/// `runtime.shutdown` authorizes the gate after the reply write is
/// attempted — success, or an error that proves delivery uncertain — and
/// ends this connection: the service is draining, so nothing further may be
/// served here. Refused shutdowns (busy, stale, unauthorized) are ordinary
/// responses and the connection stays open.
#[cfg(unix)]
fn connection_loop(
    stream: UnixStream,
    engine: &Engine,
    token: &str,
    idle_timeout: Duration,
    gate: Option<&QuiesceGate>,
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
        let (response, admitted_shutdown) = match parse_request(&frame) {
            Ok(request) => {
                let is_shutdown = request.method == "runtime.shutdown";
                let response = dispatch_request(request, engine, token);
                let admitted = response.ok;
                (response, is_shutdown && admitted)
            }
            Err(response) => (response, false),
        };
        let write_result = write_response(&mut writer, &response);
        if let (Some(gate), true) = (gate, admitted_shutdown) {
            // Core persisted the admission before it returned this success,
            // and the reply has now been written or its delivery is known to
            // have failed — either satisfies the contract's ordering before
            // the listener may stop.
            gate.authorize();
            return Ok(());
        }
        write_result?;
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

fn parse_request(frame: &[u8]) -> Result<Request, Response> {
    serde_json::from_slice(frame).map_err(|_| {
        // No parsed requestId to correlate an error response to;
        // synthesize one so the wire contract ("one request gets one
        // response") still holds for a caller who at least sent a
        // frame, even if this reply cannot be matched to anything.
        Response::failure(
            "unknown".to_string(),
            RpcError::new(
                "invalid_argument",
                "frame did not parse as a request envelope",
            ),
        )
    })
}

// Non-matching `auth` is resolved as a worker dispatch credential before any
// ledger/effect touch; see `Engine::dispatch_authenticated`.
fn dispatch_request(request: Request, engine: &Engine, token: &str) -> Response {
    engine.dispatch_authenticated(request, token)
}
