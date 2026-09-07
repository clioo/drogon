//! Native-IPC endpoint ownership. Ports the invariants documented in the
//! prior implementation's `daemon/AGENTS.md` (see `inventory-core.md` §1.2):
//! bind a private scratch name, hand it to the canonical path, and only
//! replace an incumbent this process has itself proven dead by connecting to
//! it. Never destroy-then-recreate blind. Never treat an ambiguous probe as
//! death. No sweeper — a departing daemon's name is either torn down by the
//! OS (Windows named pipes) or left in place for the next process to prove
//! dead (Unix sockets).
//!
//! Unix sockets (`establish`, below) and Windows named pipes
//! (`establish`, under `cfg(windows)`) are different mechanisms with
//! different failure shapes; each gets its own implementation rather than a
//! shared abstraction that would blur the platform-specific proof-of-death
//! rules. `lib.rs` now declares this module unconditionally (its own
//! internal `cfg(unix)`/`cfg(windows)` gates below decide what actually
//! compiles per platform); see
//! `docs/migration/verticals/V1/windows-transport-evidence.md`'s Completion
//! section for what is real versus still a design sketch on the Windows
//! side.

use std::path::Path;

use sha2::{Digest, Sha256};

/// `\\.\pipe\drogon-v1-<first 24 lowercase hex SHA256 of canonical
/// data-directory UTF-8 path>`, matching the frozen contract also
/// implemented independently by `drogon-cli::paths::windows_pipe_name`
/// (identical algorithm, same `sha2` crate call, same hex-encode-and-slice
/// tail — still duplicated rather than shared, since `drogond` cannot
/// depend on `drogon-cli` directly (crate-graph direction); see the
/// evidence doc's Completion section for the consolidation note).
pub fn windows_pipe_name(canonical_data_dir: &str) -> String {
    let digest = Sha256::digest(canonical_data_dir.as_bytes());
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    format!("\\\\.\\pipe\\drogon-v1-{}", &hex[..24])
}

/// Strips the verbatim-path marker Windows `canonicalize` adds, so the hash
/// input matches how a caller would spell the path themselves rather than
/// its internal verbatim form.
///
/// The naive `strip_prefix(r"\\?\")` this replaced is wrong for a verbatim
/// UNC path: `canonicalize` renders `\\server\share\dir` as
/// `\\?\UNC\server\share\dir`, and stripping only the literal 4-character
/// `\\?\` marker leaves `UNC\server\share\dir` — a path with a bare `UNC\`
/// segment and no leading `\\`, which is not a path any of the CLI, the
/// daemon or the TS client would ever independently produce from the same
/// input directory. That single-character-class bug would make the daemon
/// and the CLI hash the *same* UNC-reachable data directory to *different*
/// pipe names, so neither could ever find the other. The verbatim-UNC form
/// must instead collapse back to a plain UNC path (`\\server\share\dir`);
/// only the plain local-drive verbatim form (`\\?\C:\...`) is a simple
/// prefix strip.
fn strip_verbatim_prefix(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = path.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        path.to_string()
    }
}

/// Canonical UTF-8 form of the data directory used as the pipe-name hash
/// input. Falls back to the literal path when the directory does not exist
/// yet. Lossy (`to_string_lossy`, replacing unpaired UTF-16 surrogates with
/// U+FFFD) and case-preserving (no `to_lowercase`/`to_uppercase` anywhere in
/// this function) by deliberate agreement with the TS client's
/// `resolveEndpointPath`, which hashes a `realpath`-resolved directory
/// string under Node's default (also-lossy) UTF-8 string encoding without
/// any casing normalization either — see the evidence doc's Rework section
/// for the exact citation. Neither side may start lowercasing or
/// re-encoding without the other changing in lockstep, or the two will hash
/// the same directory to different pipe names.
#[cfg_attr(not(windows), allow(dead_code))]
fn canonical_for_hash(data_dir: &Path) -> String {
    let canonical = std::fs::canonicalize(data_dir).unwrap_or_else(|_| data_dir.to_path_buf());
    strip_verbatim_prefix(&canonical.to_string_lossy())
}

