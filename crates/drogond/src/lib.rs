//! `drogond`: the native-IPC service process. Owns SQLite and PTYs via
//! `drogon-core::Engine`; this crate is only framing, auth and endpoint
//! ownership. No Electron dependency anywhere in this crate.

pub mod auth;
pub mod endpoint;
pub mod framing;
#[cfg(unix)]
pub mod handoff;
pub mod lock;
pub mod server;
pub mod service_quiescence;

use std::path::Path;
use std::sync::Arc;

use drogon_core::Engine;

#[derive(Debug)]
pub enum ServeError {
    UnsupportedPlatform,
    Io(std::io::Error),
    Engine(drogon_protocol::RpcError),
}

impl std::fmt::Display for ServeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ServeError::UnsupportedPlatform => write!(
                f,
                "this platform's native IPC transport is not implemented yet; \
                 see docs/migration/core-implementation.md"
            ),
            ServeError::Io(e) => write!(f, "{e}"),
            ServeError::Engine(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for ServeError {}

/// Binds the endpoint, opens the engine, and serves forever. Blocking; the
/// caller (typically `main`) runs this on its own thread.
///
/// Ordering matters: the exclusive data-dir lock is acquired *before*
/// anything else touches the directory, so a second `drogond` racing to
/// start against the same `--data-dir` fails immediately at the lock rather
/// than possibly winning a narrower race on the socket path or the token
/// file while this instance is mid-startup. Managed restart waits for the
/// incumbent endpoint to disappear before launching its replacement; startup
/// itself must never wait behind an owned directory.
#[cfg(unix)]
pub fn serve(data_dir: &Path) -> Result<(), ServeError> {
    serve_with(data_dir, ServeOptions::default())
}

/// How `drogond` starts. `adopt_handoff`: take over the sessions a running
/// predecessor offers after an admitted `runtime.handoff` (see
/// [`handoff`]). With no offer before the wait runs out the process exits
/// instead of starting normally: it was started to replace a service that
/// has since resumed, and must not linger to race a later restart for the
/// data directory.
#[derive(Clone, Copy, Debug, Default)]
pub struct ServeOptions {
    pub adopt_handoff: bool,
}

#[cfg(unix)]
pub fn serve_with(data_dir: &Path, options: ServeOptions) -> Result<(), ServeError> {
    std::fs::create_dir_all(data_dir).map_err(ServeError::Io)?;
    reject_unsafe_data_dir(data_dir).map_err(ServeError::Io)?;
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(data_dir, std::fs::Permissions::from_mode(0o700))
            .map_err(ServeError::Io)?;
    }

    let timings = handoff::HandoffTimings::default();
    // A successor receives the sessions first — it holds their descriptors
    // before it can hold the lock, which the predecessor only releases once
    // the transfer arrived.
    let incoming = if options.adopt_handoff {
        let offered = handoff::receive(data_dir, timings).map_err(ServeError::Io)?;
        if offered.is_none() {
            return Err(ServeError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "--adopt-handoff: no running service offered its sessions",
            )));
        }
        offered
    } else {
        None
    };
    let mut lock = if incoming.is_some() {
        lock::acquire_exclusive_within(data_dir, timings.step).map_err(ServeError::Io)?
    } else {
        lock::acquire_exclusive(data_dir).map_err(ServeError::Io)?
    };
    let mut listener = endpoint::establish(data_dir).map_err(ServeError::Io)?;
    let mut token = auth::ensure_token(data_dir).map_err(ServeError::Io)?;
    let adopting = incoming
        .as_ref()
        .map(|(incoming, _)| incoming.verified_live())
        .unwrap_or_default();
    let engine = Engine::open_adopting(data_dir, &adopting).map_err(|mut e| {
        e.message = format!("{} (data dir: {})", e.message, data_dir.display());
        ServeError::Engine(e)
    })?;
    let engine = Arc::new(configure_worker_cli(engine)?);
    move_diagnostics_to_log(data_dir);
    if let Some((incoming, predecessor)) = incoming {
        let from = incoming.from_service_instance_id().to_string();
        let report = engine.adopt_handoff(incoming);
        drogon_core::diagnostics::log_line(format_args!(
            "handoff: took over from {from}: adopted {:?}, already exited {:?}, skipped {:?}",
            report.adopted, report.exited, report.skipped
        ));
        // The endpoint is bound and every session is ours: the predecessor
        // may go. A failed confirmation only means it resumes or has gone.
        if let Err(error) = predecessor.confirm_serving() {
            drogon_core::diagnostics::log_line(format_args!(
                "handoff: could not confirm to the predecessor: {error}"
            ));
        }
    }
    loop {
        let mut graph_scheduler = drogon_core::graph::orchestrator::spawn(engine.clone());
        // Daemon-owned automation tick loop (R2-B): a plain OS thread polling
        // every 15 s. It exits on engine quiescence or here on serve exit.
        let mut scheduler = drogon_core::automations::scheduler::spawn(
            engine.clone(),
            drogon_core::automations::scheduler::TICK_INTERVAL,
        );
        // Transient accept errors are retried with backoff inside the loop, up
        // to a bounded consecutive-error budget; a fatal listener failure or an
        // exhausted budget surfaces here, and either must end the process with
        // a failure rather than silently stop serving.
        let result = server::accept_loop(listener, engine.clone(), Arc::from(token.as_str()))
            .map_err(ServeError::Io);
        scheduler.shutdown();
        graph_scheduler.shutdown();
        result?;
        if !engine.handoff_requested() {
            // `lock` is held for this entire call, released only on process
            // exit or an early `?` return above.
            drop(lock);
            return Ok(());
        }
        match handoff::offer(data_dir, &engine, &token, lock, timings) {
            // Exit here, before any destructor runs: dropping a session's
            // PTY writer sends EOF to the child the successor now serves.
            handoff::OfferOutcome::Transferred | handoff::OfferOutcome::Abandoned => {
                std::process::exit(0)
            }
            handoff::OfferOutcome::Resume(relocked) => {
                lock = relocked;
                listener = endpoint::establish(data_dir).map_err(ServeError::Io)?;
                // A successor that got as far as its own startup rewrote the
                // token; clients read the file, so this instance must match.
                token = auth::ensure_token(data_dir).map_err(ServeError::Io)?;
                engine.resume_after_handoff();
            }
        }
    }
}

