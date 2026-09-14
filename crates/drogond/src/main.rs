use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::Parser;

/// `drogond`: the Drogon terminal/session service. Foreground process;
/// owns SQLite and PTYs under `--data-dir`. See `docs/migration/protocol-v1.md`.
#[derive(Parser, Debug)]
#[command(name = "drogond", version)]
struct Args {
    /// Drogon data directory (default: DROGON_DATA_DIR, else platform default)
    #[arg(long)]
    data_dir: Option<PathBuf>,
}

fn main() -> ExitCode {
    let args = Args::parse();
    let data_dir = args
        .data_dir
        .unwrap_or_else(|| default_data_dir(read_env, &home_dir()));
    match drogond::serve(&data_dir) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("drogond: {e}");
            ExitCode::FAILURE
        }
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

/// Default data directory when `--data-dir` is omitted: the frozen contract
/// shared with `drogon-cli` (`drogon-cli/src/paths.rs::default_data_dir`) —
/// `DROGON_DATA_DIR`, then the platform default. Mirrored here instead of
/// shared because the wire-protocol crate is the only common dependency and
/// a data-dir helper does not belong in it. Empty environment values count
/// as unset regardless of the source.
fn default_data_dir(env_value: impl Fn(&str) -> Option<String>, home: &Path) -> PathBuf {
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
    fn data_dir_flag_beats_the_default() {
        let args = Args::try_parse_from(["drogond", "--data-dir", "/tmp/explicit"]).unwrap();
        assert_eq!(args.data_dir, Some(PathBuf::from("/tmp/explicit")));
    }

    #[test]
    fn no_args_resolves_lazily_to_a_default() {
        let args = Args::try_parse_from(["drogond"]).unwrap();
        assert_eq!(args.data_dir, None);
        let resolved = args
            .data_dir
            .unwrap_or_else(|| default_data_dir(env_of(&[]), Path::new("/Users/tester")));
        assert!(resolved.ends_with("Drogon"));
    }

    #[test]
    fn version_flag_reports_the_build() {
        let result = Args::try_parse_from(["drogond", "--version"]);
        assert!(result.is_err());
        let message = result.unwrap_err().to_string();
        assert!(
            message.contains(env!("CARGO_PKG_VERSION")),
            "unexpected --version output: {message}"
        );
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
}
