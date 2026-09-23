//! Cross-process half of a live service handoff
//! (`drogon_core::session_handoff` is the engine half).
//!
//! After an admitted `runtime.handoff` the predecessor stops serving and
//! offers its parked sessions on `<data-dir>/handoff.sock`. A successor
//! started with `--adopt-handoff` connects, proves it may (the same
//! `auth.token` any client presents), and receives the package and every
//! PTY master descriptor (`SCM_RIGHTS`). The ordering is what keeps the
//! sessions alive whatever fails:
//!
//! 1. predecessor → successor: header, package, descriptors;
//! 2. successor → predecessor: `received`; the predecessor releases the
//!    data-dir lock but keeps its own copies of the descriptors;
//! 3. the successor locks the data dir, binds the endpoint, opens its
//!    engine and adopts; then → predecessor: `serving`;
//! 4. the predecessor exits without running a single destructor that could
//!    touch a PTY.
//!
//! If no successor connects, or it disappears before `serving`, the
//! predecessor takes the lock back and resumes every session where it
//! paused. Only a successor that holds the lock yet never confirms leaves
//! the predecessor nothing to resume; it then exits and the successor,
//! which holds the descriptors, owns the sessions.

use std::io::{self, Read, Write};
use std::os::fd::{FromRawFd, OwnedFd, RawFd};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::time::{Duration, Instant};

use drogon_core::Engine;
use drogon_core::session_handoff::IncomingHandoff;
use serde_json::{Value, json};

use crate::lock::DataDirLock;

pub const HANDOFF_SOCKET_NAME: &str = "handoff.sock";

/// Descriptors per `sendmsg`; well under every platform's per-message cap.
const FDS_PER_MESSAGE: usize = 32;

/// Upper bound for one control frame; the package frame is unbounded
/// (sessions × ring size) and length-prefixed like the rest.
const MAX_CONTROL_FRAME: usize = 64 * 1024;

/// How long each side waits for the other. Overridable for tests through
/// `DROGON_HANDOFF_WAIT_MS` (the successor's connect wait and the
/// predecessor's accept wait). The predecessor waits longer than a
/// successor does: it offers the moment its listener stops, while the
/// successor is started only after the `runtime.handoff` reply arrives.
#[derive(Clone, Copy, Debug)]
pub struct HandoffTimings {
    /// Predecessor: how long to wait for a successor to connect.
    pub accept: Duration,
    /// Either side: bound on a single exchange step.
    pub step: Duration,
    /// Predecessor: how long a successor may take to start serving.
    pub serving: Duration,
    /// Successor: how long to keep trying to reach the predecessor.
    pub connect: Duration,
}

impl Default for HandoffTimings {
    fn default() -> Self {
        let wait = std::env::var("DROGON_HANDOFF_WAIT_MS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .map(Duration::from_millis);
        Self {
            accept: wait.unwrap_or(Duration::from_secs(30)),
            step: Duration::from_secs(10),
            serving: Duration::from_secs(30),
            connect: wait.unwrap_or(Duration::from_secs(10)),
        }
    }
}

/// How an offered handoff ended for the predecessor.
pub enum OfferOutcome {
    /// The successor serves every session: exit now, touching nothing.
    Transferred,
    /// Nobody took the sessions: resume them (the lock is ours again).
    Resume(DataDirLock),
    /// A successor holds the lock and the descriptors but never confirmed:
    /// nothing here can be resumed; exit and leave the sessions to it.
    Abandoned,
}

/// Predecessor side. `lock` is held on entry and returned when resuming.
pub fn offer(
    data_dir: &Path,
    engine: &Engine,
    token: &str,
    lock: DataDirLock,
    timings: HandoffTimings,
) -> OfferOutcome {
    let log =
        |message: String| drogon_core::diagnostics::log_line(format_args!("handoff: {message}"));
    let outgoing = match engine.handoff_outgoing() {
        Ok(outgoing) => outgoing,
        Err(error) => {
            log(format!("nothing to offer: {}", error.message));
            return OfferOutcome::Resume(lock);
        }
    };
    let path = data_dir.join(HANDOFF_SOCKET_NAME);
    let listener = match bind_private(&path) {
        Ok(listener) => listener,
        Err(error) => {
            log(format!("cannot open {}: {error}", path.display()));
            return OfferOutcome::Resume(lock);
        }
    };
    let result = (|| -> io::Result<UnixStream> {
        let mut stream = accept_before(&listener, Instant::now() + timings.accept)?;
        stream.set_read_timeout(Some(timings.step))?;
        stream.set_write_timeout(Some(timings.step))?;
        let hello = read_control(&mut stream)?;
        if hello["token"].as_str() != Some(token) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "successor did not present this service's token",
            ));
        }
        write_frame(
            &mut stream,
            &serde_json::to_vec(&json!({ "sessions": outgoing.fds.len() })).unwrap(),
        )?;
        write_frame(&mut stream, &outgoing.package)?;
        send_fds(&stream, &outgoing.fds)?;
        expect(&mut stream, "received")?;
        Ok(stream)
    })();
    let _ = std::fs::remove_file(&path);
    drop(listener);
    let mut stream = match result {
        Ok(stream) => stream,
        Err(error) => {
            log(format!(
                "no successor took the sessions ({error}); resuming"
            ));
            return OfferOutcome::Resume(lock);
        }
    };
    log(format!(
        "successor received {} session(s): {}",
        outgoing.session_ids.len(),
        outgoing.session_ids.join(", ")
    ));
    // The successor may lock the directory now; this process keeps its own
    // descriptors, so the sessions survive whichever side fails next.
    drop(lock);
    let _ = stream.set_read_timeout(Some(timings.serving));
    match expect(&mut stream, "serving") {
        Ok(()) => {
            log("successor is serving; exiting".into());
            OfferOutcome::Transferred
        }
        Err(error) => {
            log(format!("successor never confirmed ({error})"));
            let deadline = Instant::now() + timings.step;
            loop {
                match crate::lock::acquire_exclusive(data_dir) {
                    Ok(lock) => {
                        log("the data directory is ours again; resuming".into());
                        return OfferOutcome::Resume(lock);
                    }
                    Err(_) if Instant::now() < deadline => {
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    Err(_) => {
                        log("the successor still holds the data directory; leaving the sessions to it".into());
                        return OfferOutcome::Abandoned;
                    }
                }
            }
        }
    }
}