#[cfg(unix)]
mod unix {
    use std::io;
    use std::os::unix::fs::FileTypeExt;
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    pub const SOCKET_FILE_NAME: &str = "runtime-v1.sock";

    enum Liveness {
        Live,
        Dead,
        Unknown,
    }

    /// Refuses to treat a symlink or a non-socket file at the canonical path as
    /// an incumbent to probe at all — connecting to (or worse, later renaming
    /// over) a planted regular file or a symlink pointing outside the data
    /// directory is never safe, regardless of what `connect` would report.
    fn reject_unsafe_incumbent(canonical: &Path) -> io::Result<()> {
        let meta = match std::fs::symlink_metadata(canonical) {
            Ok(meta) => meta,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e),
        };
        let file_type = meta.file_type();
        if file_type.is_symlink() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "refusing a symlink at the canonical socket path",
            ));
        }
        if !file_type.is_socket() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "refusing a non-socket file at the canonical socket path",
            ));
        }
        Ok(())
    }

    fn probe(canonical: &Path) -> Liveness {
        match UnixStream::connect(canonical) {
            Ok(_stream) => Liveness::Live,
            Err(e) => match e.kind() {
                io::ErrorKind::ConnectionRefused | io::ErrorKind::NotFound => Liveness::Dead,
                // Why: permission errors, "would block" and anything else are
                // not evidence of death. Collapsing "can't tell" into "dead" is
                // the exact defect class the source design fixed after 23
                // documented incidents (`inventory-core.md` §1.2).
                _ => Liveness::Unknown,
            },
        }
    }

    fn scratch_name() -> String {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        format!(".p{:x}{:x}", std::process::id(), nanos)
    }

    /// Binds this process onto the data directory's canonical socket path,
    /// refusing if a live (or unprovably-dead) incumbent already holds it.
    pub fn establish(data_dir: &Path) -> io::Result<UnixListener> {
        let canonical = data_dir.join(SOCKET_FILE_NAME);
        reject_unsafe_incumbent(&canonical)?;
        let scratch: PathBuf = data_dir.join(scratch_name());
        let _ = std::fs::remove_file(&scratch);
        let listener = UnixListener::bind(&scratch)?;
        // Why here and not after linking: the scratch and canonical names share
        // one inode once linked, so setting the mode once, before the link,
        // covers both — `protocol-v1.md` requires the socket be restricted to
        // the owning user, matching the data directory (0700) and token (0600).
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&scratch, std::fs::Permissions::from_mode(0o600))?;
        }

        match std::fs::hard_link(&scratch, &canonical) {
            Ok(()) => {
                // The canonical name now has its own directory entry pointing
                // at the same listening socket; the scratch name is no longer
                // needed. This never touches a name we did not just create.
                let _ = std::fs::remove_file(&scratch);
                Ok(listener)
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                let refuse = |listener: UnixListener| -> io::Result<UnixListener> {
                    let _ = std::fs::remove_file(&scratch);
                    drop(listener);
                    Err(io::Error::new(
                        io::ErrorKind::AddrInUse,
                        "a live (or unprovably dead) drogond already owns this data directory",
                    ))
                };
                match probe(&canonical) {
                    Liveness::Live | Liveness::Unknown => refuse(listener),
                    Liveness::Dead => {
                        // Probe once more immediately before acting, matching
                        // the source protocol's re-check step — ownership may
                        // have changed hands between the first probe and here.
                        match probe(&canonical) {
                            Liveness::Dead => {
                                std::fs::rename(&scratch, &canonical)?;
                                Ok(listener)
                            }
                            _ => refuse(listener),
                        }
                    }
                }
            }
            Err(e) => {
                let _ = std::fs::remove_file(&scratch);
                Err(e)
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn first_process_owns_a_fresh_directory() {
            let dir = tempfile::tempdir().unwrap();
            let listener = establish(dir.path()).unwrap();
            assert!(dir.path().join(SOCKET_FILE_NAME).exists());
            drop(listener);
        }

        #[test]
        fn a_live_incumbent_refuses_a_second_owner() {
            let dir = tempfile::tempdir().unwrap();
            let first = establish(dir.path()).unwrap();
            let second = establish(dir.path());
            assert!(
                second.is_err(),
                "must refuse while the first listener is alive"
            );
            drop(first);
        }

        #[test]
        fn a_dead_incumbents_name_is_reclaimed() {
            let dir = tempfile::tempdir().unwrap();
            let first = establish(dir.path()).unwrap();
            drop(first); // socket file remains on disk with no listener behind it
            let second = establish(dir.path());
            assert!(
                second.is_ok(),
                "a provably dead incumbent's name must be reclaimable"
            );
        }
    }
}

