//! `drogond`: the native-IPC service process. Owns SQLite and PTYs via
//! `drogon-core::Engine`; this crate is only framing, auth and endpoint
//! ownership. No Electron dependency anywhere in this crate.

pub mod auth;
#[cfg(unix)]
pub mod endpoint;
pub mod framing;
#[cfg(unix)]
pub mod lock;
pub mod server;

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
/// file while this instance is mid-startup.
#[cfg(unix)]
pub fn serve(data_dir: &Path) -> Result<(), ServeError> {
    std::fs::create_dir_all(data_dir).map_err(ServeError::Io)?;
    reject_unsafe_data_dir(data_dir).map_err(ServeError::Io)?;
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(data_dir, std::fs::Permissions::from_mode(0o700))
            .map_err(ServeError::Io)?;
    }

    let _lock = lock::acquire_exclusive(data_dir).map_err(ServeError::Io)?;
    let listener = endpoint::establish(data_dir).map_err(ServeError::Io)?;
    let token = auth::ensure_token(data_dir).map_err(ServeError::Io)?;
    let engine = Arc::new(Engine::open(data_dir).map_err(ServeError::Engine)?);
    server::accept_loop(listener, engine, Arc::from(token.as_str()));
    // `_lock` is held for this entire call, released only on process exit
    // or an early `?` return above.
    Ok(())
}

/// Refuses a data directory that is itself a symlink — following it would
/// mean this process's notion of "the data directory" and the path a
/// symlink attack redirected it to could silently diverge from what a
/// caller passed on the command line.
#[cfg(unix)]
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

/// Windows has no implementation in this slice: named pipes are a distinct
/// mechanism from the endpoint-ownership protocol above and have not been
/// written or tested. Returning a typed error here — rather than a stub
/// that silently binds nothing — is required by this task's instruction to
/// never claim unsupported Windows parity.
#[cfg(not(unix))]
pub fn serve(_data_dir: &Path) -> Result<(), ServeError> {
    Err(ServeError::UnsupportedPlatform)
}
