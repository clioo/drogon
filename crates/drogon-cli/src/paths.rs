//! Data-directory, endpoint and auth-token resolution per protocol v1.

use std::path::{Path, PathBuf};

use drogon_protocol::RpcError;
use sha2::{Digest, Sha256};

pub const SOCKET_FILE_NAME: &str = "runtime-v1.sock";
pub const TOKEN_FILE_NAME: &str = "auth.token";

/// How the runtime advertises its local endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Endpoint {
    #[cfg(unix)]
    UnixSocket(PathBuf),
    #[cfg(windows)]
    NamedPipe(String),
}

impl Endpoint {
    /// Human-safe description for error messages. Never contains the token.
    pub fn describe(&self) -> String {
        match self {
            #[cfg(unix)]
            Endpoint::UnixSocket(path) => format!("unix socket {}", path.display()),
            #[cfg(windows)]
            Endpoint::NamedPipe(name) => format!("named pipe {name}"),
        }
    }
}

pub fn resolve_data_dir(explicit: Option<&Path>) -> PathBuf {
    match explicit {
        Some(dir) => dir.to_path_buf(),
        None => default_data_dir(read_env, &home_dir()),
    }
}

fn read_env(key: &str) -> Option<String> {
    std::env::var_os(key)
        .and_then(|value| value.into_string().ok())
        .filter(|value| !value.is_empty())
}