#[cfg(unix)]
pub use unix::{SOCKET_FILE_NAME, establish};

/// Windows named-pipe transport, real listener/connection API. Rewritten
/// under the root grant to use `windows-sys` bindings (verified against the
/// installed `windows-sys-0.61.2` source tree, not memory — see the
/// evidence doc's Completion section for the exact feature list) instead of
/// hand-rolled `extern "system"` declarations, everywhere `windows-sys` has
/// a matching declaration. `windows-sys` is **not yet a dependency of
/// `drogond`** — this vertical cannot edit `Cargo.toml` — so this module
/// still cannot compile on any host until root adds it; see the evidence
/// doc for the exact blocking Cargo line. Because this entire module is
/// `#[cfg(windows)]`, that is not a problem for *this* build: cfg-stripping
/// removes it before name resolution, so `use windows_sys::...` here never
/// needs the crate to exist for `cargo build --locked` to stay green on
/// this (Unix) host. Nothing below has been compiled by any Rust toolchain;
/// see the evidence doc for exactly which parts are still a design sketch
/// rather than a verified implementation.
///
/// Still hand-written, not moved to `windows-sys` (nothing there could
/// replace them; they are this crate's own logic sitting on top of the raw
/// bindings, not FFI declarations): the same-user SDDL string, the
/// `SecurityDescriptorGuard` RAII wrapper around `LocalFree`, and the
/// `to_wide` UTF-16 helper. No other hand-written FFI was added.
#[cfg(windows)]
mod windows_pipe {
    use std::cell::Cell;
    use std::ffi::c_void;
    use std::io::{self, Read, Write};
    use std::path::Path;
    use std::time::Duration;

