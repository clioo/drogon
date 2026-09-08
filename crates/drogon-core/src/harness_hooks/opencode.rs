//! OpenCode status plugin install (journey J1 `needs_input`).
//!
//! Ported from the read-only reference's `src/main/opencode/hook-service.ts`
//! (`OpenCodeHookService.buildPtyEnv`/`mirrorUserConfig`/
//! `writePluginIntoOverlay`) for the overlay layout, and
//! `src/main/opencode/status-plugin-factory-source.ts` +
//! `status-plugin-lifecycle-source.ts` for the `event.type` names the
//! plugin reacts to. MIT Copyright (c) 2026 Lovecast Inc.
//!
//! Deliberately not ported (this repo's agent state is a flat
//! working/idle/needs_input/exited enum per session, not a per-pane preview
//! UI): child-session ownership/rollup, busy/retry backoff and coalescing,
//! message-part preview capture, the `.orca-opencode-overlay-manifest.json`
//! diffing (each session gets a fresh overlay dir instead of a persistent,
//! re-mirrored one), and the Windows-junction-specific mirroring guard.
//! Reports over `drogon-cli internal hook-event` (the same transport
//! Claude's hook commands use) instead of the source's HTTP loopback hooks
//! server: an OpenCode plugin runs inside a full Node/Bun process that can
//! exec a subprocess directly, and the events here are session/turn/tool
//! boundaries, not the per-character streaming deltas that motivated the
//! source's HTTP path.
//!
//! Each session gets its own overlay directory under
//! `<data-dir>/harness-hooks/opencode/<nonce>/`, pointed at by
//! `OPENCODE_CONFIG_DIR`, removed whole when the session exits (like
//! Claude's settings file) rather than the source's persistent,
//! source-dir-keyed overlay.

use std::path::{Path, PathBuf};

use drogon_protocol::RpcError;

use crate::agent_state::opencode_events as ev;
use crate::error;

pub(crate) const PLUGIN_FILE_NAME: &str = "drogon-opencode-status.js";

/// Per-session overlay dir; a fresh nonce per launch keeps cleanup a single
/// `remove_dir_all` with no cross-session sharing to reason about.
pub(crate) fn overlay_dir(data_dir: &Path, nonce: &str) -> PathBuf {
    data_dir.join("harness-hooks").join("opencode").join(nonce)
}

/// Builds the overlay: mirrors `existing_config_dir`'s top-level entries
/// (symlinks, so user edits stay live) except `plugins/`, which becomes a
/// real directory holding mirrored symlinks of the user's own plugin files
/// plus our own real plugin file — mirroring the source's rationale
/// exactly (`writePluginIntoOverlay` cannot write through a symlinked
/// `plugins/` into the user's real directory). With no existing config dir
/// (or an unusable one), the overlay is just a fresh `plugins/<file>`.
/// Returns the overlay dir, to be set as `OPENCODE_CONFIG_DIR`.
pub(crate) fn install(
    data_dir: &Path,
    nonce: &str,
    existing_config_dir: Option<&str>,
) -> Result<PathBuf, RpcError> {
    let overlay = overlay_dir(data_dir, nonce);
    std::fs::create_dir_all(&overlay)
        .map_err(|e| error::io_error(format!("cannot create opencode overlay dir: {e}")))?;
    if let Some(existing) = existing_config_dir.filter(|dir| Path::new(dir).is_dir()) {
        mirror_user_config(Path::new(existing), &overlay);
    }
    let plugins_dir = overlay.join("plugins");
    std::fs::create_dir_all(&plugins_dir)
        .map_err(|e| error::io_error(format!("cannot create opencode overlay plugins dir: {e}")))?;
    let plugin_path = plugins_dir.join(PLUGIN_FILE_NAME);
    // Remove first: a mirrored symlink from the user's own plugins dir
    // sharing our filename must never be written *through* into their file.
    let _ = std::fs::remove_file(&plugin_path);
    std::fs::write(&plugin_path, plugin_source())
        .map_err(|e| error::io_error(format!("cannot write opencode plugin: {e}")))?;
    Ok(overlay)
}