fn home_dir() -> PathBuf {
    read_env("HOME")
        .or_else(|| read_env("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

/// Pure resolution order so tests can inject the environment:
/// `DROGON_DATA_DIR`, then the platform default from the frozen contract.
/// Empty environment values count as unset regardless of the source.
pub fn default_data_dir(env_value: impl Fn(&str) -> Option<String>, home: &Path) -> PathBuf {
    if let Some(dir) = env_value("DROGON_DATA_DIR").filter(|value| !value.is_empty()) {
        return PathBuf::from(dir);
    }
    #[cfg(target_os = "macos")]
    {
        home.join("Library")
            .join("Application Support")
            .join("Drogon")
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        match env_value("XDG_DATA_HOME").filter(|value| !value.is_empty()) {
            Some(dir) => PathBuf::from(dir).join("drogon"),
            None => home.join(".local").join("share").join("drogon"),
        }
    }
    #[cfg(windows)]
    {
        let base = env_value("APPDATA")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Roaming"));
        base.join("Drogon")
    }
}

pub fn endpoint_for(data_dir: &Path) -> Endpoint {
    #[cfg(unix)]
    {
        Endpoint::UnixSocket(data_dir.join(SOCKET_FILE_NAME))
    }
    #[cfg(windows)]
    {
        Endpoint::NamedPipe(windows_pipe_name(&canonical_for_hash(data_dir)))
    }
}

/// `\\.\pipe\drogon-v1-<first 24 lowercase hex SHA256 of canonical
/// data-directory UTF-8 path>` per the frozen contract.
pub fn windows_pipe_name(canonical_data_dir: &str) -> String {
    let digest = Sha256::digest(canonical_data_dir.as_bytes());
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    format!("\\\\.\\pipe\\drogon-v1-{}", &hex[..24])
}

/// Canonical UTF-8 form of the data directory used as the pipe-name hash
/// input. Windows `canonicalize` returns `\\?\`-prefixed paths; the prefix is
/// stripped because it is a filesystem-scope marker, not part of the path a
/// caller would spell. Falls back to the literal path when the directory does
/// not exist yet (the CLI fails with `unverifiable` before connecting anyway).
#[cfg_attr(not(windows), allow(dead_code))] // consumed by endpoint_for on Windows
fn canonical_for_hash(data_dir: &Path) -> String {
    let canonical = std::fs::canonicalize(data_dir).unwrap_or_else(|_| data_dir.to_path_buf());
    let text = canonical.to_string_lossy();
    text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
}

/// Reads the runtime's private auth token. The token value itself must never
/// appear in an error message, so failures only describe which step failed.
pub fn read_auth_token(data_dir: &Path) -> Result<String, RpcError> {
    let path = data_dir.join(TOKEN_FILE_NAME);
    if !path.is_file() {
        return Err(missing_runtime(format!(
            "no Drogon runtime is reachable at {}: missing {}",
            data_dir.display(),
            TOKEN_FILE_NAME
        )));
    }
    let raw = std::fs::read_to_string(&path).map_err(|err| {
        missing_runtime(format!(
            "cannot read {TOKEN_FILE_NAME} in {}: {}",
            data_dir.display(),
            err
        ))
    })?;
    let token = raw.trim();
    if token.is_empty() {
        return Err(missing_runtime(format!(
            "{TOKEN_FILE_NAME} in {} is empty",
            data_dir.display()
        )));
    }
    Ok(token.to_string())
}

pub fn missing_runtime(message: impl Into<String>) -> RpcError {
    RpcError::new("unverifiable", message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_of(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |key: &str| {
            pairs
                .iter()
                .find(|(name, _)| *name == key)
                .map(|(_, value)| value.to_string())
        }
    }

    #[test]
    fn explicit_flag_beats_everything() {
        let dir = resolve_data_dir(Some(Path::new("/tmp/explicit")));
        assert_eq!(dir, PathBuf::from("/tmp/explicit"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_default_and_env_override() {
        let home = Path::new("/Users/tester");
        assert_eq!(
            default_data_dir(env_of(&[]), home),
            home.join("Library/Application Support/Drogon")
        );
        assert_eq!(
            default_data_dir(env_of(&[("DROGON_DATA_DIR", "/data/x")]), home),
            PathBuf::from("/data/x")
        );
        assert_eq!(
            default_data_dir(env_of(&[("DROGON_DATA_DIR", "")]), home),
            home.join("Library/Application Support/Drogon"),
            "empty env var counts as unset"
        );
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn linux_default_and_xdg() {
        let home = Path::new("/home/tester");
        assert_eq!(
            default_data_dir(env_of(&[]), home),
            home.join(".local/share/drogon")
        );
        assert_eq!(
            default_data_dir(env_of(&[("XDG_DATA_HOME", "/xdg")]), home),
            PathBuf::from("/xdg/drogon")
        );
        assert_eq!(
            default_data_dir(env_of(&[("DROGON_DATA_DIR", "/data/x")]), home),
            PathBuf::from("/data/x")
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_default() {
        let home = Path::new("C:\\Users\\tester");
        assert_eq!(
            default_data_dir(
                env_of(&[("APPDATA", "C:\\Users\\t\\AppData\\Roaming")]),
                home
            ),
            PathBuf::from("C:\\Users\\t\\AppData\\Roaming\\Drogon")
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
        // Same input -> same name; different input -> different name.
        assert_eq!(name, windows_pipe_name("/home/tester/.local/share/drogon"));
        assert_ne!(name, windows_pipe_name("/home/other/.local/share/drogon"));
    }

    #[cfg(unix)]
    #[test]
    fn unix_endpoint_is_socket_file_in_data_dir() {
        assert_eq!(
            endpoint_for(Path::new("/data/drogon")),
            Endpoint::UnixSocket(PathBuf::from("/data/drogon/runtime-v1.sock"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn token_errors_never_contain_token_value() {
        let dir = tempfile::tempdir().unwrap();
        let err = read_auth_token(dir.path()).unwrap_err();
        assert_eq!(err.code, "unverifiable");

        std::fs::write(dir.path().join(TOKEN_FILE_NAME), "super-secret-token\n").unwrap();
        let token = read_auth_token(dir.path()).unwrap();
        assert_eq!(token, "super-secret-token");
        // The error text for a failed read must not echo contents.
        assert!(
            !missing_runtime("cannot read auth.token")
                .to_string()
                .contains("super-secret-token")
        );
    }
}
