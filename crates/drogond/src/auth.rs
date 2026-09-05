//! Per-instance auth token. `protocol-v1.md`: "a random token stored in the
//! private data directory. Never echo the token or inherit it into harness
//! environment." A fresh token is minted every `drogond` start; nothing
//! about session recovery depends on the token surviving a restart.

use std::io::{self, Read, Write};
use std::path::Path;

pub const TOKEN_FILE_NAME: &str = "auth.token";

/// Writes a fresh token and atomically publishes it at `auth.token`. Uses
/// `create_new` on a unique scratch name (never opens or truncates through
/// an existing path) followed by `rename` (which replaces whatever
/// directory entry is at the destination — including a symlink — rather
/// than following it), so a pre-existing symlink at the token path can
/// never redirect the write.
pub fn ensure_token(data_dir: &Path) -> io::Result<String> {
    let token = random_token()?;
    let path = data_dir.join(TOKEN_FILE_NAME);
    let scratch = data_dir.join(format!(".token-{}.tmp", std::process::id()));
    let _ = std::fs::remove_file(&scratch);
    {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&scratch)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        }
        file.write_all(token.as_bytes())?;
        file.sync_all()?;
    }
    std::fs::rename(&scratch, &path)?;
    Ok(token)
}

fn random_token() -> io::Result<String> {
    let mut buf = [0u8; 32];
    #[cfg(unix)]
    {
        // `/dev/urandom` is the portable CSPRNG source across macOS/Linux
        // without adding a `rand`/`getrandom` dependency to the workspace.
        std::fs::File::open("/dev/urandom")?.read_exact(&mut buf)?;
    }
    #[cfg(not(unix))]
    {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "token generation is not implemented on this platform yet",
        ));
    }
    #[allow(unreachable_code)]
    {
        use base64::Engine as _;
        Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_long_and_distinct() {
        let dir = tempfile::tempdir().unwrap();
        let a = ensure_token(dir.path()).unwrap();
        let b = ensure_token(dir.path()).unwrap();
        assert!(a.len() >= 32);
        assert_ne!(a, b, "each drogond start mints a fresh token");
    }
}