/// Windows counterpart of the `serve` above, added under the root grant.
/// Same shape and ordering (lock, then endpoint, then token, then engine,
/// then the accept loop) for the same reason: the exclusive lock must be
/// acquired before anything else touches the directory. No explicit
/// same-user permission hardening is applied to the data directory or lock
/// file here (unlike the Unix side's `0700`/`0600`): doing so would need
/// new Windows ACL-setting FFI beyond what `endpoint.rs`'s pipe DACL already
/// justifies, which is out of scope for this pass — see the evidence doc.
/// This relies on the data directory's inherited NTFS ACLs (from the user
/// profile it lives under) for now.
#[cfg(windows)]
pub fn serve_with(data_dir: &Path, _options: ServeOptions) -> Result<(), ServeError> {
    serve(data_dir)
}

#[cfg(windows)]
pub fn serve(data_dir: &Path) -> Result<(), ServeError> {
    std::fs::create_dir_all(data_dir).map_err(ServeError::Io)?;
    reject_unsafe_data_dir(data_dir).map_err(ServeError::Io)?;
    let _lock = lock::acquire_exclusive(data_dir).map_err(ServeError::Io)?;
    let listener = endpoint::establish(data_dir).map_err(ServeError::Io)?;
    let token = auth::ensure_token(data_dir).map_err(ServeError::Io)?;
    let engine = open_engine_naming_data_dir(data_dir)?;
    let engine = Arc::new(configure_worker_cli(engine)?);
    move_diagnostics_to_log(data_dir);
    let mut graph_scheduler = drogon_core::graph::orchestrator::spawn(engine.clone());
    // Daemon-owned automation tick loop (R2-B); see the Unix serve above.
    let mut scheduler = drogon_core::automations::scheduler::spawn(
        engine.clone(),
        drogon_core::automations::scheduler::TICK_INTERVAL,
    );
    let result =
        server::accept_loop(listener, engine, Arc::from(token.as_str())).map_err(ServeError::Io);
    scheduler.shutdown();
    graph_scheduler.shutdown();
    result?;
    Ok(())
}