/// The successor's open line to its predecessor, kept until it serves.
pub struct Predecessor {
    stream: UnixStream,
}

impl Predecessor {
    /// Tells the predecessor this process now serves its sessions.
    pub fn confirm_serving(mut self) -> io::Result<()> {
        write_control(&mut self.stream, &json!({ "step": "serving" }))
    }
}

/// Successor side: takes the offered sessions, if a predecessor offers any
/// before `timings.connect` runs out. `Ok(None)` means nobody offered.
pub fn receive(
    data_dir: &Path,
    timings: HandoffTimings,
) -> io::Result<Option<(IncomingHandoff, Predecessor)>> {
    let path = data_dir.join(HANDOFF_SOCKET_NAME);
    let deadline = Instant::now() + timings.connect;
    let mut stream = loop {
        match UnixStream::connect(&path) {
            Ok(stream) => break stream,
            Err(_) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => return Ok(None),
        }
    };
    stream.set_read_timeout(Some(timings.step))?;
    stream.set_write_timeout(Some(timings.step))?;
    let token = std::fs::read_to_string(data_dir.join(crate::auth::TOKEN_FILE_NAME))?;
    write_control(&mut stream, &json!({ "token": token.trim() }))?;
    let header = read_control(&mut stream)?;
    let count = header["sessions"]
        .as_u64()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "handoff header has no count"))?
        as usize;
    let package = read_frame(&mut stream, usize::MAX)?;
    let fds = recv_fds(&stream, count)?;
    let incoming = IncomingHandoff::parse(&package, fds)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.message))?;
    write_control(&mut stream, &json!({ "step": "received" }))?;
    Ok(Some((incoming, Predecessor { stream })))
}

fn bind_private(path: &Path) -> io::Result<UnixListener> {
    // Only one service can be here: this process holds the data-dir lock,
    // so any existing file is a leftover of an earlier handoff.
    let _ = std::fs::remove_file(path);
    let listener = UnixListener::bind(path)?;
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    listener.set_nonblocking(true)?;
    Ok(listener)
}

fn accept_before(listener: &UnixListener, deadline: Instant) -> io::Result<UnixStream> {
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                stream.set_nonblocking(false)?;
                return Ok(stream);
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "no successor connected",
                    ));
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(error) => return Err(error),
        }
    }
}

fn expect(stream: &mut UnixStream, step: &str) -> io::Result<()> {
    let message = read_control(stream)?;
    if message["step"].as_str() == Some(step) {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("expected `{step}`, got {message}"),
        ))
    }
}

fn write_control(stream: &mut UnixStream, value: &Value) -> io::Result<()> {
    write_frame(stream, &serde_json::to_vec(value).unwrap())
}

fn read_control(stream: &mut UnixStream) -> io::Result<Value> {
    let frame = read_frame(stream, MAX_CONTROL_FRAME)?;
    serde_json::from_slice(&frame).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

fn write_frame(stream: &mut UnixStream, bytes: &[u8]) -> io::Result<()> {
    stream.write_all(&(bytes.len() as u64).to_be_bytes())?;
    stream.write_all(bytes)?;
    stream.flush()
}

fn read_frame(stream: &mut UnixStream, limit: usize) -> io::Result<Vec<u8>> {
    let mut length = [0u8; 8];
    stream.read_exact(&mut length)?;
    let length = u64::from_be_bytes(length) as usize;
    if length > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "handoff frame too large",
        ));
    }
    let mut bytes = vec![0u8; length];
    stream.read_exact(&mut bytes)?;
    Ok(bytes)
}