    use windows_sys::Win32::Foundation::{
        CloseHandle, DUPLICATE_SAME_ACCESS, DuplicateHandle, ERROR_ACCESS_DENIED,
        ERROR_FILE_NOT_FOUND, ERROR_IO_PENDING, ERROR_PIPE_CONNECTED, FALSE, GENERIC_READ,
        GENERIC_WRITE, GetLastError, HANDLE, INVALID_HANDLE_VALUE, LocalFree, TRUE, WAIT_OBJECT_0,
        WAIT_TIMEOUT,
    };
    use windows_sys::Win32::Security::Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW;
    use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAG_OVERLAPPED, OPEN_EXISTING,
        PIPE_ACCESS_DUPLEX, ReadFile, WriteFile,
    };
    use windows_sys::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};
    use windows_sys::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, PIPE_READMODE_BYTE,
        PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
    };
    use windows_sys::Win32::System::Threading::{
        CreateEventW, GetCurrentProcess, INFINITE, WaitForSingleObject,
    };

    /// Same-user pipe DACL. Protected (`P`, no inherited ACEs), Generic-All to
    /// the pipe's Owner (the creating process's user) and to Local System.
    /// Passing `NULL` security attributes instead would use CreateNamedPipeW's
    /// *default* descriptor, which Microsoft documents as granting read access
    /// to the Everyone group and the anonymous account — the opposite of
    /// same-user. Built via `ConvertStringSecurityDescriptorToSecurityDescriptorW`
    /// rather than manual SID/ACL construction, to keep the unverified
    /// surface area small. Kept hand-written (not a `windows-sys` type):
    /// it is data this crate owns, not an FFI declaration.
    const SAME_USER_SDDL: &str = "D:P(A;;GA;;;OW)(A;;GA;;;SY)";

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    struct SecurityDescriptorGuard(*mut c_void);

    impl Drop for SecurityDescriptorGuard {
        fn drop(&mut self) {
            // Safety: `0` was returned by `ConvertStringSecurityDescriptorToSecurityDescriptorW`,
            // which per its contract must be released with `LocalFree`.
            unsafe {
                LocalFree(self.0);
            }
        }
    }

    fn same_user_security_attributes() -> io::Result<(SECURITY_ATTRIBUTES, SecurityDescriptorGuard)>
    {
        let sddl = to_wide(SAME_USER_SDDL);
        let mut sd: *mut c_void = std::ptr::null_mut();
        // Safety: `sddl` is a NUL-terminated wide string alive for the call;
        // `sd` is an out-param the API fills on success.
        let ok = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                1,
                &mut sd,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        let guard = SecurityDescriptorGuard(sd);
        let attrs = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: sd,
            bInheritHandle: 0,
        };
        Ok((attrs, guard))
    }

    /// Creates one instance of `pipe_name`. `first` selects
    /// `FILE_FLAG_FIRST_PIPE_INSTANCE`, the atomic "does any instance of
    /// this name already exist, live or otherwise" check `establish` relies
    /// on (fails with `ERROR_ACCESS_DENIED` if one does, so there is no
    /// separate bind-then-race step like the Unix scratch-file dance).
    /// Every instance — first or not — is opened with `FILE_FLAG_OVERLAPPED`:
    /// without it, `ConnectNamedPipe`/`ReadFile`/`WriteFile` block
    /// uncancellably, and this listener's poll-and-check-the-quiescence-gate
    /// contract (matching the Unix nonblocking-listener shape in
    /// `server.rs`) and its read/write idle-timeout both depend on being
    /// able to wait with a bound and cancel on timeout.
    fn create_instance(pipe_name: &str, first: bool) -> io::Result<HANDLE> {
        let wide_name = to_wide(pipe_name);
        let (attrs, _guard) = same_user_security_attributes()?;
        let open_mode = PIPE_ACCESS_DUPLEX
            | FILE_FLAG_OVERLAPPED
            | if first {
                FILE_FLAG_FIRST_PIPE_INSTANCE
            } else {
                0
            };
        // Safety: `wide_name` and `attrs` outlive the call; `attrs` is only
        // read by `CreateNamedPipeW`, which does not retain the pointer.
        let handle = unsafe {
            CreateNamedPipeW(
                wide_name.as_ptr(),
                open_mode,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                PIPE_UNLIMITED_INSTANCES,
                4096,
                4096,
                0,
                &attrs,
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        Ok(handle)
    }

    /// Synchronous, non-overlapped client-side open, used only for the
    /// liveness probe below: it connects and is immediately closed, never
    /// reads or writes, so there is nothing for an idle-timeout or a
    /// cancellable wait to apply to.
    fn connect_client(pipe_name: &str) -> io::Result<HANDLE> {
        let wide_name = to_wide(pipe_name);
        // Safety: `wide_name` outlives the call; no security attributes are
        // needed for a client-side open.
        let handle = unsafe {
            CreateFileW(
                wide_name.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                0,
                std::ptr::null(),
                OPEN_EXISTING,
                0,
                std::ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            Err(io::Error::last_os_error())
        } else {
            Ok(handle)
        }
    }

    enum Liveness {
        Live,
        Dead,
        Unknown,
    }

    /// Mirrors the Unix probe's invariant: a successful connect proves life
    /// and is immediately closed rather than left open, so a liveness check
    /// never consumes a real client slot; anything other than the pipe
    /// genuinely not existing is treated as unprovable, never as death.
    fn probe(pipe_name: &str) -> Liveness {
        match connect_client(pipe_name) {
            Ok(handle) => {
                unsafe {
                    CloseHandle(handle);
                }
                Liveness::Live
            }
            Err(e) if e.raw_os_error() == Some(ERROR_FILE_NOT_FOUND as i32) => Liveness::Dead,
            Err(_) => Liveness::Unknown,
        }
    }

    /// Drives one overlapped Win32 I/O call to completion, timeout or
    /// error — the shared wait/cancel/reap mechanics behind `accept`,
    /// `Read` and `Write` below, so those three call sites do not each
    /// reimplement it. `issue` starts the operation and returns exactly
    /// what the Win32 call returned; this function does the rest: create a
    /// manual-reset event, wait on it up to `timeout` (`None` waits
    /// indefinitely), and on timeout, `CancelIoEx` the specific handle
    /// before reaping the result — a cancelled operation's `OVERLAPPED`
    /// must still be reaped via `GetOverlappedResult` before the handle can
    /// be reused, per the Win32 contract.
    ///
    /// Returns `(bytes_transferred, timed_out)`. `ERROR_PIPE_CONNECTED`
    /// (a client connected between instance creation and this call, so the
    /// "connect" was already complete before it was even issued) is folded
    /// into an ordinary immediate success with `0` bytes transferred,
    /// matching `ConnectNamedPipe`'s documented special case.
    fn run_overlapped(
        handle: HANDLE,
        timeout: Option<Duration>,
        issue: impl FnOnce(*mut OVERLAPPED) -> i32,
    ) -> io::Result<(u32, bool)> {
        // Safety: a manual-reset (`TRUE`), initially-unsignaled (`FALSE`),
        // unnamed event; owned exclusively by this call and closed below.
        let event = unsafe { CreateEventW(std::ptr::null(), TRUE, FALSE, std::ptr::null()) };
        if event.is_null() {
            return Err(io::Error::last_os_error());
        }
        struct EventGuard(HANDLE);
        impl Drop for EventGuard {
            fn drop(&mut self) {
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
        let _event_guard = EventGuard(event);

        // Safety: zero-initialized `OVERLAPPED` is a valid starting state
        // per the Win32 contract; only `hEvent` needs to be set before use.
        let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
        overlapped.hEvent = event;

        // Safety: `overlapped` outlives every branch below, including the
        // cancel-then-reap path, so the kernel never writes into a freed
        // stack slot.
        let started = issue(&mut overlapped);
        if started == 0 {
            let err = unsafe { GetLastError() };
            if err == ERROR_PIPE_CONNECTED {
                return Ok((0, false));
            }
            if err != ERROR_IO_PENDING {
                return Err(io::Error::from_raw_os_error(err as i32));
            }
            let wait_ms = match timeout {
                None => INFINITE,
                Some(d) => u32::try_from(d.as_millis()).unwrap_or(u32::MAX - 1),
            };
            // Safety: `event` is valid and owned by this call for its
            // duration.
            match unsafe { WaitForSingleObject(event, wait_ms) } {
                WAIT_OBJECT_0 => {}
                WAIT_TIMEOUT => {
                    // Safety: `handle` and `overlapped` are both still valid;
                    // cancelling only affects operations issued against this
                    // specific handle value.
                    unsafe {
                        CancelIoEx(handle, &overlapped);
                    }
                    let mut transferred: u32 = 0;
                    // Safety: reaps the (now cancelled) operation so
                    // `overlapped` and the handle are safe to reuse; `TRUE`
                    // (wait) is fine here since cancellation already
                    // completed or is completing imminently.
                    unsafe {
                        GetOverlappedResult(handle, &overlapped, &mut transferred, TRUE);
                    }
                    return Ok((0, true));
                }
                _ => return Err(io::Error::last_os_error()),
            }
        }
        let mut transferred: u32 = 0;
        // Safety: the operation has completed (either synchronously above,
        // or the wait just observed its event), so the result is ready
        // without blocking (`FALSE`).
        let ok = unsafe { GetOverlappedResult(handle, &overlapped, &mut transferred, FALSE) };
        if ok == 0 {
            let err = unsafe { GetLastError() };
            if err == ERROR_PIPE_CONNECTED {
                return Ok((0, false));
            }
            return Err(io::Error::from_raw_os_error(err as i32));
        }
        Ok((transferred, false))
    }

    /// Owns only the canonical pipe *name* and, between calls, at most one
    /// not-yet-connected instance — mirrors `UnixListener`'s ownership
    /// shape, where `accept()` yields streams the listener no longer
    /// tracks. Windows named pipes are multi-instance by name (unlike a
    /// Unix listening socket), so a second, later `accept()` creates a
    /// *new* instance rather than reusing the one just handed to the first
    /// caller.
    pub struct NamedPipeListener {
        name: String,
        pending: Option<HANDLE>,
    }

    // Safety: a Win32 HANDLE has no thread affinity; ownership (this
    // struct) is single-owner, so transferring it across threads is sound.
    unsafe impl Send for NamedPipeListener {}

    impl Drop for NamedPipeListener {
        fn drop(&mut self) {
            if let Some(handle) = self.pending.take() {
                unsafe {
                    CloseHandle(handle);
                }
            }
        }
    }

    impl NamedPipeListener {
        fn ensure_pending_instance(&mut self) -> io::Result<HANDLE> {
            if let Some(handle) = self.pending {
                return Ok(handle);
            }
            let handle = create_instance(&self.name, false)?;
            self.pending = Some(handle);
            Ok(handle)
        }

        /// Waits up to `poll_timeout` for a client to connect to the
        /// current pending instance. On timeout, returns
        /// `io::ErrorKind::WouldBlock` — deliberately the same `ErrorKind`
        /// `server.rs`'s nonblocking Unix accept source returns for "no
        /// connection pending" — so the existing quiescence-poll accept
        /// loop (`poll_on_would_block`) needs no Windows-specific branch;
        /// it already treats `WouldBlock` as the bounded wake-and-recheck
        /// point, not a failure. The pending instance is *not* abandoned on
        /// a timeout: the next `accept()` call re-issues `ConnectNamedPipe`
        /// on the same handle (Win32's documented pattern for a
        /// cancelled-then-retried overlapped connect), so no connection
        /// attempt racing during the timeout window is lost. This does mean
        /// idle polling cancels and reissues the pending connect roughly
        /// once per `poll_timeout` — a known, minor inefficiency; a
        /// persistent long-lived pending accept would avoid it, at the cost
        /// of more cross-call state, and is a reasonable follow-up
        /// refinement rather than what this pass implements.
        pub fn accept(&mut self, poll_timeout: Duration) -> io::Result<NamedPipeConnection> {
            let handle = self.ensure_pending_instance()?;
            let (_, timed_out) = run_overlapped(handle, Some(poll_timeout), |overlapped| unsafe {
                ConnectNamedPipe(handle, overlapped)
            })?;
            if timed_out {
                return Err(io::Error::new(
                    io::ErrorKind::WouldBlock,
                    "no client connected within the poll interval",
                ));
            }
            self.pending = None;
            Ok(NamedPipeConnection::new(handle))
        }
    }

    /// One client's connection; owns exactly one pipe instance handle.
    /// `read_timeout`/`write_timeout` are `Cell`s (not plain fields) so the
    /// setters can take `&self` — matching `UnixStream::set_read_timeout`'s
    /// signature exactly, which is what lets `drogond::server`'s generic
    /// accept loop treat this and `UnixStream` identically through the
    /// shared `Transport` bound in `service_quiescence.rs`.
    pub struct NamedPipeConnection {
        handle: HANDLE,
        read_timeout: Cell<Option<Duration>>,
        write_timeout: Cell<Option<Duration>>,
    }

    // Safety: a Win32 HANDLE has no thread affinity; this connection is
    // used from one thread at a time (like `UnixStream`), so `Send` (not
    // `Sync`) is the correct, sufficient bound.
    unsafe impl Send for NamedPipeConnection {}

    impl NamedPipeConnection {
        fn new(handle: HANDLE) -> Self {
            Self {
                handle,
                read_timeout: Cell::new(None),
                write_timeout: Cell::new(None),
            }
        }

        pub fn set_read_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
            self.read_timeout.set(timeout);
            Ok(())
        }

        pub fn set_write_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
            self.write_timeout.set(timeout);
            Ok(())
        }

        /// A duplicate `HANDLE` value referring to the same underlying pipe
        /// instance object — the Windows analog of `UnixStream::try_clone`'s
        /// `dup(2)`, needed so `server.rs`'s connection loop can hold one
        /// handle for reading (wrapped in a `BufReader`) and another for
        /// writing concurrently, exactly as it already does for
        /// `UnixStream`.
        ///
        /// **Known gap, not silently assumed correct**: `CancelIoEx` (what
        /// `shutdown_both` below uses to force-unblock a stuck read/write
        /// during drain) cancels operations issued through the specific
        /// `HANDLE` *value* passed to it. Whether that also reaches an
        /// operation issued through a sibling handle produced by this
        /// method — the shape `ConnectionRegistry::drain` relies on,
        /// mirroring `UnixStream::shutdown` unblocking every fd sharing a
        /// socket — is real Win32 behavior this vertical could not verify
        /// without a Windows host. See the evidence doc's Completion
        /// section.
        pub fn try_clone(&self) -> io::Result<Self> {
            // Safety: `GetCurrentProcess` returns a pseudo-handle valid for
            // the lifetime of this process; no separate close is needed or
            // correct for it.
            let current_process = unsafe { GetCurrentProcess() };
            let mut duplicate: HANDLE = std::ptr::null_mut();
            // Safety: `self.handle` is open for the lifetime of `self`;
            // `duplicate` is an out-param the API fills on success.
            let ok = unsafe {
                DuplicateHandle(
                    current_process,
                    self.handle,
                    current_process,
                    &mut duplicate,
                    0,
                    FALSE,
                    DUPLICATE_SAME_ACCESS,
                )
            };
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(Self {
                handle: duplicate,
                read_timeout: Cell::new(self.read_timeout.get()),
                write_timeout: Cell::new(self.write_timeout.get()),
            })
        }

        /// Best-effort: see the `try_clone` doc for the open question about
        /// whether this reaches an operation issued through a duplicated
        /// sibling handle. Errors are intentionally ignored, matching the
        /// Unix side's `let _ = entry.transport.shutdown(Shutdown::Both)`.
        pub fn shutdown_both(&self) {
            unsafe {
                CancelIoEx(self.handle, std::ptr::null());
            }
        }
    }

    impl Read for NamedPipeConnection {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            let handle = self.handle;
            let timeout = self.read_timeout.get();
            let len = u32::try_from(buf.len()).unwrap_or(u32::MAX);
            let ptr = buf.as_mut_ptr();
            let (transferred, timed_out) = run_overlapped(handle, timeout, |overlapped| unsafe {
                ReadFile(handle, ptr, len, std::ptr::null_mut(), overlapped)
            })?;
            if timed_out {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "named pipe read timed out",
                ));
            }
            Ok(transferred as usize)
        }
    }

    impl Write for NamedPipeConnection {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            let handle = self.handle;
            let timeout = self.write_timeout.get();
            let len = u32::try_from(buf.len()).unwrap_or(u32::MAX);
            let ptr = buf.as_ptr();
            let (transferred, timed_out) = run_overlapped(handle, timeout, |overlapped| unsafe {
                WriteFile(handle, ptr, len, std::ptr::null_mut(), overlapped)
            })?;
            if timed_out {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "named pipe write timed out",
                ));
            }
            Ok(transferred as usize)
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    impl Drop for NamedPipeConnection {
        fn drop(&mut self) {
            unsafe {
                DisconnectNamedPipe(self.handle);
                CloseHandle(self.handle);
            }
        }
    }

    /// Binds this process onto the data directory's deterministic named
    /// pipe, refusing if a live (or unprovably-dead) incumbent already
    /// holds it. See the module doc for the `windows-sys` dependency gap
    /// and the evidence doc for the wiring this now enables in `lib.rs`/
    /// `server.rs`/`service_quiescence.rs`/`lock.rs`.
    pub fn establish(data_dir: &Path) -> io::Result<NamedPipeListener> {
        let name = super::windows_pipe_name(&super::canonical_for_hash(data_dir));
        match create_instance(&name, true) {
            Ok(handle) => Ok(NamedPipeListener {
                name,
                pending: Some(handle),
            }),
            Err(e) if e.raw_os_error() == Some(ERROR_ACCESS_DENIED as i32) => {
                let refuse = || {
                    Err(io::Error::new(
                        io::ErrorKind::AddrInUse,
                        "a live (or unprovably dead) drogond already owns this data directory",
                    ))
                };
                match probe(&name) {
                    Liveness::Live | Liveness::Unknown => refuse(),
                    Liveness::Dead => match probe(&name) {
                        // Re-probe once more immediately before acting,
                        // matching the Unix re-check: ownership may have
                        // changed hands between the first probe and here.
                        Liveness::Dead => {
                            create_instance(&name, true).map(|handle| NamedPipeListener {
                                name: name.clone(),
                                pending: Some(handle),
                            })
                        }
                        _ => refuse(),
                    },
                }
            }
            Err(e) => Err(e),
        }
    }
}