/// Best-effort per entry: a single unmirrorable entry (a broken symlink, a
/// permissions race) must not block the others or the launch.
fn mirror_user_config(source: &Path, overlay: &Path) {
    let Ok(entries) = std::fs::read_dir(source) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name() == "plugins" {
            continue; // handled below: a real dir, not a mirrored symlink.
        }
        let _ = symlink_best_effort(&entry.path(), &overlay.join(entry.file_name()));
    }
    let existing_plugins = source.join("plugins");
    let Ok(plugin_entries) = std::fs::read_dir(&existing_plugins) else {
        return;
    };
    let overlay_plugins = overlay.join("plugins");
    if std::fs::create_dir_all(&overlay_plugins).is_err() {
        return;
    }
    for entry in plugin_entries.flatten() {
        if entry.file_name().to_str() == Some(PLUGIN_FILE_NAME) {
            continue; // never mirror a same-named user file over our own.
        }
        let _ = symlink_best_effort(&entry.path(), &overlay_plugins.join(entry.file_name()));
    }
}

#[cfg(unix)]
fn symlink_best_effort(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(src, dst)
}

#[cfg(windows)]
fn symlink_best_effort(src: &Path, dst: &Path) -> std::io::Result<()> {
    // Why: matches the source's own stance (`hook-service.ts` comment) —
    // creating a symlink needs Windows developer mode without one this is a
    // best-effort no-op, not a launch failure.
    if src.is_dir() {
        std::os::windows::fs::symlink_dir(src, dst)
    } else {
        std::os::windows::fs::symlink_file(src, dst)
    }
}