/// Sends `fds` in order, a batch per message, each message carrying one
/// payload byte (a stream socket will not deliver ancillary data alone).
fn send_fds(stream: &UnixStream, fds: &[RawFd]) -> io::Result<()> {
    use std::os::fd::AsRawFd;
    for batch in fds.chunks(FDS_PER_MESSAGE) {
        let payload_len = std::mem::size_of_val(batch);
        // SAFETY: CMSG_SPACE is a pure size computation.
        let space = unsafe { libc::CMSG_SPACE(payload_len as u32) } as usize;
        let mut control = vec![0u64; space.div_ceil(8)];
        let mut byte = [batch.len() as u8];
        let mut iov = libc::iovec {
            iov_base: byte.as_mut_ptr().cast(),
            iov_len: 1,
        };
        let mut message: libc::msghdr = unsafe { std::mem::zeroed() };
        message.msg_iov = &mut iov;
        message.msg_iovlen = 1;
        message.msg_control = control.as_mut_ptr().cast();
        message.msg_controllen = space as _;
        // SAFETY: the control buffer is `space` bytes, enough for one
        // header carrying `batch`, and the header pointer comes from it.
        unsafe {
            let header = libc::CMSG_FIRSTHDR(&message);
            (*header).cmsg_level = libc::SOL_SOCKET;
            (*header).cmsg_type = libc::SCM_RIGHTS;
            (*header).cmsg_len = libc::CMSG_LEN(payload_len as u32) as _;
            std::ptr::copy_nonoverlapping(
                batch.as_ptr().cast::<u8>(),
                libc::CMSG_DATA(header),
                payload_len,
            );
        }
        // SAFETY: `message` points at live buffers for the whole call.
        let sent = unsafe { libc::sendmsg(stream.as_raw_fd(), &message, 0) };
        if sent != 1 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}

/// Receives exactly `count` descriptors sent by [`send_fds`], marking each
/// close-on-exec so no later session child inherits a sibling's PTY.
fn recv_fds(stream: &UnixStream, count: usize) -> io::Result<Vec<OwnedFd>> {
    use std::os::fd::AsRawFd;
    let mut received = Vec::with_capacity(count);
    while received.len() < count {
        let expected = (count - received.len()).min(FDS_PER_MESSAGE);
        let payload_len = expected * std::mem::size_of::<RawFd>();
        // SAFETY: pure size computation.
        let space = unsafe { libc::CMSG_SPACE(payload_len as u32) } as usize;
        let mut control = vec![0u64; space.div_ceil(8)];
        let mut byte = [0u8; 1];
        let mut iov = libc::iovec {
            iov_base: byte.as_mut_ptr().cast(),
            iov_len: 1,
        };
        let mut message: libc::msghdr = unsafe { std::mem::zeroed() };
        message.msg_iov = &mut iov;
        message.msg_iovlen = 1;
        message.msg_control = control.as_mut_ptr().cast();
        message.msg_controllen = space as _;
        // SAFETY: `message` points at live buffers for the whole call.
        let read = unsafe { libc::recvmsg(stream.as_raw_fd(), &mut message, 0) };
        if read != 1 {
            return Err(if read == 0 {
                io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "predecessor closed mid-handoff",
                )
            } else {
                io::Error::last_os_error()
            });
        }
        let before = received.len();
        // SAFETY: walking the control buffer the kernel just filled.
        unsafe {
            let mut header = libc::CMSG_FIRSTHDR(&message);
            while !header.is_null() {
                if (*header).cmsg_level == libc::SOL_SOCKET
                    && (*header).cmsg_type == libc::SCM_RIGHTS
                {
                    let data_len = (*header).cmsg_len as usize - libc::CMSG_LEN(0) as usize;
                    let data = libc::CMSG_DATA(header).cast::<RawFd>();
                    for index in 0..data_len / std::mem::size_of::<RawFd>() {
                        let fd = std::ptr::read_unaligned(data.add(index));
                        libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC);
                        received.push(OwnedFd::from_raw_fd(fd));
                    }
                }
                header = libc::CMSG_NXTHDR(&message, header);
            }
        }
        if message.msg_flags & libc::MSG_CTRUNC != 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "descriptors were truncated",
            ));
        }
        if received.len() - before != usize::from(byte[0]) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "a handoff message carried the wrong number of descriptors",
            ));
        }
    }
    Ok(received)
}
