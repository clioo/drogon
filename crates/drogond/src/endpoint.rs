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

/// Builds the Windows named-pipe DACL's SDDL string given the creating
/// process's `TokenUser` SID, already rendered in its canonical `S-1-...`
/// string form (see `windows_pipe::token_user_sid_string`, `cfg(windows)`
/// only, for how that string is obtained). Protected (`P`, no inherited
/// ACEs); Generic-All to the named SID and to Local System (`SY`).
///
/// Deliberately takes the SID as a string rather than resolving it itself,
/// so this — the only actual SID/DACL *selection* logic here, as opposed to
/// the FFI calls that resolve the caller's real SID or install the
/// resulting descriptor — is pure string formatting and can be unit-tested
/// on every host, not only wherever `cfg(windows)` happens to compile. This
/// intentionally never emits the `OW` ("the object's owner") trustee: a
/// process's `TOKEN_OWNER` — which becomes a new object's default owner
/// whenever no owner is explicitly set — is documented to be settable to
/// either the user's own SID or one of the user's group SIDs, and
/// `TOKEN_OWNER` is a distinct token field from `TOKEN_USER`; an `OW`-keyed
/// ACE can therefore silently grant a group the caller merely belongs to,
/// not "this same user," in any token shape where `TOKEN_OWNER` is a group.
/// Naming the actual queried `TokenUser` SID here instead sidesteps having
/// to separately prove `owner == TokenUser` holds for every valid token
/// shape.
#[cfg_attr(not(windows), allow(dead_code))]
fn dacl_sddl_for_user_sid(user_sid: &str) -> String {
    format!("D:P(A;;GA;;;{user_sid})(A;;GA;;;SY)")
}

/// Pure state machine behind `NamedPipeConnection`'s (`cfg(windows)`, below)
/// shared shutdown/disconnect bookkeeping. A named-pipe instance can be
/// referenced by several distinct duplicate handle values at once
/// (`DuplicateHandle`, used by `try_clone`) held by different threads —
/// the accept loop's connection handler and its write-half clone, plus
/// `ConnectionRegistry`'s tracking clone. Three invariants must hold across
/// every one of those clones, not just the handle a given caller happens to
/// hold:
///
/// 1. Once any clone calls `shutdown_both`, every clone's *next* read/write
///    must fail immediately (`is_closed`) rather than start a fresh
///    operation — a detached handler thread otherwise has no way to know
///    the transport is permanently going away and could issue a write after
///    the registry believes the connection is gone.
/// 2. `shutdown_both` must be able to `CancelIoEx` every live duplicate
///    (`live_handles`), not only the handle the caller happens to hold —
///    `CancelIoEx`'s documented cancellation scope is "operations issued
///    through this handle value," so a handler blocked in a read/write on a
///    *different* duplicate is unreachable by cancelling only one.
/// 3. `DisconnectNamedPipe` must run exactly once, when the last live
///    duplicate is dropped (`remove_and_is_last`) — calling it once per
///    duplicate's `Drop` would disconnect the shared pipe instance out from
///    under sibling clones that are still in use.
/// 4. Both the closed-check-and-issue step (`run_overlapped_guarded`) and
///    the mark-closed-and-cancel step (`shutdown_both`) must hold this
///    struct's `Mutex` across the *entire* step, including the real Win32
///    call (`ReadFile`/`WriteFile`/`ConnectNamedPipe` on one side,
///    `CancelIoEx` on the other) — not just the bookkeeping read/write —
///    or a check can observe "not closed" in the gap before `shutdown_both`
///    cancels nothing (because nothing was pending yet) and the real
///    operation then starts uncancelled. The same lock must also be held
///    through `Drop`'s `CloseHandle`/`DisconnectNamedPipe`, so a concurrent
///    `shutdown_both` can never `CancelIoEx` a handle value `Drop` has
///    already closed (and Windows may have already recycled for an
///    unrelated object).
///
/// Kept generic over the handle-identifier type (rather than hardcoded to
/// the real Win32 `HANDLE`) purely so these transitions are unit-tested on
/// every host, including this one — nothing here performs any actual I/O or
/// references any Windows type.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug)]
struct SharedTransportState<H> {
    closed: bool,
    live: Vec<H>,
}

#[cfg_attr(not(windows), allow(dead_code))]
impl<H: PartialEq + Copy> SharedTransportState<H> {
    fn new(initial: H) -> Self {
        Self {
            closed: false,
            live: vec![initial],
        }
    }

    /// Registers a newly duplicated handle (`try_clone`) sharing this
    /// connection group.
    fn add(&mut self, handle: H) {
        self.live.push(handle);
    }

    /// Fences new I/O across every clone: callers must check `is_closed`
    /// before issuing the underlying platform read/write call.
    fn mark_closed(&mut self) {
        self.closed = true;
    }

    fn is_closed(&self) -> bool {
        self.closed
    }

    /// Every currently-live handle identifier sharing this connection
    /// group, e.g. to `CancelIoEx` each in turn.
    fn live_handles(&self) -> Vec<H> {
        self.live.clone()
    }

    /// Removes `handle` from the live set (its owner is dropping it) and
    /// reports whether that was the last live handle — i.e. whether the
    /// caller is the final owner responsible for the one-time disconnect,
    /// as opposed to a duplicate whose `Drop` must only close its own
    /// handle value.
    fn remove_and_is_last(&mut self, handle: H) -> bool {
        self.live.retain(|&h| h != handle);
        self.live.is_empty()
    }
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
/// bindings, not FFI declarations): the explicit-DACL SID/SDDL-selection
/// logic (`dacl_sddl_for_user_sid`, `token_user_sid_string`), the
/// `SecurityDescriptorGuard`/`HandleGuard` RAII wrappers around
/// `LocalFree`/`CloseHandle`, and the `to_wide` UTF-16 helper. No other
/// hand-written FFI was added.
#[cfg(windows)]
mod windows_pipe {
    use std::cell::Cell;
    use std::ffi::c_void;
    use std::io::{self, Read, Write};
    use std::path::Path;
    use std::time::Duration;

    use std::sync::{Arc, Mutex};

