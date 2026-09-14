//! Claude Code's interactive TUI asks "Is this a project you created or one
//! you trust?" the first time it opens a folder, and a session nobody sits at
//! stalls on that dialog forever. Every folder Drogon creates under its own
//! data directory — a demo project, a Bot's home, a Quick Session's scratch —
//! is the user's own by construction: the user made it through Drogon. Before
//! an interactive Claude launch in such a folder, that folder is marked
//! trusted in Claude Code's own per-user config (`~/.claude.json`,
//! `projects.<path>.hasTrustDialogAccepted`), the same record the dialog
//! writes when the user answers yes.
//!
//! Scope is deliberately narrow: only folders under the data directory, only
//! when the config already exists (a machine that never ran Claude Code gets
//! its onboarding untouched), only that one key, written atomically so a
//! concurrent Claude Code never reads a torn file. A failure is logged and
//! the launch proceeds: the dialog is a nuisance, not a reason to refuse.

use std::path::{Path, PathBuf};

use serde_json::{Value, json};

pub(crate) const CLAUDE_CONFIG_FILE: &str = ".claude.json";

/// Marks `folder` trusted for Claude Code when it lies under `data_dir`.
/// Returns whether the config was changed.
pub(crate) fn trust_drogon_folder(data_dir: &Path, folder: &Path) -> bool {
    let Some(home) = std::env::var_os("HOME") else {
        return false;
    };
    trust_folder_in_config(&Path::new(&home).join(CLAUDE_CONFIG_FILE), data_dir, folder)
}

pub(crate) fn trust_folder_in_config(config: &Path, data_dir: &Path, folder: &Path) -> bool {
    let canonical_data = data_dir
        .canonicalize()
        .unwrap_or_else(|_| data_dir.to_path_buf());
    let canonical = folder
        .canonicalize()
        .unwrap_or_else(|_| folder.to_path_buf());
    if !canonical.starts_with(&canonical_data) && !folder.starts_with(data_dir) {
        return false;
    }
    let Ok(text) = std::fs::read_to_string(config) else {
        return false;
    };
    let Ok(mut value) = serde_json::from_str::<Value>(&text) else {
        crate::diagnostics::log_line(format_args!(
            "claude trust: {} is not valid JSON; leaving it alone",
            config.display()
        ));
        return false;
    };
    let Some(root) = value.as_object_mut() else {
        return false;
    };
    let projects = root.entry("projects").or_insert_with(|| json!({}));
    let Some(map) = projects.as_object_mut() else {
        return false;
    };
    let mut keys: Vec<PathBuf> = vec![folder.to_path_buf()];
    if canonical != folder {
        keys.push(canonical);
    }
    let mut changed = false;
    for key in keys {
        let entry = map
            .entry(key.display().to_string())
            .or_insert_with(|| json!({}));
        if let Some(record) = entry.as_object_mut()
            && record.get("hasTrustDialogAccepted") != Some(&json!(true))
        {
            record.insert("hasTrustDialogAccepted".into(), json!(true));
            changed = true;
        }
    }
    if !changed {
        return false;
    }
    let Ok(rendered) = serde_json::to_string_pretty(&value) else {
        return false;
    };
    let staged = config.with_extension("json.drogon-trust");
    let written = std::fs::write(&staged, rendered).and_then(|()| {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o600))?;
        }
        std::fs::rename(&staged, config)
    });
    match written {
        Ok(()) => true,
        Err(error) => {
            let _ = std::fs::remove_file(&staged);
            crate::diagnostics::log_line(format_args!(
                "claude trust: could not update {}: {error}",
                config.display()
            ));
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_drogon_folder_is_marked_trusted_and_everything_else_is_kept() {
        let home = tempfile::tempdir().unwrap();
        let data = home.path().join("data");
        let folder = data.join("projects").join("dog-tinder-1");
        std::fs::create_dir_all(&folder).unwrap();
        let config = home.path().join(CLAUDE_CONFIG_FILE);
        std::fs::write(
            &config,
            r#"{"hasCompletedOnboarding":true,"theme":"dark","projects":{"/elsewhere":{"hasTrustDialogAccepted":true,"history":["x"]}}}"#,
        )
        .unwrap();
        assert!(trust_folder_in_config(&config, &data, &folder));
        let value: Value =
            serde_json::from_str(&std::fs::read_to_string(&config).unwrap()).unwrap();
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["projects"]["/elsewhere"]["history"], json!(["x"]));
        assert_eq!(
            value["projects"][folder.display().to_string()]["hasTrustDialogAccepted"],
            true
        );
        // Idempotent: a second call changes nothing.
        assert!(!trust_folder_in_config(&config, &data, &folder));
    }

    #[test]
    fn folders_outside_the_data_directory_are_never_touched() {
        let home = tempfile::tempdir().unwrap();
        let data = home.path().join("data");
        std::fs::create_dir_all(&data).unwrap();
        let elsewhere = home.path().join("repo");
        std::fs::create_dir_all(&elsewhere).unwrap();
        let config = home.path().join(CLAUDE_CONFIG_FILE);
        std::fs::write(&config, r#"{"projects":{}}"#).unwrap();
        assert!(!trust_folder_in_config(&config, &data, &elsewhere));
        assert_eq!(
            std::fs::read_to_string(&config).unwrap(),
            r#"{"projects":{}}"#
        );
    }

    #[test]
    fn a_missing_config_is_not_created() {
        let home = tempfile::tempdir().unwrap();
        let data = home.path().join("data");
        let folder = data.join("bots").join("b1");
        std::fs::create_dir_all(&folder).unwrap();
        let config = home.path().join(CLAUDE_CONFIG_FILE);
        assert!(!trust_folder_in_config(&config, &data, &folder));
        assert!(!config.exists());
    }
}