/// Every startup refusal above went to the stderr the spawner gave us — the
/// desktop reads that pipe to explain a daemon that died early. From here on
/// the process is a long-lived service that outlives the desktop which
/// spawned it, so its diagnostics move to `logs/drogond.log` under the data
/// directory: a pipe whose reader has gone away turns every `eprintln!` into
/// a panic, which is how the automation scheduler once died silently after
/// a desktop relaunch. When the log cannot be opened the pipe stays, and the
/// loops that matter log through the non-panicking writer anyway.
fn move_diagnostics_to_log(data_dir: &Path) {
    let path = drogon_core::diagnostics::log_path(data_dir);
    drogon_core::diagnostics::log_line(format_args!(
        "drogond: diagnostics continue in {}",
        path.display()
    ));
    match drogon_core::diagnostics::redirect_stderr_to_log(data_dir) {
        Ok(path) => drogon_core::diagnostics::log_line(format_args!(
            "drogond {} (pid {}) serving {} — log opened at {}",
            env!("CARGO_PKG_VERSION"),
            std::process::id(),
            data_dir.display(),
            path.display()
        )),
        Err(error) => drogon_core::diagnostics::log_line(format_args!(
            "drogond: diagnostics stay on the inherited stderr; the log could not be opened: {error}"
        )),
    }
}

/// Cross-platform: the daemon's installed sibling worker CLI is named
/// `drogon-cli` on Unix and `drogon-cli.exe` on Windows;
/// `std::env::consts::EXE_SUFFIX` is `""`/`".exe"` respectively, so one
/// implementation covers both rather than a per-platform cfg branch that
/// could drift.
fn configure_worker_cli(engine: Engine) -> Result<Engine, ServeError> {
    // Only the daemon's installed sibling is trusted, never cwd or inherited PATH.
    let executable = std::env::current_exe().map_err(ServeError::Io)?;
    let parent = executable
        .parent()
        .ok_or_else(|| ServeError::Io(std::io::Error::other("Daemon executable has no parent.")))?;
    let cli = parent.join(format!("drogon-cli{}", std::env::consts::EXE_SUFFIX));
    match std::fs::metadata(&cli) {
        Ok(_) => engine.with_worker_cli(&cli).map_err(ServeError::Engine),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(engine),
        Err(error) => Err(ServeError::Io(error)),
    }
}

/// Opens the engine; on failure the error message names the data dir, so a
/// schema-version refusal printed by `drogond` (and surfaced by the desktop
/// bootstrap) tells the user *which* directory a newer build wrote and what
/// not to touch — instead of a bare "schema version 4 is newer".
pub fn open_engine_naming_data_dir(data_dir: &Path) -> Result<Engine, ServeError> {
    Engine::open(data_dir).map_err(|mut e| {
        e.message = format!("{} (data dir: {})", e.message, data_dir.display());
        ServeError::Engine(e)
    })
}

/// Refuses a data directory that is itself a symlink — following it would
/// mean this process's notion of "the data directory" and the path a
/// symlink attack redirected it to could silently diverge from what a
/// caller passed on the command line. Cross-platform: `symlink_metadata`
/// and `is_symlink` both recognize a Windows reparse-point symlink the same
/// way they recognize a Unix one; no platform-specific API was needed here.
fn reject_unsafe_data_dir(data_dir: &Path) -> std::io::Result<()> {
    let meta = std::fs::symlink_metadata(data_dir)?;
    if meta.file_type().is_symlink() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "refusing a symlinked --data-dir",
        ));
    }
    Ok(())
}

/// Neither Unix nor Windows: no native IPC transport is implemented for
/// this target. Returning a typed error here — rather than a stub that
/// silently binds nothing — is required by this task's instruction to
/// never claim unsupported platform parity.
#[cfg(not(any(unix, windows)))]
pub fn serve(_data_dir: &Path) -> Result<(), ServeError> {
    Err(ServeError::UnsupportedPlatform)
}

#[cfg(not(any(unix, windows)))]
pub fn serve_with(_data_dir: &Path, _options: ServeOptions) -> Result<(), ServeError> {
    Err(ServeError::UnsupportedPlatform)
}
