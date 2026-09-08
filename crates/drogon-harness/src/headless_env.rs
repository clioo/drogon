//! Isolated config-dir environment for daemon-run (headless) harness
//! launches.
//!
//! MIT Copyright (c) 2026 Lovecast Inc.
//!
//! Ported shape: the read-only reference points unattended Pi launches at a
//! service-owned `PI_CODING_AGENT_DIR` instead of whatever the inherited
//! environment says (src/main/ipc/pty/host-env/pi-agent.ts and
//! src/main/text-generation/commit-message-agent-environment.ts: the
//! `PI_CODING_AGENT_DIR` contract is the binary-facing override both point
//! at), so a bot/automation run never inherits an outer runtime's overlay
//! through the daemon environment. Adapted to this repo's contracts and
//! issue #187: the isolated dir starts EMPTY of everything the user's own
//! runs accumulate — skills, extensions, `settings.json` package sources,
//! MCP server config, session history — while the provider/model/auth
//! definitions the run was configured with (dgx-spark, …) stay reachable
//! through read-only links, so model selection keeps working without
//! loading a single user extension. The dir lives under
//! `<data-dir>/harness-env/<harness>/<nonce>/` and is removed whole when
//! the session exits, like Claude's nonce settings file.

use std::path::{Path, PathBuf};

use crate::HarnessId;

/// Config files linked from the user's own Pi agent dir into an isolated
/// headless dir. Everything a run needs to authenticate and resolve its
/// configured provider/model; nothing that loads skills, extensions,
/// packages or MCP servers (those live in `skills/`, `extensions/`,
/// `settings.json` and `mcp.json`, which are deliberately NOT linked).
pub const PI_HEADLESS_LINK_FILES: &[&str] = &["models.json", "models-store.json", "auth.json"];

/// One isolated config dir plus the environment overlay pointing the
/// harness binary at it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HeadlessEnvPlan {
    /// Directory to create before spawn and remove after exit. A fresh
    /// nonce per launch keeps cleanup a single `remove_dir_all` with no
    /// cross-run sharing to reason about.
    pub dir: PathBuf,
    /// Environment assignments applied after the base session environment
    /// (and therefore winning over anything inherited).
    pub env: Vec<(String, String)>,
    /// `(source, dest file name)` pairs to link inside `dir`; sources that
    /// do not exist are skipped (every one is optional to the binary).
    pub link_files: Vec<(PathBuf, String)>,
}

/// Whether a headless launch needs an isolated config dir, and the plan for
/// it. `None` for harnesses with their own unattended mechanism (Claude's
/// nonce settings file, OpenCode's overlay `OPENCODE_CONFIG_DIR`) or none at
/// all (Antigravity).
///
/// `source_agent_dir` is the user's own Pi agent dir (the default
/// `~/.pi/agent`, or their custom `PI_CODING_AGENT_DIR`); pass `None` when
/// it cannot be determined — the isolated dir then starts completely empty.
pub fn plan_headless_env(
    harness_id: HarnessId,
    data_dir: &Path,
    nonce: &str,
    source_agent_dir: Option<&Path>,
) -> Option<HeadlessEnvPlan> {
    match harness_id {
        HarnessId::Pi => {
            // Why the override wins over an inherited value: the daemon can
            // itself run inside another runtime's terminal, and that
            // runtime's overlay (or any other inherited
            // PI_CODING_AGENT_DIR) must not define a bot run's config
            // root. extra_env is applied after the base session
            // environment, so this assignment always replaces an inherited
            // one.
            let dir = data_dir.join("harness-env").join("pi").join(nonce);
            let link_files = source_agent_dir
                .map(|source| {
                    PI_HEADLESS_LINK_FILES
                        .iter()
                        .map(|name| (source.join(name), name.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            Some(HeadlessEnvPlan {
                dir: dir.clone(),
                env: vec![(
                    "PI_CODING_AGENT_DIR".to_string(),
                    dir.to_string_lossy().into_owned(),
                )],
                link_files,
            })
        }
        HarnessId::Claude | HarnessId::Opencode | HarnessId::Antigravity | HarnessId::Codex => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headless_pi_gets_an_isolated_agent_dir_overlay() {
        let plan = plan_headless_env(HarnessId::Pi, Path::new("/data/x"), "n-1", None).unwrap();
        assert_eq!(plan.dir, PathBuf::from("/data/x/harness-env/pi/n-1"));
        assert_eq!(
            plan.env,
            vec![(
                "PI_CODING_AGENT_DIR".to_string(),
                "/data/x/harness-env/pi/n-1".to_string()
            )]
        );
        assert!(plan.link_files.is_empty(), "no source dir -> no links");
    }

    #[test]
    fn source_config_files_are_linked_but_never_skills_extensions_or_mcp() {
        let plan = plan_headless_env(
            HarnessId::Pi,
            Path::new("/data/x"),
            "n-1",
            Some(Path::new("/home/u/.pi/agent")),
        )
        .unwrap();
        let names: Vec<&str> = plan
            .link_files
            .iter()
            .map(|(_, name)| name.as_str())
            .collect();
        assert_eq!(names, ["models.json", "models-store.json", "auth.json"]);
        for forbidden in [
            "skills",
            "extensions",
            "mcp.json",
            "settings.json",
            "trust.json",
        ] {
            assert!(
                !names.contains(&forbidden),
                "{forbidden} must never be linked into an isolated run"
            );
        }
        assert!(
            plan.link_files
                .iter()
                .all(|(src, name)| src == &Path::new("/home/u/.pi/agent").join(name))
        );
    }

    #[test]
    fn every_other_harness_keeps_its_own_mechanism() {
        for harness in [
            HarnessId::Claude,
            HarnessId::Opencode,
            HarnessId::Antigravity,
            HarnessId::Codex,
        ] {
            assert_eq!(
                plan_headless_env(harness, Path::new("/data/x"), "n-1", None),
                None,
                "{harness:?} already has its own unattended config mechanism"
            );
        }
    }

    #[test]
    fn non_utf8_data_dir_still_plans_a_lossy_path() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;
        let dir = std::path::Path::new(OsStr::from_bytes(b"/data/\xFF"));
        let plan = plan_headless_env(HarnessId::Pi, dir, "n", None).unwrap();
        assert!(plan.dir.starts_with("/data/"));
        assert_eq!(plan.env[0].0, "PI_CODING_AGENT_DIR");
    }
}