    use windows_sys::Win32::Foundation::{
        CloseHandle, DUPLICATE_SAME_ACCESS, DuplicateHandle, ERROR_ACCESS_DENIED,
        ERROR_FILE_NOT_FOUND, ERROR_IO_PENDING, ERROR_OPERATION_ABORTED, ERROR_PIPE_CONNECTED,
        FALSE, GENERIC_READ, GENERIC_WRITE, GetLastError, HANDLE, INVALID_HANDLE_VALUE, LocalFree,
        TRUE, WAIT_OBJECT_0, WAIT_TIMEOUT,
    };
    use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows_sys::Win32::Security::Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW;
    use windows_sys::Win32::Security::{
        GetTokenInformation, IsValidSid, PSID, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
        TokenUser,
    };
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
        CreateEventW, GetCurrentProcess, INFINITE, OpenProcessToken, WaitForSingleObject,
    };

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

    /// Closes a `HANDLE` on drop. Used only for the process token handle in
    /// `token_user_sid_string`, whose several early-return error paths would
    /// otherwise each need their own `CloseHandle` call.
    struct HandleGuard(HANDLE);

    impl Drop for HandleGuard {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    /// Reads a NUL-terminated wide (UTF-16) string starting at `ptr`, e.g.
    /// the buffer `ConvertSidToStringSidW` fills on success.
    ///
    /// Safety: `ptr` must be non-null and point at a valid NUL-terminated
    /// UTF-16 string that outlives this call.
    unsafe fn wide_nul_terminated_to_string(ptr: *const u16) -> String {
        let mut len = 0usize;
        // Safety: caller guarantees `ptr` points at a NUL-terminated string.
        while unsafe { *ptr.add(len) } != 0 {
            len += 1;
        }
        // Safety: `len` was just measured up to (not including) the NUL.
        let slice = unsafe { std::slice::from_raw_parts(ptr, len) };
        String::from_utf16_lossy(slice)
    }