#[cfg(windows)]
pub use windows_pipe::{NamedPipeConnection, NamedPipeListener, establish};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_verbatim_prefix_collapses_the_unc_form_back_to_a_plain_unc_path() {
        assert_eq!(
            strip_verbatim_prefix(r"\\?\UNC\server\share\dir"),
            r"\\server\share\dir",
            "must not leave a bare UNC\\ segment with no leading \\\\"
        );
    }

    #[test]
    fn strip_verbatim_prefix_strips_the_plain_local_drive_form() {
        assert_eq!(
            strip_verbatim_prefix(r"\\?\C:\Users\tester"),
            r"C:\Users\tester"
        );
    }

    #[test]
    fn strip_verbatim_prefix_leaves_non_verbatim_paths_untouched() {
        assert_eq!(
            strip_verbatim_prefix(r"C:\Users\tester"),
            r"C:\Users\tester"
        );
        assert_eq!(
            strip_verbatim_prefix("/home/tester/.local/share/drogon"),
            "/home/tester/.local/share/drogon"
        );
    }

    /// Retained regression check (was against a hand-rolled SHA-256; now
    /// against the `sha2` crate call `windows_pipe_name` actually makes), so
    /// a future `sha2` version bump that silently changed digest output
    /// would still fail this test instead of only surfacing as a pipe-name
    /// mismatch between the CLI and the daemon.
    #[test]
    fn sha2_crate_matches_known_vectors() {
        assert_eq!(
            Sha256::digest(b"").as_slice(),
            [
                0xe3, 0xb0, 0xc4, 0x42, 0x98, 0xfc, 0x1c, 0x14, 0x9a, 0xfb, 0xf4, 0xc8, 0x99, 0x6f,
                0xb9, 0x24, 0x27, 0xae, 0x41, 0xe4, 0x64, 0x9b, 0x93, 0x4c, 0xa4, 0x95, 0x99, 0x1b,
                0x78, 0x52, 0xb8, 0x55,
            ]
        );
        assert_eq!(
            Sha256::digest(b"abc").as_slice(),
            [
                0xba, 0x78, 0x16, 0xbf, 0x8f, 0x01, 0xcf, 0xea, 0x41, 0x41, 0x40, 0xde, 0x5d, 0xae,
                0x22, 0x23, 0xb0, 0x03, 0x61, 0xa3, 0x96, 0x17, 0x7a, 0x9c, 0xb4, 0x10, 0xff, 0x61,
                0xf2, 0x00, 0x15, 0xad,
            ]
        );
    }

    #[test]
    fn pipe_name_is_contract_stable() {
        let name = windows_pipe_name("/home/tester/.local/share/drogon");
        assert!(name.starts_with("\\\\.\\pipe\\drogon-v1-"));
        let suffix = &name["\\\\.\\pipe\\drogon-v1-".len()..];
        assert_eq!(suffix.len(), 24);
        assert!(
            suffix
                .chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        );
        assert_eq!(name, windows_pipe_name("/home/tester/.local/share/drogon"));
        assert_ne!(name, windows_pipe_name("/home/other/.local/share/drogon"));
    }

    /// Cross-checks this crate's independent SHA-256 against the exact
    /// digest prefix `drogon-cli::paths::windows_pipe_name` computes for the
    /// same sample input (verified separately with `shasum -a 256`), so a
    /// divergence between the two duplicated implementations fails a test
    /// instead of silently breaking client/daemon pipe-name agreement.
    #[test]
    fn pipe_name_matches_drogon_cli_contract_for_a_known_input() {
        let name = windows_pipe_name("/home/tester/.local/share/drogon");
        assert_eq!(name, "\\\\.\\pipe\\drogon-v1-44bca9b408bb8c048e5a2201");
    }
}
