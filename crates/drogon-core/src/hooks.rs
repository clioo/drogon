//! Per-session Claude Code hook settings (journey J1 `needs_input`).
//!
//! When `harness.start` launches the claude harness, the daemon writes one
//! settings file per session under `<data-dir>/hooks/` and passes it to
//! claude with `--settings <file>`. The file carries `Notification` and
//! `Stop` hooks that invoke `drogon-cli internal hook-event`, which calls
//! back into `session.hook_event`: `Notification` marks the session
//! `needs_input`, `Stop` clears it (the fork maps Claude's `Stop` to done —
//! issue #360).
//! Later PTY output clears the signal; the settings file is removed when
//! the session exits. Nothing is ever written under `~/.claude`.
//!
//! The filename is a launch nonce, not the session id: the `--settings`
//! path must be part of the launch argv (fixed before admission mints the
//! session id), while the hook *commands* embed the real session id and
//! incarnation (known after admission, written before spawn).
//!
//! OpenCode, Pi, and Codex reuse this same `session.hook_event` RPC and the
//! same per-session install/cleanup slot through their own installers in
//! `harness_hooks::{codex, opencode, pi}`, driven by `harness.rs`. Only the
//! event *names* differ per harness — see
//! `agent_state::classify_hook_event` for the full set and the wait /
//! turn-start / turn-end split.

use std::path::{Path, PathBuf};

use drogon_protocol::RpcError;
use serde_json::{Value, json};

use crate::agent_state::HookSignal;
use crate::{Engine, error, require_str, session};

/// Directory under the data dir holding per-session hook settings files.
pub(crate) fn hooks_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("hooks")
}

/// Fresh nonce-named settings path for one launch. The caller appends
/// `--settings <path>` to the launch argv, then [`write_settings_file`]
/// before spawning.
pub(crate) fn nonce_settings_path(data_dir: &Path, nonce: &str) -> PathBuf {
    hooks_dir(data_dir).join(format!("{nonce}.json"))
}

/// The shell command a hook entry runs: the packaged CLI next to the
/// running service when it exists (absolute, so hook delivery never depends
/// on the session's PATH), else a bare `drogon-cli` lookup.
pub(crate) fn hook_command(cli: &str, session_id: &str, incarnation: &str, event: &str) -> String {
    format!(
        "{} internal hook-event --session {} --incarnation {} --event {}",
        shell_quote(cli),
        shell_quote(session_id),
        shell_quote(incarnation),
        shell_quote(event)
    )
}

/// Minimal POSIX single-quote escaping for one argv word embedded in a hook
/// command string (also reused by the `<data-dir>/bin` shim renderer).
/// Session ids and incarnations are UUIDs, but quoting unconditionally keeps
/// a future caller from smuggling shell syntax.
pub(crate) fn shell_quote(word: &str) -> String {
    if word
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'/' | b':'))
    {
        return word.to_string();
    }
    format!("'{}'", word.replace('\'', "'\\''"))
}

/// Best `drogon-cli` path for hook commands: the sibling of the running
/// service binary when it is actually there (the packaged layout), else a
/// PATH lookup. Never fails: hooks must degrade to a PATH lookup rather
/// than block a launch on path probing.
pub(crate) fn cli_command() -> String {
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        #[cfg(windows)]
        let candidate = dir.join("drogon-cli.exe");
        #[cfg(not(windows))]
        let candidate = dir.join("drogon-cli");
        if candidate.is_file() {
            return candidate.to_string_lossy().into_owned();
        }
    }
    "drogon-cli".to_string()
}

/// Settings JSON in Claude Code's `--settings` shape: each event maps to
/// entries whose `hooks` run the wait-signal command. One entry per event;
/// no matcher (these events carry none).
pub(crate) fn settings_json(cli: &str, session_id: &str, incarnation: &str) -> Value {
    let entries = |event: &str| json!([{ "hooks": [{ "type": "command", "command": hook_command(cli, session_id, incarnation, event) }] }]);
    json!({
        "hooks": {
            "UserPromptSubmit": entries("UserPromptSubmit"),
            "Notification": entries("Notification"),
            "Stop": entries("Stop"),
        }
    })
}

/// Writes the settings file (creating `<data-dir>/hooks/`), after admission
/// minted the session identity and before the child spawns. The file must
/// exist before claude starts, since claude reads `--settings` at startup.
pub(crate) fn write_settings_file(
    path: &Path,
    cli: &str,
    session_id: &str,
    incarnation: &str,
) -> Result<(), RpcError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| error::io_error(format!("cannot create hooks dir: {e}")))?;
    }
    let payload = serde_json::to_string_pretty(&settings_json(cli, session_id, incarnation))
        .map_err(|e| error::internal_error(format!("cannot encode hook settings: {e}")))?;
    std::fs::write(path, payload)
        .map_err(|e| error::io_error(format!("cannot write hook settings: {e}")))?;
    Ok(())
}

/// Best-effort removal of a session's install artifact: a single settings
/// file for claude/pi, or a whole overlay directory tree for OpenCode's
/// `OPENCODE_CONFIG_DIR` overlay (see `harness_hooks::opencode::install`).
/// Missing paths are fine; this also covers a failed launch that never
/// reached spawn.
pub(crate) fn remove_settings_file(path: &Path) {
    if path.is_dir() {
        let _ = std::fs::remove_dir_all(path);
    } else {
        let _ = std::fs::remove_file(path);
    }
}