    /// Queries the calling process's real `TokenUser` SID — always a user
    /// SID, never a group, unlike `TOKEN_OWNER`/`OW` (see
    /// `same_user_security_attributes`'s doc) — and renders it as its
    /// canonical `S-1-...` string form via `ConvertSidToStringSidW`, so it
    /// can be embedded directly into the pipe's DACL SDDL in place of the
    /// old `OW` placeholder. Fails closed (returns `Err`) on any step's
    /// failure, including a SID that fails `IsValidSid` — never silently
    /// falls back to `OW` or an unrestricted descriptor.
    fn token_user_sid_string() -> io::Result<String> {
        let mut token: HANDLE = std::ptr::null_mut();
        // Safety: `GetCurrentProcess` is a pseudo-handle needing no
        // separate close; `token` is an out-param filled on success.
        let ok = unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        let _token_guard = HandleGuard(token);

        let mut needed: u32 = 0;
        // Safety: the documented zero-length probe call to learn the
        // required buffer size; this always "fails" this way once `token`
        // is valid, so its `BOOL` result is intentionally ignored here.
        unsafe {
            GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed);
        }
        if needed == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut buf = vec![0u8; needed as usize];
        // Safety: `buf` is exactly `needed` bytes, the size the probe call
        // above just reported; `needed` is reused as the out-param for the
        // actual bytes written, which this does not need to inspect.
        let ok = unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                buf.as_mut_ptr() as *mut c_void,
                needed,
                &mut needed,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        // Safety: `buf` was just filled by a successful `GetTokenInformation`
        // call for `TokenUser`, which per its contract writes a `TOKEN_USER`
        // at the start of the buffer.
        let token_user = unsafe { &*(buf.as_ptr() as *const TOKEN_USER) };
        let sid: PSID = token_user.User.Sid;
        // Safety: `sid` points inside `buf`, still alive here; `IsValidSid`
        // only reads it.
        if unsafe { IsValidSid(sid) } == 0 {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                "process TokenUser SID failed IsValidSid; refusing to build a pipe DACL from it",
            ));
        }
        let mut sid_string: *mut u16 = std::ptr::null_mut();
        // Safety: `sid` was just validated above; `sid_string` is an
        // out-param the API fills on success, allocated via `LocalAlloc`
        // per its contract and freed below with `LocalFree`.
        let ok = unsafe { ConvertSidToStringSidW(sid, &mut sid_string) };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        // Safety: `sid_string` was just set by the successful call above.
        let sid_str = unsafe { wide_nul_terminated_to_string(sid_string) };
        unsafe {
            LocalFree(sid_string as *mut c_void);
        }
        Ok(sid_str)
    }

    /// Explicit-DACL pipe security attributes: Protected (`P`, no inherited
    /// ACEs), Generic-All to the creating process's real `TokenUser` SID and
    /// to Local System. Passing `NULL` security attributes instead would use
    /// `CreateNamedPipeW`'s *default* descriptor, which Microsoft documents
    /// as granting read access to the Everyone group and the anonymous
    /// account.
    ///
    /// This deliberately does not use the `OW` ACE trustee ("the object's
    /// owner") to grant access, even though `OW` was this function's prior
    /// approach: a process's `TOKEN_OWNER` — which in turn becomes a new
    /// object's default owner whenever no owner is explicitly set, as is the
    /// case here — is documented to be settable to *either* the user's own
    /// SID *or* one of the user's group SIDs, and `TOKEN_OWNER` is a field
    /// distinct from `TOKEN_USER`. An `OW`-keyed ACE can therefore silently
    /// grant access to a group the caller merely belongs to, rather than
    /// "this same user," in any token shape where `TOKEN_OWNER` is a group —
    /// the opposite of `protocol-v1.md`'s same-user requirement, and not
    /// detectable from the SDDL string alone. Rather than attempt to prove
    /// `owner == TokenUser` holds for every valid token shape (a harder,
    /// more failure-prone claim to stand behind), this queries `TokenUser`
    /// directly (`token_user_sid_string`, above) and plugs its string SID
    /// into the DACL (`dacl_sddl_for_user_sid`, top of this file) in place
    /// of `OW`. If that query fails for any reason, pipe creation fails
    /// closed (propagates the error) rather than falling back to `OW`,
    /// `NULL` security attributes, or any other default.
    ///
    /// Still built via `ConvertStringSecurityDescriptorToSecurityDescriptorW`
    /// rather than manual SID/ACL construction, to keep the unverified FFI
    /// surface area small — only the trustee naming the SID changed. See
    /// the evidence doc's ACL section for the full before/after.
    fn same_user_security_attributes() -> io::Result<(SECURITY_ATTRIBUTES, SecurityDescriptorGuard)>
    {
        let user_sid = token_user_sid_string()?;
        let sddl = to_wide(&super::dacl_sddl_for_user_sid(&user_sid));
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

    struct EventGuard(HANDLE);
    impl Drop for EventGuard {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    /// Manual-reset event + zero-initialized `OVERLAPPED` wired to it,
    /// shared setup for every overlapped call site (`accept`/`read`/
    /// `write`). Split out from the old single `run_overlapped` so the
    /// "issue" step can run either directly (`run_overlapped`, used by
    /// `accept`, which has no shared shutdown state to race) or while
    /// holding a `NamedPipeConnection`'s `shared` lock (`run_overlapped_guarded`,
    /// used by `read`/`write`) — see that function's doc for why the lock
    /// must be held across the check-and-issue step, not just the check.
    struct OverlappedCall {
        overlapped: OVERLAPPED,
        _event_guard: EventGuard,
    }

    impl OverlappedCall {
        fn new() -> io::Result<Self> {
            // Safety: a manual-reset (`TRUE`), initially-unsignaled
            // (`FALSE`), unnamed event; owned exclusively by this call and
            // closed by `EventGuard` on drop.
            let event = unsafe { CreateEventW(std::ptr::null(), TRUE, FALSE, std::ptr::null()) };
            if event.is_null() {
                return Err(io::Error::last_os_error());
            }
            let _event_guard = EventGuard(event);
            // Safety: zero-initialized `OVERLAPPED` is a valid starting
            // state per the Win32 contract; only `hEvent` needs to be set
            // before use.
            let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
            overlapped.hEvent = event;
            Ok(Self {
                overlapped,
                _event_guard,
            })
        }

        /// Safety: the returned pointer is valid only for the lifetime of
        /// `self`, which every caller below keeps alive across the
        /// subsequent wait/cancel/reap step.
        fn ptr(&mut self) -> *mut OVERLAPPED {
            &mut self.overlapped
        }
    }

    /// Issues `issue` immediately and drives it to completion, timeout or
    /// error. Used by `accept`, which has no shared shutdown state: a
    /// `NamedPipeListener`'s pending instance is never part of any
    /// `SharedTransportState` group, so there is no closed-check to race
    /// here.
    fn run_overlapped(
        handle: HANDLE,
        timeout: Option<Duration>,
        issue: impl FnOnce(*mut OVERLAPPED) -> i32,
    ) -> io::Result<(u32, bool)> {
        let mut call = OverlappedCall::new()?;
        let started = issue(call.ptr());
        // Safety: captured immediately alongside `issue`, per the Win32
        // immediate-capture contract — dropping to a helper call first
        // risks an intervening call resetting this thread's last-error.
        let issue_err = (started == 0).then(|| unsafe { GetLastError() });
        finish_overlapped_call(handle, &call.overlapped, timeout, started, issue_err)
    }

    /// Issues `issue` only if `shared` is not already closed, checking and
    /// issuing atomically under `shared`'s lock — released immediately
    /// after, before the wait/cancel/reap step below. This closes the race
    /// the previous drop-the-lock-before-issuing shape left open:
    /// `shutdown_both` holds this same lock across its own
    /// mark-closed-and-cancel step, so either it completes first (this
    /// call's check observes closed and never issues) or this call's
    /// locked step completes first (the operation is genuinely pending by
    /// the time `shutdown_both` snapshots `live_handles()` and cancels it)
    /// — never a partial interleaving.
    fn run_overlapped_guarded(
        shared: &Mutex<super::SharedTransportState<usize>>,
        handle: HANDLE,
        timeout: Option<Duration>,
        issue: impl FnOnce(*mut OVERLAPPED) -> i32,
    ) -> io::Result<(u32, bool)> {
        let mut call = OverlappedCall::new()?;
        let (started, issue_err) = {
            let guard = shared.lock().unwrap();
            if guard.is_closed() {
                return Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "named pipe connection was shut down",
                ));
            }
            let started = issue(call.ptr());
            // Safety: captured here, still under `guard` — dropping the
            // guard or calling `finish_overlapped_call` first could reset
            // this thread's last-error before it is read.
            let issue_err = (started == 0).then(|| unsafe { GetLastError() });
            (started, issue_err)
            // `guard` drops here, before the wait/cancel/reap step below —
            // a blocking wait must never happen while holding this lock.
        };
        finish_overlapped_call(handle, &call.overlapped, timeout, started, issue_err)
    }

    /// Shared wait/cancel/reap mechanics behind every overlapped call once
    /// it has already been issued. `started` is exactly what the Win32
    /// call returned; `issue_err` is `GetLastError()` as captured by the
    /// caller immediately alongside `issue` (used only when
    /// `started == 0`, since this function's own subsequent calls would
    /// otherwise risk observing a last-error already reset by the guard
    /// drop or the call into this function). On every exit path once the
    /// operation is `ERROR_IO_PENDING` (not only the timeout path — see
    /// the `_` wait arm below), `CancelIoEx` the specific handle before
    /// reaping via `GetOverlappedResult` — a pending operation's
    /// `OVERLAPPED`, event and buffer are all still kernel-owned until
    /// reaped, per the Win32 contract.
    ///
    /// Returns `(bytes_transferred, timed_out)`. `ERROR_PIPE_CONNECTED`
    /// (a client connected before the call was even issued) folds into an
    /// ordinary immediate success with `0` bytes, matching
    /// `ConnectNamedPipe`'s documented special case. On the timeout path,
    /// a `GetOverlappedResult` success racing `CancelIoEx` wins over
    /// `timed_out`, since that completion exists exactly once and can
    /// never be redelivered on this about-to-be-dropped `OVERLAPPED`.
    fn finish_overlapped_call(
        handle: HANDLE,
        overlapped: &OVERLAPPED,
        timeout: Option<Duration>,
        started: i32,
        issue_err: Option<u32>,
    ) -> io::Result<(u32, bool)> {
        if started == 0 {
            let err =
                issue_err.expect("issue_err must be captured by the caller when started == 0");
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
            // Safety: `overlapped.hEvent` is valid and owned by the
            // caller's `OverlappedCall` for the duration of this wait.
            match unsafe { WaitForSingleObject(overlapped.hEvent, wait_ms) } {
                WAIT_OBJECT_0 => {}
                WAIT_TIMEOUT => {
                    // Safety: `handle` and `overlapped` are both still valid;
                    // cancelling only affects operations issued against this
                    // specific handle value.
                    unsafe {
                        CancelIoEx(handle, overlapped);
                    }
                    let mut transferred: u32 = 0;
                    // Safety: reaps the operation — which may have finished
                    // successfully in the race window between the timeout
                    // firing and `CancelIoEx` actually stopping it, or been
                    // genuinely cancelled — so `overlapped` and the handle
                    // are safe to reuse; `TRUE` (wait) is fine here since
                    // cancellation already completed or is completing
                    // imminently.
                    let ok =
                        unsafe { GetOverlappedResult(handle, overlapped, &mut transferred, TRUE) };
                    if ok != 0 {
                        // The operation completed successfully despite the
                        // cancel: report the real result, not a timeout.
                        return Ok((transferred, false));
                    }
                    let err = unsafe { GetLastError() };
                    if err == ERROR_PIPE_CONNECTED {
                        return Ok((0, false));
                    }
                    if err == ERROR_OPERATION_ABORTED {
                        // The expected outcome of our own cancellation: a
                        // genuine timeout, nothing left pending.
                        return Ok((0, true));
                    }
                    return Err(io::Error::from_raw_os_error(err as i32));
                }
                _ => {
                    // `WaitForSingleObject` itself failed (e.g.
                    // `WAIT_FAILED`). The issued operation is still exactly
                    // as `ERROR_IO_PENDING` as it was before this wait, so
                    // it must still be cancelled and reaped before
                    // returning — the same obligation as the timeout arm
                    // above, just with a wait failure instead of a wait
                    // success to report once it's discharged.
                    let wait_err = io::Error::last_os_error();
                    unsafe {
                        CancelIoEx(handle, overlapped);
                    }
                    let mut transferred: u32 = 0;
                    // Safety: reaps whatever the cancel left behind so
                    // `overlapped`/`handle` are safe to reuse; the result is
                    // discarded because `wait_err` — from the wait failure
                    // itself, captured before this call could overwrite the
                    // thread's last-error — is the more specific failure to
                    // report.
                    unsafe {
                        GetOverlappedResult(handle, overlapped, &mut transferred, TRUE);
                    }
                    return Err(wait_err);
                }
            }
        }
        let mut transferred: u32 = 0;
        // Safety: the operation has completed (either synchronously above,
        // or the wait just observed its event), so the result is ready
        // without blocking (`FALSE`).
        let ok = unsafe { GetOverlappedResult(handle, overlapped, &mut transferred, FALSE) };
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

    /// One client's connection; owns exactly one pipe instance handle out of
    /// a group that may include sibling `try_clone` duplicates (the read
    /// handle held by `server.rs`'s `BufReader`, its write-half clone, and
    /// `ConnectionRegistry`'s tracking clone can all be live at once, on
    /// different threads). `shared` is that group's single source of truth
    /// — see [`super::SharedTransportState`]'s doc for the three invariants
    /// it exists to hold across every clone, not just `self`. Handle values
    /// are stored as `usize` there rather than `HANDLE` (a raw pointer, not
    /// `Send`/`Sync`) purely so the `Arc<Mutex<_>>` needs no `unsafe impl`
    /// of its own; casting a `HANDLE` to and from `usize` is lossless and
    /// never dereferences it. `read_timeout`/`write_timeout` are `Cell`s
    /// (not plain fields) so the setters can take `&self` — matching
    /// `UnixStream::set_read_timeout`'s signature exactly, which is what
    /// lets `drogond::server`'s generic accept loop treat this and
    /// `UnixStream` identically through the shared `Transport` bound in
    /// `service_quiescence.rs`.
    #[derive(Debug)]
    pub struct NamedPipeConnection {
        handle: HANDLE,
        shared: Arc<Mutex<super::SharedTransportState<usize>>>,
        read_timeout: Cell<Option<Duration>>,
        write_timeout: Cell<Option<Duration>>,
    }

    // Safety: a Win32 HANDLE has no thread affinity; this connection's
    // clones are used concurrently from different threads (the read/write
    // halves and the registry's tracking clone), all synchronized through
    // `shared`'s `Mutex`, so `Send` is the correct, sufficient bound (not
    // `Sync`: no clone's own `&self` methods are called from more than one
    // thread at a time).
    unsafe impl Send for NamedPipeConnection {}

    impl NamedPipeConnection {
        fn new(handle: HANDLE) -> Self {
            Self {
                handle,
                shared: Arc::new(Mutex::new(super::SharedTransportState::new(
                    handle as usize,
                ))),
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
        /// `UnixStream`. The new duplicate joins `self`'s `shared` group
        /// (same `Arc`, registered into it below) rather than starting a
        /// fresh, disconnected one, so `shutdown_both` called on *any* clone
        /// reaches every other — see [`super::SharedTransportState`].
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
            self.shared.lock().unwrap().add(duplicate as usize);
            Ok(Self {
                handle: duplicate,
                shared: Arc::clone(&self.shared),
                read_timeout: Cell::new(self.read_timeout.get()),
                write_timeout: Cell::new(self.write_timeout.get()),
            })
        }

        /// Permanent transport shutdown, not merely a best-effort in-flight
        /// cancellation: marks the shared group closed — every clone's next
        /// `read`/`write` fails immediately (`ErrorKind::BrokenPipe`)
        /// without issuing a new overlapped call, which is what stops a
        /// detached handler thread from serving a request that raced the
        /// drain instead of relying on `CancelIoEx` alone to have reached it
        /// — then `CancelIoEx`s every currently-live duplicate handle in the
        /// group, not only `self.handle`: `CancelIoEx`'s documented
        /// cancellation scope is "operations issued through this handle
        /// value," so a handler thread blocked in a read/write on a
        /// *different* duplicate than the one `drain` happens to hold would
        /// otherwise be unreachable. Errors from the cancellation itself are
        /// intentionally ignored, matching the Unix side's
        /// `let _ = entry.transport.shutdown(Shutdown::Both)`.
        ///
        /// `shared`'s lock is held for the mark-closed step AND across the
        /// entire cancellation loop below, not released in between: a
        /// concurrent `Drop` (see its matching discipline) must not be able
        /// to `CloseHandle` — and have Windows recycle — a handle value
        /// while a `CancelIoEx` naming that exact value is in flight, which
        /// would otherwise risk cancelling I/O on a completely unrelated,
        /// freshly-opened kernel object that happened to reuse the same
        /// handle number.
        pub fn shutdown_both(&self) {
            let mut shared = self.shared.lock().unwrap();
            shared.mark_closed();
            let live = shared.live_handles();
            for key in live {
                let handle = key as *mut c_void;
                unsafe {
                    CancelIoEx(handle, std::ptr::null());
                }
            }
        }
    }

    impl Read for NamedPipeConnection {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            let handle = self.handle;
            let timeout = self.read_timeout.get();
            let len = u32::try_from(buf.len()).unwrap_or(u32::MAX);
            let ptr = buf.as_mut_ptr();
            let (transferred, timed_out) =
                run_overlapped_guarded(&self.shared, handle, timeout, |overlapped| unsafe {
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
            let (transferred, timed_out) =
                run_overlapped_guarded(&self.shared, handle, timeout, |overlapped| unsafe {
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
            // `DisconnectNamedPipe` severs the pipe instance itself, shared
            // by every duplicate in this group — calling it once per
            // duplicate's `Drop` would disconnect siblings still in use, so
            // only the final owner (the group's last live handle) may call
            // it. Every duplicate, final owner or not, still closes its own
            // handle value.
            //
            // `shared`'s lock is held through `CloseHandle` (and, for the
            // final owner, `DisconnectNamedPipe`) — matching
            // `shutdown_both`'s discipline above — so the two can never
            // interleave such that `CancelIoEx` there targets a handle
            // value this call has already closed (and Windows may have
            // already recycled for an unrelated object).
            let mut shared = self.shared.lock().unwrap();
            let is_last = shared.remove_and_is_last(self.handle as usize);
            unsafe {
                if is_last {
                    DisconnectNamedPipe(self.handle);
                }
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

    /// Real-`HANDLE` tests for the overlapped-lifetime safety corrections
    /// (see `run_overlapped`'s doc and `NamedPipeConnection::shutdown_both`'s
    /// doc). Unlike `tests/windows_transport.rs` (an external integration
    /// test limited to this module's public API), these live inside
    /// `windows_pipe` itself so they can reach `connect_client` directly —
    /// this vertical has no client-side wrapper type to expose publicly —
    /// and so they compile only where `windows-sys` is actually a
    /// dependency (`cfg(windows)`); V5's isolated Windows runner is the
    /// first compiler and the only host that ever executes them.
    #[cfg(test)]
    mod tests {
        use super::*;
        use std::time::Instant;

        fn pipe_name_for(dir: &Path) -> String {
            super::super::windows_pipe_name(&super::super::canonical_for_hash(dir))
        }

        /// Regression test for the immediate-capture fix: `finish_overlapped_call`
        /// must resolve its `started == 0` branch from the `issue_err` its
        /// caller captured, never a fresh `GetLastError()` call of its own —
        /// the whole point of the fix is that nothing after `issue` (a
        /// dropped lock guard, a helper call) may be trusted to leave the
        /// thread's last-error untouched. Windows-gated like every other
        /// test in this module (the function itself only exists under
        /// `cfg(windows)`), but needs no real pipe or kernel I/O: `started`
        /// is nonzero-failure (`0`) with a synthetic `issue_err`, so the
        /// function returns immediately without touching `handle` or
        /// `overlapped`, keeping this deterministic and host-independent
        /// once compiled.
        #[test]
        fn finish_overlapped_call_resolves_from_the_captured_issue_error() {
            let overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
            let err = finish_overlapped_call(
                INVALID_HANDLE_VALUE,
                &overlapped,
                None,
                0,
                Some(ERROR_ACCESS_DENIED),
            )
            .unwrap_err();
            assert_eq!(err.raw_os_error(), Some(ERROR_ACCESS_DENIED as i32));

            let ok = finish_overlapped_call(
                INVALID_HANDLE_VALUE,
                &overlapped,
                None,
                0,
                Some(ERROR_PIPE_CONNECTED),
            )
            .unwrap();
            assert_eq!(ok, (0, false));
        }

        /// Fix 1 (cancel-and-reap on every post-issue exit path, not only
        /// the timeout path): several consecutive timed-out accepts reuse
        /// the same pending instance and handle (`NamedPipeListener::accept`'s
        /// documented reuse-on-timeout contract). If any one of those
        /// cancel+reap cycles were incomplete, the kernel would still
        /// consider the handle's overlapped slot busy, and either a later
        /// cycle or the final real connect below would hang or error
        /// instead of completing cleanly.
        #[test]
        fn repeated_timed_out_accepts_leave_the_pending_instance_reusable_for_a_later_connect() {
            let dir = tempfile::tempdir().unwrap();
            let mut listener = establish(dir.path()).unwrap();
            let poll = Duration::from_millis(10);
            for _ in 0..5 {
                let err = listener.accept(poll).unwrap_err();
                assert_eq!(err.kind(), io::ErrorKind::WouldBlock);
            }
            let name = pipe_name_for(dir.path());
            let client = std::thread::spawn(move || connect_client(&name).map(|h| h as usize));
            let connection = listener.accept(Duration::from_secs(5));
            assert!(
                connection.is_ok(),
                "the pending instance must still accept a real connection after \
                 several cancel+reap cycles: {:?}",
                connection.err()
            );
            let client_key = client
                .join()
                .unwrap()
                .expect("client connect must succeed once the server accepted");
            unsafe {
                CloseHandle(client_key as HANDLE);
            }
        }

        /// Fix 2 (a racing completion must win over a timeout, never be
        /// silently discarded): the exact kernel-level race between
        /// `CancelIoEx` and a genuinely completing `ConnectNamedPipe` cannot
        /// be forced deterministically from outside the kernel, so this
        /// instead asserts the externally observable contract the fix
        /// restores — a client that starts connecting concurrently with a
        /// tight poll loop is always eventually observed connected, never
        /// lost to a timeout call that raced its completion. Bounded to 5s
        /// so a regression (the old always-`timed_out` behavior stranding
        /// the connect) fails the assertion rather than hanging forever.
        #[test]
        fn a_connect_racing_the_poll_timeout_is_always_eventually_observed() {
            let dir = tempfile::tempdir().unwrap();
            let mut listener = establish(dir.path()).unwrap();
            let name = pipe_name_for(dir.path());
            let client = std::thread::spawn(move || connect_client(&name).map(|h| h as usize));
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut observed = false;
            while Instant::now() < deadline {
                match listener.accept(Duration::from_micros(200)) {
                    Ok(_connection) => {
                        observed = true;
                        break;
                    }
                    Err(e) if e.kind() == io::ErrorKind::WouldBlock => continue,
                    Err(e) => panic!("unexpected accept error: {e}"),
                }
            }
            assert!(
                observed,
                "a connecting client must eventually be observed, never lost to a timeout race"
            );
            let client_key = client.join().unwrap().expect("client connect must succeed");
            unsafe {
                CloseHandle(client_key as HANDLE);
            }
        }

        /// Fix 3a (shared closed-fence): `shutdown_both` on one clone must
        /// make every sibling's *next* read/write fail immediately, not
        /// only unblock whatever that one clone happened to be doing. No
        /// timing race is involved — the fence is checked before any
        /// overlapped call is even issued — so this is fully deterministic.
        #[test]
        fn shutdown_both_fences_new_io_on_every_clone_not_just_the_caller() {
            let dir = tempfile::tempdir().unwrap();
            let mut listener = establish(dir.path()).unwrap();
            let name = pipe_name_for(dir.path());
            let client = std::thread::spawn(move || connect_client(&name).map(|h| h as usize));
            let mut connection = listener
                .accept(Duration::from_secs(5))
                .expect("client should connect within 5s");
            let client_key = client.join().unwrap().expect("client connect must succeed");

            let mut clone = connection
                .try_clone()
                .expect("try_clone must succeed on a live connection");
            connection.shutdown_both();

            let mut buf = [0u8; 4];
            let err = Read::read(&mut clone, &mut buf)
                .expect_err("a sibling clone's read must be fenced after shutdown_both");
            assert_eq!(err.kind(), io::ErrorKind::BrokenPipe);

            unsafe {
                CloseHandle(client_key as HANDLE);
            }
        }

        /// Fix 3b (disconnect exactly once, by the final owner): dropping
        /// one duplicate must not sever the shared pipe instance out from
        /// under a still-live sibling. Deterministic: no cancellation or
        /// timing is involved, only whether `DisconnectNamedPipe` fired
        /// early.
        #[test]
        fn dropping_one_duplicate_does_not_disconnect_the_shared_pipe_for_siblings() {
            let dir = tempfile::tempdir().unwrap();
            let mut listener = establish(dir.path()).unwrap();
            let name = pipe_name_for(dir.path());
            let client = std::thread::spawn(move || connect_client(&name).map(|h| h as usize));
            let connection = listener
                .accept(Duration::from_secs(5))
                .expect("client should connect within 5s");
            let client_key = client.join().unwrap().expect("client connect must succeed");

            let mut clone = connection
                .try_clone()
                .expect("try_clone must succeed on a live connection");
            drop(connection); // a non-final duplicate; must not disconnect the pipe

            let payload = b"ping";
            let n = Write::write(&mut clone, payload)
                .expect("a sibling clone must remain usable after a non-final duplicate's Drop");
            assert_eq!(n, payload.len());

            unsafe {
                CloseHandle(client_key as HANDLE);
            }
        }

        /// Fix (race 1): the closed-check and the overlapped issue must be
        /// atomic with `shutdown_both`'s mark-closed-and-cancel step
        /// (`run_overlapped_guarded`), or a read issued in the gap between
        /// "saw open" and "actually issued" starts uncancelled and blocks
        /// forever — no read timeout is set here on purpose, so a
        /// regression manifests as a hang, not merely a slow completion.
        /// The exact kernel-level interleaving cannot be pinned from
        /// outside the kernel, so this repeatedly races a fresh read
        /// against a concurrent `shutdown_both` with no synchronization
        /// delay between them (best-effort, not a guaranteed hit of the
        /// narrowest window) and asserts every trial completes within a
        /// generous bound: a regression (the pre-fix
        /// drop-the-lock-before-issuing shape) would eventually hang one of
        /// these trials, since the whole point of the fix is that
        /// `shutdown_both` and the read's issue can never interleave
        /// partially — one always fully precedes the other.
        #[test]
        fn a_read_racing_shutdown_both_never_starts_uncancelled() {
            for _ in 0..50 {
                let dir = tempfile::tempdir().unwrap();
                let mut listener = establish(dir.path()).unwrap();
                let name = pipe_name_for(dir.path());
                let client = std::thread::spawn(move || connect_client(&name).map(|h| h as usize));
                let connection = listener
                    .accept(Duration::from_secs(5))
                    .expect("client should connect within 5s");
                let client_key = client.join().unwrap().expect("client connect must succeed");

                let mut reader = connection
                    .try_clone()
                    .expect("try_clone must succeed on a live connection");
                let (tx, rx) = std::sync::mpsc::channel();
                let reader_thread = std::thread::spawn(move || {
                    let mut buf = [0u8; 4];
                    let result = Read::read(&mut reader, &mut buf);
                    let _ = tx.send(());
                    result
                });
                // No synchronization delay: races the read's issue against
                // shutdown as tightly as this host's scheduler allows.
                connection.shutdown_both();
                assert!(
                    rx.recv_timeout(Duration::from_secs(5)).is_ok(),
                    "a read racing shutdown_both must never hang: it was \
                     either fenced closed before issuing, or genuinely \
                     cancelled after issuing"
                );
                let _ = reader_thread.join().unwrap();

                unsafe {
                    CloseHandle(client_key as HANDLE);
                }
            }
        }

        /// Fix (race 2): `shutdown_both`'s cancellation loop and `Drop`'s
        /// `CloseHandle` must never interleave on the same handle value, or
        /// a `Drop`-recycled handle could receive a `CancelIoEx` meant for
        /// an entirely different, freshly-opened kernel object. That
        /// specific miscancellation cannot be observed directly from safe
        /// Rust (a successful-but-wrong cancellation leaves no
        /// distinguishing error here), so this instead stresses the shared
        /// lock discipline many times, concurrently churning `try_clone`/
        /// `Drop` on one duplicate against repeated `shutdown_both` calls
        /// on another — never sharing one `NamedPipeConnection` value
        /// across threads (that type is deliberately not `Sync`; see its
        /// `unsafe impl Send` doc), only the group's
        /// `Arc<Mutex<SharedTransportState<_>>>`, exactly the real shape a
        /// handler thread's duplicate plus `ConnectionRegistry`'s tracking
        /// clone produce in production — and asserts only that the whole
        /// interaction completes without hanging within a generous bound;
        /// a lock-discipline regression that let `CloseHandle` and
        /// `CancelIoEx` race would tend to destabilize the pipe instance
        /// and eventually hang one of these trials rather than pass
        /// cleanly every time.
        #[test]
        fn concurrent_clone_drop_and_shutdown_both_never_hang() {
            let dir = tempfile::tempdir().unwrap();
            let mut listener = establish(dir.path()).unwrap();
            let name = pipe_name_for(dir.path());
            let client = std::thread::spawn(move || connect_client(&name).map(|h| h as usize));
            let connection = listener
                .accept(Duration::from_secs(5))
                .expect("client should connect within 5s");
            let client_key = client.join().unwrap().expect("client connect must succeed");

            let churn_seed = connection
                .try_clone()
                .expect("try_clone must succeed on a live connection");

            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let shutdowner = connection;
                let churner = churn_seed;
                std::thread::scope(|scope| {
                    scope.spawn(move || {
                        for _ in 0..50 {
                            shutdowner.shutdown_both();
                        }
                    });
                    scope.spawn(move || {
                        for _ in 0..200 {
                            if let Ok(clone) = churner.try_clone() {
                                drop(clone);
                            }
                        }
                    });
                });
                let _ = tx.send(());
            });

            assert!(
                rx.recv_timeout(Duration::from_secs(10)).is_ok(),
                "concurrent try_clone/Drop churn racing shutdown_both on a \
                 sibling duplicate must not hang"
            );

            unsafe {
                CloseHandle(client_key as HANDLE);
            }
        }

        /// The ACL correction this module exists for (ROOT seq 3304):
        /// inspects the *actual* security descriptor Windows attached to a
        /// freshly created pipe instance and asserts its DACL names this
        /// process's real `TokenUser` SID — obtained independently here via
        /// the same `token_user_sid_string` production code path — as an
        /// explicit trustee, rather than only asserting the SDDL string we
        /// built contains the expected substring. A string-only assertion
        /// could pass even if `ConvertStringSecurityDescriptorToSecurityDescriptorW`
        /// or `CreateNamedPipeW` silently mishandled the descriptor; reading
        /// the DACL back via `GetSecurityInfo`/`GetAce` instead exercises
        /// the real kernel-attached object, which is the only thing that
        /// determines who can actually open this pipe.
        #[test]
        fn created_pipe_dacl_names_the_actual_tokenuser_sid_not_a_placeholder() {
            use windows_sys::Win32::Security::Authorization::{GetSecurityInfo, SE_KERNEL_OBJECT};
            use windows_sys::Win32::Security::{
                ACCESS_ALLOWED_ACE, ACL, DACL_SECURITY_INFORMATION, GetAce, PSECURITY_DESCRIPTOR,
            };

            // The real Win32 `ACCESS_ALLOWED_ACE_TYPE` (`WinNT.h`) value;
            // not imported from `windows-sys` because it lives behind the
            // `Win32_System_SystemServices` feature, which is not one of
            // `drogond`'s enabled `windows-sys` features and this task may
            // not add. `ACE_HEADER::AceType` is a stable, documented wire
            // value (0), not something the underlying Windows ABI can
            // change without breaking every existing DACL on disk.
            const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;

            let dir = tempfile::tempdir().unwrap();
            let listener = establish(dir.path()).unwrap();
            let handle = listener
                .pending
                .expect("establish() leaves exactly one pending, not-yet-connected instance");

            let expected_sid = token_user_sid_string()
                .expect("querying this test process's own TokenUser SID must succeed");

            let mut owner: PSID = std::ptr::null_mut();
            let mut group: PSID = std::ptr::null_mut();
            let mut dacl: *mut ACL = std::ptr::null_mut();
            let mut sacl: *mut ACL = std::ptr::null_mut();
            let mut sd: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
            // Safety: `handle` is the live pipe instance handle owned by
            // `listener`, valid for the duration of this call; every
            // out-param below is filled only on success.
            let status = unsafe {
                GetSecurityInfo(
                    handle,
                    SE_KERNEL_OBJECT,
                    DACL_SECURITY_INFORMATION,
                    &mut owner,
                    &mut group,
                    &mut dacl,
                    &mut sacl,
                    &mut sd,
                )
            };
            assert_eq!(
                status, 0,
                "GetSecurityInfo must succeed reading back the freshly created pipe's DACL"
            );
            assert!(
                !dacl.is_null(),
                "the pipe must carry an explicit DACL, never a NULL (fully unrestricted) one"
            );

            // Safety: `dacl` is non-null per the check above and was just
            // filled by the successful `GetSecurityInfo` call.
            let acl = unsafe { &*dacl };
            let mut names_expected_sid = false;
            for index in 0..u32::from(acl.AceCount) {
                let mut ace_ptr: *mut c_void = std::ptr::null_mut();
                // Safety: `dacl` is valid and `index` is within
                // `acl.AceCount`, per the loop bound above.
                assert_ne!(
                    unsafe { GetAce(dacl, index, &mut ace_ptr) },
                    0,
                    "every ACE index below AceCount must be readable"
                );
                // Safety: `GetAce` just returned this pointer as a valid ACE
                // for the duration of `dacl`'s lifetime.
                let ace = unsafe { &*(ace_ptr as *const ACCESS_ALLOWED_ACE) };
                if ace.Header.AceType != ACCESS_ALLOWED_ACE_TYPE {
                    continue;
                }
                // Safety: for an `ACCESS_ALLOWED_ACE`, the trustee SID
                // begins in-place at `SidStart`, per the Win32 contract.
                let sid: PSID = std::ptr::addr_of!(ace.SidStart) as PSID;
                // Safety: `sid` points inside the live `dacl` buffer.
                if unsafe { IsValidSid(sid) } == 0 {
                    continue;
                }
                let mut sid_string: *mut u16 = std::ptr::null_mut();
                // Safety: `sid` was just validated above.
                if unsafe { ConvertSidToStringSidW(sid, &mut sid_string) } == 0 {
                    continue;
                }
                // Safety: `sid_string` was just set by the successful call
                // above.
                let sid_str = unsafe { wide_nul_terminated_to_string(sid_string) };
                unsafe {
                    LocalFree(sid_string as *mut c_void);
                }
                if sid_str == expected_sid {
                    names_expected_sid = true;
                }
            }
            unsafe {
                LocalFree(sd as *mut c_void);
            }
            assert!(
                names_expected_sid,
                "the created pipe's DACL must explicitly name this process's real \
                 TokenUser SID ({expected_sid}), not rely on OW or any other placeholder"
            );
        }
    }
}

#[cfg(windows)]
pub use windows_pipe::{NamedPipeConnection, NamedPipeListener, establish};

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::{Arc, Mutex};

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

    /// Host-agnostic unit test for the pure DACL-selection logic behind
    /// the Windows named-pipe ACL correction (ROOT seq 3304): given a
    /// `TokenUser` SID string, the SDDL must name that exact SID as the
    /// Generic-All trustee, never the old `OW` ("object owner") placeholder
    /// — see `dacl_sddl_for_user_sid`'s doc for why `OW` was replaced. This
    /// runs on every host, including this one, because it exercises only
    /// string formatting; the real Windows kernel-DACL behavior (that the
    /// created pipe's actual security descriptor names this SID) is
    /// separately covered by
    /// `windows_pipe::tests::created_pipe_dacl_names_the_actual_tokenuser_sid_not_a_placeholder`,
    /// which is Windows-gated because it calls real Win32 APIs.
    #[test]
    fn dacl_sddl_for_user_sid_names_the_given_sid_directly_never_ow() {
        let sid = "S-1-5-21-111111111-222222222-333333333-1001";
        let sddl = dacl_sddl_for_user_sid(sid);
        assert_eq!(sddl, format!("D:P(A;;GA;;;{sid})(A;;GA;;;SY)"));
    }

    #[test]
    fn dacl_sddl_for_user_sid_differs_across_distinct_sids() {
        let a = dacl_sddl_for_user_sid("S-1-5-21-1-1-1-1000");
        let b = dacl_sddl_for_user_sid("S-1-5-21-2-2-2-1001");
        assert_ne!(
            a, b,
            "the DACL must name the specific SID it was given, not a fixed/shared string"
        );
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

    // `SharedTransportState` is the pure state machine behind the Windows
    // `NamedPipeConnection`'s shutdown/disconnect bookkeeping (see its doc
    // above). It is generic over the handle-identifier type specifically so
    // these transitions run on every host, not only a Windows runner — none
    // of the following does any actual I/O or touches a Windows type.

    #[test]
    fn new_group_starts_open_with_exactly_its_initial_handle_live() {
        let state = SharedTransportState::new(1u32);
        assert!(!state.is_closed());
        assert_eq!(state.live_handles(), vec![1]);
    }

    #[test]
    fn mark_closed_fences_every_clone_not_just_the_caller() {
        let mut state = SharedTransportState::new(1u32);
        state.add(2);
        assert!(!state.is_closed());
        state.mark_closed();
        // The fence is a property of the whole group: any clone's `is_closed`
        // observes it, regardless of which handle called `mark_closed`.
        assert!(state.is_closed());
        assert_eq!(
            state.live_handles(),
            vec![1, 2],
            "closing must not itself drop live handles; cancellation is separate"
        );
    }

    #[test]
    fn every_duplicate_is_tracked_for_cancellation() {
        let mut state = SharedTransportState::new(10u32);
        state.add(20);
        state.add(30);
        assert_eq!(
            state.live_handles(),
            vec![10, 20, 30],
            "shutdown_both must be able to cancel every live duplicate, not only one"
        );
    }

    #[test]
    fn disconnect_fires_exactly_once_for_the_final_owner() {
        let mut state = SharedTransportState::new(1u32);
        state.add(2);
        state.add(3);
        assert!(
            !state.remove_and_is_last(1),
            "two siblings remain live; dropping this one must not disconnect the shared pipe"
        );
        assert!(
            !state.remove_and_is_last(2),
            "one sibling remains live; still not the final owner"
        );
        assert!(
            state.remove_and_is_last(3),
            "the last live handle must report itself as the final owner"
        );
    }

    #[test]
    fn removing_an_unknown_handle_is_a_harmless_no_op() {
        let mut state = SharedTransportState::new(1u32);
        assert!(
            !state.remove_and_is_last(999),
            "an unrelated handle must not be mistaken for the last live one"
        );
        assert_eq!(state.live_handles(), vec![1]);
    }

    /// Host-agnostic stress test of the pure state machine both Windows
    /// race fixes depend on (see `SharedTransportState`'s doc, invariant
    /// 4): `run_overlapped_guarded` and `shutdown_both` (both `cfg(windows)`
    /// only, in the `windows_pipe` module below) rely on this `Mutex`-
    /// guarded structure staying internally consistent when `try_clone`
    /// (`add`), `Drop` (`remove_and_is_last`) and `shutdown_both`
    /// (`mark_closed` + `live_handles`) all touch it from different threads
    /// concurrently — exactly the production shape (a handler thread's
    /// read/write handle, its write-half clone, and the registry's tracking
    /// clone). This is the lock-ordering logic separable from the
    /// Windows-kernel-timing half of each fix (real `HANDLE`/overlapped I/O
    /// race timing, which only V5's Windows runner can exercise, see the
    /// two host-gated tests in `windows_pipe::tests` below), so it runs
    /// under real thread contention on every host: `u32` identifiers, no
    /// Windows type or real I/O anywhere.
    #[test]
    fn shared_transport_state_bookkeeping_stays_consistent_under_real_thread_contention() {
        let state = Arc::new(Mutex::new(SharedTransportState::new(0u32)));
        let next_id = Arc::new(AtomicU32::new(1));

        let adders: Vec<_> = (0..4)
            .map(|_| {
                let state = Arc::clone(&state);
                let next_id = Arc::clone(&next_id);
                std::thread::spawn(move || {
                    for _ in 0..200 {
                        let id = next_id.fetch_add(1, Ordering::SeqCst);
                        state.lock().unwrap().add(id);
                        // Mirrors a short-lived duplicate's add-then-Drop —
                        // never asserts `is_last` here, since a concurrent
                        // `mark_closed`/`live_handles` snapshot from the
                        // `closer` thread below makes that outcome
                        // legitimately racy; only that this never panics
                        // and the id ends up removed either way.
                        state.lock().unwrap().remove_and_is_last(id);
                    }
                })
            })
            .collect();

        let closer = {
            let state = Arc::clone(&state);
            std::thread::spawn(move || {
                for _ in 0..50 {
                    let mut guard = state.lock().unwrap();
                    guard.mark_closed();
                    let _ = guard.live_handles();
                }
            })
        };

        for adder in adders {
            adder.join().unwrap();
        }
        closer.join().unwrap();

        let guard = state.lock().unwrap();
        assert!(
            guard.is_closed(),
            "the closer thread always ran mark_closed at least once"
        );
        assert_eq!(
            guard.live_handles(),
            vec![0],
            "every added-then-removed duplicate must leave no residue behind; \
             only the original handle from `new` remains live"
        );
    }
}
