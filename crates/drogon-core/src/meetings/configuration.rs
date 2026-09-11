//! Resolution of the Write That Down notes directory.
//!
//! Write That Down (the owner's macOS meeting copilot) documents its own
//! precedence as **defaults → config file → environment variables**, so this
//! module mirrors exactly that order instead of inventing a second one:
//! `~/Transcripts` unless `config.json`'s `outputDir` says otherwise, with
//! `WTD_OUTPUT_DIR` winning over both. A leading `~` is expanded, and a
//! malformed or oversized config is reported as `invalid` (never silently
//! treated as defaults), because the whole point of this surface is to tell
//! the owner the truth about where his notes are.

use std::path::{Path, PathBuf};

use super::MeetingEnvironment;
use super::filesystem::{MeetingFileSystem, normalize};

/// `~/Library/Application Support/WriteThatDown/config.json`, relative to home.
pub const CONFIG_RELATIVE_PATH: &str = "Library/Application Support/WriteThatDown/config.json";
/// Write That Down's own default (`AppConfiguration.outputDir`).
pub const DEFAULT_OUTPUT_DIR: &str = "~/Transcripts";
/// `ConfigOverrides` decoding is a JSON document of a few hundred bytes; the
/// cap exists so a pathological file cannot be read into memory.
const CONFIG_MAX_BYTES: u64 = 256 * 1024;

/// Which layer produced `output_dir`. Reported to the UI and the CLI so the
/// answer to "where are my notes?" is never a guess.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranscriptRootSource {
    Default,
    ConfigFile,
    Environment,
}

impl TranscriptRootSource {
    pub fn as_wire(self) -> &'static str {
        match self {
            TranscriptRootSource::Default => "default",
            TranscriptRootSource::ConfigFile => "config",
            TranscriptRootSource::Environment => "environment",
        }
    }
}

/// `defaults` when nothing configured the tool path, `configured` when a
/// config file or a `WTD_*` variable was present, `invalid` when the config
/// file exists but could not be trusted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigurationState {
    Defaults,
    Configured,
    Invalid,
}