impl Engine {
    /// `session.hook_event {sessionId, incarnation, event}`: the
    /// `drogon-cli internal hook-event` callback from a session's harness
    /// hook file (claude's `--settings`, OpenCode's status plugin, or Pi's
    /// agent-status extension, or Codex's managed `CODEX_HOME/hooks.json`). A
    /// wait event stamps the handle
    /// `needs_input`; a clear event resets it explicitly for OpenCode, Pi, and
    /// interactive Codex (see `SessionHandle::set_explicit_wait_clear`). For
    /// Claude and headless runs, later PTY output/process exit provides the
    /// ordinary completion behavior. A stale incarnation or an exited
    /// session never gains a wait signal.
    pub(crate) fn do_session_hook_event(&self, params: &Value) -> Result<Value, RpcError> {
        let event = require_str(params, "event")?;
        let Some(signal) = crate::agent_state::classify_hook_event(event) else {
            return Err(error::invalid_argument(
                "event is not a recognized harness hook signal",
            ));
        };
        let (handle, _) = self.require_session_with_incarnation(params)?;
        if handle.is_exited() {
            return Err(error::unverifiable(
                "session already exited; hook event is moot",
            ));
        }
        if self
            .read_agent_settings()?
            .is_some_and(|settings| !settings.agent_status_hooks_enabled)
        {
            handle.clear_hook_event();
            return Ok(session::snapshot(&handle));
        }
        if let Some(prompt) = params.get("promptPreview").and_then(Value::as_str) {
            handle.note_agent_prompt(prompt);
        }
        handle.note_cache_event(event);
        match signal {
            // A headless daemon run (`pi -p`, `claude -p`, `opencode run`,
            // `codex exec`, `agy -p`) has no approval-answer surface: stamping a wait
            // signal would pin it at `needs_input` forever with nobody able
            // to answer (issue #186). Headless installs no hooks, so a wait
            // signal here is unexpected anyway — ignore it, never report it.
            // Its exit is the completion signal, not a hook event.
            HookSignal::Wait if handle.is_headless() => {}
            HookSignal::Wait => handle.note_hook_event(),
            HookSignal::TurnStart => handle.clear_hook_event(),
            HookSignal::TurnEnd => handle.end_hook_event(),
        }
        // R16-BF2 push: the hook signal moves the agent state now, so the
        // card/badge must learn about it now — not on the next poll.
        let snapshot = session::snapshot(&handle);
        crate::session_events::record_snapshot(&snapshot);
        Ok(snapshot)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_notification_is_a_wait_signal_and_stop_is_a_turn_end() {
        use crate::agent_state::{HookSignal, classify_hook_event};
        // Issue #360 fork parity: Claude's Stop means the turn concluded
        // (the fork maps it to done), never needs_input; Notification stays
        // this install's genuine-wait surface.
        assert_eq!(classify_hook_event("Notification"), Some(HookSignal::Wait));
        assert_eq!(classify_hook_event("Stop"), Some(HookSignal::TurnEnd));
    }

    #[test]
    fn remove_settings_file_deletes_a_directory_tree_too() {
        let dir = tempfile::tempdir().unwrap();
        let overlay = dir.path().join("overlay");
        std::fs::create_dir_all(overlay.join("plugins")).unwrap();
        std::fs::write(overlay.join("plugins").join("p.js"), "x").unwrap();
        remove_settings_file(&overlay);
        assert!(!overlay.exists());
    }

    #[test]
    fn hook_command_embeds_session_identity_and_event() {
        let command = hook_command("/opt/drogon/bin/drogon-cli", "sess-1", "inc-2", "Stop");
        assert!(
            command.contains("internal hook-event"),
            "must invoke the hidden CLI subcommand: {command}"
        );
        assert!(command.contains("--session sess-1"), "{command}");
        assert!(command.contains("--incarnation inc-2"), "{command}");
        assert!(command.contains("--event Stop"), "{command}");
    }

    #[test]
    fn hook_command_quotes_shell_metacharacters() {
        let command = hook_command("/tmp/my dir/drogon-cli", "s", "i", "Stop");
        assert!(
            command.starts_with("'/tmp/my dir/drogon-cli' "),
            "paths with spaces must be quoted: {command}"
        );
    }

    #[test]
    fn settings_json_has_notification_and_stop_hook_commands() {
        let value = settings_json("drogon-cli", "sess-1", "inc-2");
        for event in ["Notification", "Stop"] {
            let entries = value["hooks"][event]
                .as_array()
                .unwrap_or_else(|| panic!("hooks.{event} must be an array"));
            assert_eq!(entries.len(), 1, "one entry per event");
            let command = entries[0]["hooks"][0]["command"].as_str().unwrap();
            assert_eq!(entries[0]["hooks"][0]["type"], "command");
            assert!(
                command.contains(&format!("--event {event}")),
                "the {event} entry must report its own event: {command}"
            );
            assert!(command.contains("--session sess-1"), "{command}");
            assert!(command.contains("--incarnation inc-2"), "{command}");
        }
    }

    #[test]
    fn nonce_path_stays_under_the_data_dir_hooks_dir() {
        let dir = tempfile::tempdir().unwrap();
        let path = nonce_settings_path(dir.path(), "abc123");
        assert_eq!(path.parent().unwrap(), hooks_dir(dir.path()));
        assert_eq!(path.file_name().unwrap().to_str().unwrap(), "abc123.json");
    }

    #[test]
    fn write_then_remove_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = nonce_settings_path(dir.path(), "nonce-1");
        write_settings_file(&path, "drogon-cli", "sess-1", "inc-2").unwrap();
        let parsed: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert!(parsed["hooks"]["Stop"].is_array());
        assert!(parsed["hooks"]["Notification"].is_array());
        remove_settings_file(&path);
        assert!(!path.exists(), "removal must delete the file");
        remove_settings_file(&path);
    }
}