/// The plugin source written into the overlay's `plugins/` dir. Identity
/// (session id, incarnation, CLI path) comes from the session environment
/// at report time (`session_env::harness_hook_env` plus the
/// unconditionally-exported `DROGON_SESSION_ID`), not baked into this
/// string, so the same content works for every session — only the overlay
/// *directory* is per-session.
pub(crate) fn plugin_source() -> String {
    format!(
        r#"// MIT Copyright (c) 2026 Lovecast Inc.
// Ported event-type wiring from the Drogon read-only reference's
// src/main/opencode/status-plugin-factory-source.ts and
// status-plugin-lifecycle-source.ts. Reports through
// `drogon-cli internal hook-event` instead of the source's HTTP loopback
// hooks server; see harness_hooks::opencode for what else is not ported.

function report(eventName) {{
  var cli = process.env.DROGON_HOOK_CLI || "drogon-cli";
  var sessionId = process.env.DROGON_SESSION_ID || "";
  var incarnation = process.env.DROGON_HOOK_INCARNATION || "";
  if (!sessionId || !incarnation) return;
  try {{
    require("node:child_process").execFile(
      cli,
      ["internal", "hook-event", "--session", sessionId, "--incarnation", incarnation, "--event", eventName],
      {{ stdio: "ignore" }},
      function () {{}}
    );
  }} catch (err) {{
    // Why: a hook-report failure must never fail the OpenCode run.
  }}
}}

export const DrogonOpenCodeStatusPlugin = async (_ctx) => {{
  return {{
    event: async ({{ event }}) => {{
      if (!event || !event.type) return;
      var type = event.type;
      var props = event.properties || {{}};
      if (type === "session.idle") {{ report("{session_idle}"); return; }}
      if (type === "permission.asked") {{ report("{permission_request}"); return; }}
      if (type === "question.asked") {{ report("{ask_user_question}"); return; }}
      if (type === "permission.replied") {{ report("{permission_replied}"); return; }}
      if (type === "question.replied" || type === "question.rejected") {{ report("{question_replied}"); return; }}
      if (type === "session.created") {{
        var info = props.info;
        if (info && !info.parentID) report("{new_turn}");
        return;
      }}
      if (type === "message.updated") {{
        var info = props.info;
        if (info && info.role === "user") report("{new_turn}");
        return;
      }}
      if (type === "message.part.updated") {{
        var part = props.part;
        if (part && part.type === "tool") report("{tool_start}");
        return;
      }}
    }},
  }};
}};

export default {{ id: "drogon-opencode-status", server: DrogonOpenCodeStatusPlugin }};
"#,
        session_idle = ev::SESSION_IDLE,
        permission_request = ev::PERMISSION_REQUEST,
        ask_user_question = ev::ASK_USER_QUESTION,
        permission_replied = ev::PERMISSION_REPLIED,
        question_replied = ev::QUESTION_REPLIED,
        new_turn = ev::NEW_TURN,
        tool_start = ev::TOOL_START,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlay_dir_is_nonce_scoped_under_the_data_dir() {
        let dir = tempfile::tempdir().unwrap();
        let path = overlay_dir(dir.path(), "abc123");
        assert_eq!(
            path,
            dir.path()
                .join("harness-hooks")
                .join("opencode")
                .join("abc123")
        );
    }

    #[test]
    fn plugin_source_contains_the_mit_notice_and_every_event_name() {
        let source = plugin_source();
        assert!(source.contains("MIT Copyright (c) 2026 Lovecast Inc."));
        assert!(source.contains("internal hook-event"));
        for name in [
            ev::SESSION_IDLE,
            ev::PERMISSION_REQUEST,
            ev::ASK_USER_QUESTION,
            ev::PERMISSION_REPLIED,
            ev::QUESTION_REPLIED,
            ev::NEW_TURN,
            ev::TOOL_START,
        ] {
            assert!(source.contains(name), "missing event name {name}: {source}");
        }
        assert!(source.contains("DROGON_HOOK_CLI"));
        assert!(source.contains("DROGON_SESSION_ID"));
        assert!(source.contains("DROGON_HOOK_INCARNATION"));
    }

    #[test]
    fn install_with_no_existing_config_dir_writes_a_fresh_plugin() {
        let data = tempfile::tempdir().unwrap();
        let overlay = install(data.path(), "nonce-1", None).unwrap();
        assert_eq!(overlay, overlay_dir(data.path(), "nonce-1"));
        let plugin =
            std::fs::read_to_string(overlay.join("plugins").join(PLUGIN_FILE_NAME)).unwrap();
        assert_eq!(plugin, plugin_source());
    }

    #[test]
    fn install_with_a_missing_existing_dir_still_succeeds() {
        let data = tempfile::tempdir().unwrap();
        let overlay = install(data.path(), "nonce-2", Some("/no/such/opencode/config")).unwrap();
        assert!(overlay.join("plugins").join(PLUGIN_FILE_NAME).is_file());
    }

    #[cfg(unix)]
    #[test]
    fn install_mirrors_top_level_entries_and_preserves_user_plugins() {
        let user_config = tempfile::tempdir().unwrap();
        std::fs::write(user_config.path().join("opencode.json"), "{}").unwrap();
        std::fs::create_dir_all(user_config.path().join("plugins")).unwrap();
        std::fs::write(
            user_config.path().join("plugins").join("my-plugin.js"),
            "// mine",
        )
        .unwrap();

        let data = tempfile::tempdir().unwrap();
        let overlay = install(
            data.path(),
            "nonce-3",
            Some(user_config.path().to_str().unwrap()),
        )
        .unwrap();

        // Top-level user config is mirrored live (a symlink), not copied.
        let mirrored_config = overlay.join("opencode.json");
        assert!(
            std::fs::symlink_metadata(&mirrored_config)
                .unwrap()
                .file_type()
                .is_symlink(),
            "user config entries must be mirrored as symlinks so edits stay live"
        );
        assert_eq!(std::fs::read_to_string(&mirrored_config).unwrap(), "{}");

        // plugins/ is a real directory: the user's plugin is mirrored inside it...
        assert!(
            !std::fs::symlink_metadata(overlay.join("plugins"))
                .unwrap()
                .file_type()
                .is_symlink(),
            "plugins/ itself must be a real directory, not mirrored as a symlink"
        );
        assert_eq!(
            std::fs::read_to_string(overlay.join("plugins").join("my-plugin.js")).unwrap(),
            "// mine"
        );
        // ...alongside our own real plugin file, unclobbered.
        assert_eq!(
            std::fs::read_to_string(overlay.join("plugins").join(PLUGIN_FILE_NAME)).unwrap(),
            plugin_source()
        );
    }

    #[cfg(unix)]
    #[test]
    fn install_never_mirrors_a_same_named_user_plugin_over_our_own() {
        let user_config = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(user_config.path().join("plugins")).unwrap();
        std::fs::write(
            user_config.path().join("plugins").join(PLUGIN_FILE_NAME),
            "// impostor",
        )
        .unwrap();

        let data = tempfile::tempdir().unwrap();
        let overlay = install(
            data.path(),
            "nonce-4",
            Some(user_config.path().to_str().unwrap()),
        )
        .unwrap();

        assert_eq!(
            std::fs::read_to_string(overlay.join("plugins").join(PLUGIN_FILE_NAME)).unwrap(),
            plugin_source(),
            "our plugin file must win over a same-named user file"
        );
    }
}