impl ConfigurationState {
    pub fn as_wire(self) -> &'static str {
        match self {
            ConfigurationState::Defaults => "defaults",
            ConfigurationState::Configured => "configured",
            ConfigurationState::Invalid => "invalid",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ResolvedConfiguration {
    pub output_dir: PathBuf,
    pub source: TranscriptRootSource,
    pub state: ConfigurationState,
    pub config_path: PathBuf,
    pub config_present: bool,
}

impl ResolvedConfiguration {
    pub fn invalid(&self) -> bool {
        self.state == ConfigurationState::Invalid
    }
}

/// Expands a leading `~` / `~/` against the supplied home directory, exactly
/// like Write That Down's `AppConfiguration.expandTilde`. A `~` elsewhere in
/// the string is left alone.
pub fn expand_tilde(value: &str, home_dir: &Path) -> PathBuf {
    if value == "~" {
        return home_dir.to_path_buf();
    }
    if let Some(rest) = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"))
    {
        return home_dir.join(rest);
    }
    PathBuf::from(value)
}

pub fn config_path(home_dir: &Path) -> PathBuf {
    home_dir.join(CONFIG_RELATIVE_PATH)
}

/// Reads `outputDir` out of Write That Down's config file. Any other field is
/// ignored (it belongs to the tool, not to Drogon). `Err(())` means the file
/// exists but is untrustworthy.
fn read_output_dir(
    file_system: &dyn MeetingFileSystem,
    config_file: &Path,
    home_dir: &Path,
) -> Result<Option<PathBuf>, ()> {
    let meta = match file_system.metadata(config_file) {
        Ok(meta) => meta,
        Err(_) => return Ok(None),
    };
    if !meta.is_file || meta.size > CONFIG_MAX_BYTES {
        return Err(());
    }
    let bytes = file_system.read_file(config_file).map_err(|_| ())?;
    let text = std::str::from_utf8(&bytes).map_err(|_| ())?;
    let value: serde_json::Value = serde_json::from_str(text).map_err(|_| ())?;
    let object = value.as_object().ok_or(())?;
    match object.get("outputDir") {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(raw)) => {
            if raw.is_empty() {
                return Ok(None);
            }
            Ok(Some(expand_tilde(raw, home_dir)))
        }
        // A present-but-wrong-typed outputDir is a configuration problem the
        // owner must see, not something to paper over with the default.
        Some(_) => Err(()),
    }
}

/// Resolves the notes directory for one environment. Precedence follows the
/// tool's own documentation: defaults, then the config file, then `WTD_*`.
pub fn resolve(
    file_system: &dyn MeetingFileSystem,
    environment: &MeetingEnvironment,
) -> ResolvedConfiguration {
    let config_file = config_path(&environment.home_dir);
    let default_dir = expand_tilde(DEFAULT_OUTPUT_DIR, &environment.home_dir);
    let config_present = file_system.metadata(&config_file).is_ok();
    match read_output_dir(file_system, &config_file, &environment.home_dir) {
        Err(()) => ResolvedConfiguration {
            output_dir: normalize(&default_dir),
            source: TranscriptRootSource::Default,
            state: ConfigurationState::Invalid,
            config_path: config_file,
            config_present: true,
        },
        Ok(from_config) => {
            let environment_override = environment
                .var("WTD_OUTPUT_DIR")
                .filter(|value| !value.is_empty())
                .map(|value| expand_tilde(value, &environment.home_dir));
            // `configured` mirrors the tool's own definition: a config file
            // that exists counts even when it only sets unrelated fields, and
            // any `WTD_*` variable counts.
            let configured = config_present || environment_has_wtd_prefix(environment);
            let (output_dir, source) = match environment_override {
                Some(dir) => (normalize(&dir), TranscriptRootSource::Environment),
                None => match from_config {
                    Some(dir) => (normalize(&dir), TranscriptRootSource::ConfigFile),
                    None => (normalize(&default_dir), TranscriptRootSource::Default),
                },
            };
            ResolvedConfiguration {
                output_dir,
                source,
                state: if configured {
                    ConfigurationState::Configured
                } else {
                    ConfigurationState::Defaults
                },
                config_path: config_file,
                config_present,
            }
        }
    }
}

fn environment_has_wtd_prefix(environment: &MeetingEnvironment) -> bool {
    environment
        .variables
        .keys()
        .any(|key| key.starts_with("WTD_"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meetings::MeetingEnvironment;
    use crate::meetings::filesystem::tests::FakeFileSystem;
    use std::path::Path;

    fn env(home: &str, vars: &[(&str, &str)]) -> MeetingEnvironment {
        MeetingEnvironment {
            platform: "darwin".into(),
            home_dir: PathBuf::from(home),
            variables: vars
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            app_candidates: Vec::new(),
            analysis_harness: None,
        }
    }

    #[test]
    fn defaults_to_transcripts_without_config_or_environment() {
        let fs = FakeFileSystem::default();
        let resolved = resolve(&fs, &env("/home/carlos", &[]));
        assert_eq!(
            resolved.output_dir,
            PathBuf::from("/home/carlos/Transcripts")
        );
        assert_eq!(resolved.source, TranscriptRootSource::Default);
        assert_eq!(resolved.state, ConfigurationState::Defaults);
        assert!(!resolved.config_present);
    }

    #[test]
    fn config_output_dir_wins_over_the_default_and_expands_tilde() {
        let mut fs = FakeFileSystem::default();
        fs.insert_file(
            "/home/carlos/Library/Application Support/WriteThatDown/config.json",
            br#"{"outputDir":"~/Notes/meetings","engine":"sherpa"}"#,
        );
        let resolved = resolve(&fs, &env("/home/carlos", &[]));
        assert_eq!(
            resolved.output_dir,
            PathBuf::from("/home/carlos/Notes/meetings")
        );
        assert_eq!(resolved.source, TranscriptRootSource::ConfigFile);
        assert_eq!(resolved.state, ConfigurationState::Configured);
        assert!(resolved.config_present);
    }

    #[test]
    fn environment_output_dir_wins_over_the_config_file() {
        let mut fs = FakeFileSystem::default();
        fs.insert_file(
            "/home/carlos/Library/Application Support/WriteThatDown/config.json",
            br#"{"outputDir":"/from/config"}"#,
        );
        let resolved = resolve(
            &fs,
            &env("/home/carlos", &[("WTD_OUTPUT_DIR", "/from/env")]),
        );
        assert_eq!(resolved.output_dir, PathBuf::from("/from/env"));
        assert_eq!(resolved.source, TranscriptRootSource::Environment);
    }

    #[test]
    fn relative_and_dotted_paths_are_normalized_lexically() {
        let fs = FakeFileSystem::default();
        let resolved = resolve(
            &fs,
            &env(
                "/home/carlos",
                &[("WTD_OUTPUT_DIR", "/tmp/../private/notes")],
            ),
        );
        assert_eq!(resolved.output_dir, PathBuf::from("/private/notes"));
    }

    #[test]
    fn malformed_config_is_reported_invalid_and_keeps_the_default() {
        let mut fs = FakeFileSystem::default();
        fs.insert_file(
            "/home/carlos/Library/Application Support/WriteThatDown/config.json",
            b"{not json",
        );
        let resolved = resolve(
            &fs,
            &env("/home/carlos", &[("WTD_OUTPUT_DIR", "/from/env")]),
        );
        assert_eq!(resolved.state, ConfigurationState::Invalid);
        assert!(resolved.invalid());
        assert_eq!(
            resolved.output_dir,
            PathBuf::from("/home/carlos/Transcripts")
        );
        // The tool itself documents this shape: an untrustworthy config file
        // leaves the tool on defaults rather than half-applying overrides.
        assert_eq!(resolved.source, TranscriptRootSource::Default);
    }

    #[test]
    fn wrong_typed_output_dir_is_invalid_not_defaults() {
        let mut fs = FakeFileSystem::default();
        fs.insert_file(
            "/home/carlos/Library/Application Support/WriteThatDown/config.json",
            br#"{"outputDir":42}"#,
        );
        let resolved = resolve(&fs, &env("/home/carlos", &[]));
        assert_eq!(resolved.state, ConfigurationState::Invalid);
        assert!(resolved.config_present);
    }

    #[test]
    fn oversized_config_is_invalid_instead_of_read_into_memory() {
        let mut fs = FakeFileSystem::default();
        let huge = vec![b' '; (CONFIG_MAX_BYTES + 1) as usize];
        fs.insert_file(
            "/home/carlos/Library/Application Support/WriteThatDown/config.json",
            &huge,
        );
        let resolved = resolve(&fs, &env("/home/carlos", &[]));
        assert_eq!(resolved.state, ConfigurationState::Invalid);
    }

    #[test]
    fn a_config_without_output_dir_is_configured_but_keeps_the_default() {
        let mut fs = FakeFileSystem::default();
        fs.insert_file(
            "/home/carlos/Library/Application Support/WriteThatDown/config.json",
            br#"{"engine":"native"}"#,
        );
        let resolved = resolve(&fs, &env("/home/carlos", &[]));
        assert_eq!(
            resolved.output_dir,
            PathBuf::from("/home/carlos/Transcripts")
        );
        assert_eq!(resolved.source, TranscriptRootSource::Default);
        assert_eq!(resolved.state, ConfigurationState::Configured);
    }

    #[test]
    fn unrelated_wtd_variables_still_mark_the_tool_configured() {
        let fs = FakeFileSystem::default();
        let resolved = resolve(&fs, &env("/home/carlos", &[("WTD_LANGUAGE", "es")]));
        assert_eq!(resolved.state, ConfigurationState::Configured);
        assert_eq!(resolved.source, TranscriptRootSource::Default);
    }

    #[test]
    fn expand_tilde_only_touches_a_leading_tilde() {
        assert_eq!(expand_tilde("~", Path::new("/h")), PathBuf::from("/h"));
        assert_eq!(
            expand_tilde("~/a/~/b", Path::new("/h")),
            PathBuf::from("/h/a/~/b")
        );
        assert_eq!(
            expand_tilde("/abs/~/x", Path::new("/h")),
            PathBuf::from("/abs/~/x")
        );
    }

    #[test]
    fn a_directory_at_the_config_path_is_invalid_not_a_read_error() {
        let mut fs = FakeFileSystem::default();
        fs.insert_dir("/home/carlos/Library/Application Support/WriteThatDown/config.json");
        let resolved = resolve(&fs, &env("/home/carlos", &[]));
        assert_eq!(resolved.state, ConfigurationState::Invalid);
        assert!(resolved.config_present);
    }
}
