//! Server-side quiescence drain for `runtime.shutdown`
//! (`docs/migration/service-quiescence-contract.md`).
//!
//! Core owns admission: fences, the durable receipt and the
//! `Engine::is_quiescent` flag. This module owns the *server's* half of the
//! contract:
//!
//! - [`QuiesceGate`] is authorized by the connection handler only *after*
//!   the shutdown reply has been written (or the write error has shown
//!   delivery to be uncertain) — never from the core flag alone, which flips
//!   before the reply exists. The accept loop observes the flag at a bounded
//!   poll point between nonblocking accepts; nothing about waking it
//!   depends on reconnecting to a socket pathname.
//! - [`ConnectionRegistry`] tracks every in-flight handler together with a
//!   clone of its transport. Each handler holds an [`ActiveConnection`]
//!   guard that removes its entry (dropping the clone) the moment the
//!   handler exits, so tracking never delays the client-visible close of a
//!   finished connection and one-shot RPCs cannot accumulate descriptors
//!   during normal serving. [`ConnectionRegistry::drain`] shuts down the
//!   transports of handlers still in flight and waits for them with a
//!   bounded deadline, so idle clients cannot hold the service open and the
//!   bound cannot be undone by a stuck `join`.
//!
//! [`ConnectionRegistry`]/[`ActiveConnection`] are generic over [`Transport`]
//! rather than hardcoded to `UnixStream`, so `server.rs`'s accept loop and
//! this drain machinery are written once and instantiated for both the Unix
//! (`UnixStream`) and Windows (`drogond::endpoint::NamedPipeConnection`)
//! transports, instead of duplicating `run_accept_loop_inner`/
//! `connection_loop`/this module per platform.
//!
//! No `process::exit`, no signals, no parsed PIDs: the serving process ends
//! by the accept loop returning, so `drogond::serve` releases the exclusive
//! data-dir lock through the normal drop path.

use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Default interval between quiescence observations when the accept source
/// is nonblocking and has no connection pending (`WouldBlock`). Small enough
/// that an authorized shutdown stops the listener within milliseconds, large
/// enough to keep the idle poll negligible.
pub const DEFAULT_QUIESCENCE_POLL: Duration = Duration::from_millis(5);

/// Default upper bound for disposing active connections after the listener
/// stops. Far below the production idle timeout on purpose: termination must
/// not wait out idle clients, and a handler that somehow ignores its
/// transport teardown must not hold the service open past this.
pub const DEFAULT_DRAIN_TIMEOUT: Duration = Duration::from_secs(5);

/// Set by the handler that served an *admitted* `runtime.shutdown`, once the
/// reply write has been attempted. The accept loop observes this — not the
/// core flag — before stopping, which is what guarantees the reply (or a
/// known delivery failure) precedes the listener stop. The loop observes
/// the flag at its bounded poll point; there is deliberately no
/// pathname-reconnect wake-up (a `connect` can itself block on a full
/// backlog, and a vanished pathname would leave the loop asleep).
#[derive(Clone, Default)]
pub struct QuiesceGate {
    authorized: Arc<AtomicBool>,
}

impl QuiesceGate {
    /// Authorize the listener to stop. Callers must only invoke this after
    /// the shutdown reply write has been attempted.
    pub fn authorize(&self) {
        self.authorized.store(true, Ordering::Release);
    }

    pub fn is_authorized(&self) -> bool {
        self.authorized.load(Ordering::Acquire)
    }
}

/// What the accept loop and this registry need from a transport beyond
/// `Read + Write`: the platform stdlib's inherent methods on `UnixStream`
/// (`set_read_timeout`, `set_write_timeout`, `try_clone`) have no shared std
/// trait covering them, and there is no stdlib type for a Windows named
/// pipe at all. Implemented once per platform (`UnixStream` here,
/// `drogond::endpoint::NamedPipeConnection` under `cfg(windows)`) so
/// `run_accept_loop_inner`/`connection_loop`/[`ConnectionRegistry`] are
/// written once and monomorphized per platform instead of duplicated.
pub trait Transport: Read + Write + Send + 'static {
    fn set_read_timeout(&self, timeout: Option<Duration>) -> std::io::Result<()>;
    fn set_write_timeout(&self, timeout: Option<Duration>) -> std::io::Result<()>;
    fn try_clone(&self) -> std::io::Result<Self>
    where
        Self: Sized;
    /// Permanent transport shutdown, not merely an in-flight unblock: after
    /// this returns, every clone of this transport (including ones already
    /// handed to another thread, e.g. a handler's read/write halves) must
    /// fail its *next* read/write immediately rather than start a new one,
    /// as well as unblock whichever clone is currently blocked in one — so
    /// [`ConnectionRegistry::drain`] does not wait out an idle client's
    /// timeout, and a handler thread that raced the drain cannot serve one
    /// more request on a transport the registry already considers gone.
    /// Mirrors `UnixStream::shutdown(Shutdown::Both)`, which the Unix impl
    /// gets from the OS for free (any clone's read/write on a shut-down
    /// socket fails immediately); the Windows impl (`NamedPipeConnection`,
    /// see its `shared` field and `SharedTransportState` in `endpoint.rs`)
    /// establishes the same guarantee explicitly, since `CancelIoEx` alone
    /// only reaches in-flight operations on handle values it is told about,
    /// not future ones. Callers intentionally ignore any error, matching
    /// existing drain behavior.
    fn shutdown_both(&self);
}

#[cfg(unix)]
impl Transport for std::os::unix::net::UnixStream {
    fn set_read_timeout(&self, timeout: Option<Duration>) -> std::io::Result<()> {
        std::os::unix::net::UnixStream::set_read_timeout(self, timeout)
    }

    fn set_write_timeout(&self, timeout: Option<Duration>) -> std::io::Result<()> {
        std::os::unix::net::UnixStream::set_write_timeout(self, timeout)
    }

    fn try_clone(&self) -> std::io::Result<Self> {
        std::os::unix::net::UnixStream::try_clone(self)
    }

    fn shutdown_both(&self) {
        let _ = std::os::unix::net::UnixStream::shutdown(self, std::net::Shutdown::Both);
    }
}

#[cfg(windows)]
impl Transport for crate::endpoint::NamedPipeConnection {
    fn set_read_timeout(&self, timeout: Option<Duration>) -> std::io::Result<()> {
        crate::endpoint::NamedPipeConnection::set_read_timeout(self, timeout)
    }

    fn set_write_timeout(&self, timeout: Option<Duration>) -> std::io::Result<()> {
        crate::endpoint::NamedPipeConnection::set_write_timeout(self, timeout)
    }

    fn try_clone(&self) -> std::io::Result<Self> {
        crate::endpoint::NamedPipeConnection::try_clone(self)
    }

    fn shutdown_both(&self) {
        crate::endpoint::NamedPipeConnection::shutdown_both(self)
    }
}

struct ConnectionEntry<S> {
    id: usize,
    /// Clone of the handler's transport, used only to tear it down during
    /// drain; the handler's own copy wakes immediately (`shutdown(2)` on
    /// Unix; on Windows, `NamedPipeConnection::shutdown_both` marks the
    /// whole clone group closed and `CancelIoEx`s every live duplicate in
    /// it, not just this entry's own handle — see `SharedTransportState` in
    /// `endpoint.rs`). Dropped when the handler's [`ActiveConnection`] guard
    /// removes the entry, so tracking never holds a finished connection's
    /// client-visible close hostage.
    transport: S,
    finished: Arc<AtomicBool>,
}

/// Every handler thread the accept loop has spawned and not yet observed
/// finished. Entries are removed by the [`ActiveConnection`] guard at the
/// exact moment the handler exits, not later at drain time.
pub struct ConnectionRegistry<S: Transport> {
    next_id: AtomicUsize,
    entries: Mutex<Vec<ConnectionEntry<S>>>,
}

// Written by hand rather than `#[derive(Default)]`: the derive macro adds a
// `S: Default` bound to the generated impl purely because `S` appears
// somewhere in the struct, even though neither field's `Default` actually
// needs it (an empty `Vec` and a zeroed `AtomicUsize` do not need `S:
// Default`) — and no `Transport` impl here provides one.
impl<S: Transport> Default for ConnectionRegistry<S> {
    fn default() -> Self {
        Self {
            next_id: AtomicUsize::new(0),
            entries: Mutex::new(Vec::new()),
        }
    }
}

/// Owned by a handler thread for as long as it serves one connection.
/// Dropping it marks the handler finished and removes the registry entry,
/// releasing the tracking clone of the transport.
pub struct ActiveConnection<S: Transport> {
    id: usize,
    finished: Arc<AtomicBool>,
    registry: Arc<ConnectionRegistry<S>>,
}

impl<S: Transport> Drop for ActiveConnection<S> {
    fn drop(&mut self) {
        self.finished.store(true, Ordering::Release);
        let mut entries = self.registry.entries.lock().unwrap();
        entries.retain(|entry| entry.id != self.id);
    }
}

impl<S: Transport> ConnectionRegistry<S> {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register an in-flight handler. The returned guard must be held by the
    /// handler thread until it exits.
    pub fn register(self: &Arc<Self>, transport: S) -> ActiveConnection<S> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let finished = Arc::new(AtomicBool::new(false));
        self.entries.lock().unwrap().push(ConnectionEntry {
            id,
            transport,
            finished: finished.clone(),
        });
        ActiveConnection {
            id,
            finished,
            registry: Arc::clone(self),
        }
    }

    /// Dispose of all in-flight connections, bounded by `timeout`.
    ///
    /// Every registered transport is shut down first, so handlers blocked
    /// in a read (an idle client) or write unwind promptly instead of
    /// waiting out the idle timeout. Each handler's completion is then
    /// awaited up to the deadline; handlers still running past it are
    /// detached, because a blocking wait would undo the bound. A detached
    /// handler can no longer serve — its transport is shut down and the
    /// listener is already stopped — so it can only unwind.
    pub fn drain(&self, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        let flags: Vec<Arc<AtomicBool>> = {
            let mut entries = self.entries.lock().unwrap();
            let mut flags = Vec::with_capacity(entries.len());
            for entry in entries.drain(..) {
                entry.transport.shutdown_both();
                flags.push(entry.finished);
            }
            flags
        };
        for flag in flags {
            while !flag.load(Ordering::Acquire) {
                if Instant::now() >= deadline {
                    return;
                }
                std::thread::sleep(Duration::from_millis(2));
            }
        }
    }
}
