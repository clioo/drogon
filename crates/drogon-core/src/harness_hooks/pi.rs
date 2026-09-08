//! Pi agent-status extension install (journey J1 `needs_input`).
//!
//! Ported event wiring from the read-only reference's
//! `src/main/pi/agent-status-handler-source.ts` (the `pi.on(...)`
//! registrations only). MIT Copyright (c) 2026 Lovecast Inc.
//!
//! Adapted mechanism: the source writes a managed extension file directly
//! into the user's real `~/.pi/agent/extensions/` (or `PI_CODING_AGENT_DIR`)
//! so it survives across relaunches, gated by an ownership-marker comment.
//! Pi's own CLI instead exposes `--extension <path>` ("Load an extension
//! file, can be used multiple times") which loads one extra file *without*
//! touching the user's real agent directory or its normal extension
//! discovery at all — a stronger reading of "preserving the user's own
//! config" than mutating their directory, and it lets this file follow the
//! same nonce-path-in-argv / write-after-admission / remove-on-exit
//! lifecycle as Claude's `--settings` file (`hooks.rs`), with no directory
//! overlay or ownership-marker bookkeeping needed.
//!
//! Deliberately not ported: OMP/Prime runtime detection
//! (`agent-status-runtime-detection-source.ts` — this repo targets plain
//! `pi` only), session-metadata/resume-file capture (session identity here
//! travels over `DROGON_SESSION_ID`/`DROGON_HOOK_INCARNATION`, not a
//! resumable pi session file), and message-preview capture.

use std::path::{Path, PathBuf};

use drogon_protocol::RpcError;

use crate::agent_state::pi_events as ev;
use crate::error;

/// Per-session extension file; a fresh nonce per launch keeps cleanup a
/// single file removal with no cross-session sharing to reason about.
pub(crate) fn nonce_extension_path(data_dir: &Path, nonce: &str) -> PathBuf {
    data_dir
        .join("harness-hooks")
        .join("pi")
        .join(format!("{nonce}.ts"))
}

pub(crate) fn write_extension_file(path: &Path) -> Result<(), RpcError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| error::io_error(format!("cannot create pi extensions dir: {e}")))?;
    }
    std::fs::write(path, extension_source())
        .map_err(|e| error::io_error(format!("cannot write pi extension: {e}")))
}

/// The extension source loaded via `--extension`. Identity comes from the
/// session environment at report time, not baked into this string, so the
/// same content works for every session.
pub(crate) fn extension_source() -> String {
    format!(
        r#"// MIT Copyright (c) 2026 Lovecast Inc.
// Ported pi.on(...) event names from the Drogon read-only reference's
// src/main/pi/agent-status-handler-source.ts. Reports through
// `drogon-cli internal hook-event` instead of the source's HTTP loopback
// hooks server; see harness_hooks::pi for what else is not ported.

function report(eventName) {{
  var cli = process.env.DROGON_HOOK_CLI || "drogon-cli"
  var sessionId = process.env.DROGON_SESSION_ID || ""
  var incarnation = process.env.DROGON_HOOK_INCARNATION || ""
  if (!sessionId || !incarnation) return
  try {{
    require("node:child_process").execFile(
      cli,
      ["internal", "hook-event", "--session", sessionId, "--incarnation", incarnation, "--event", eventName],
      {{ stdio: "ignore" }},
      function () {{}}
    )
  }} catch (err) {{
    // Why: a hook-report failure must never fail the pi run.
  }}
}}

export default function (pi) {{
  pi.on("before_agent_start", function () {{ report("{agent_start}") }})
  pi.on("agent_start", function () {{ report("{agent_start}") }})
  pi.on("tool_execution_start", function () {{ report("{tool_start}") }})
  pi.on("tool_call", function () {{ report("{tool_start}") }})
  pi.on("tool_approval_requested", function () {{ report("{tool_approval_requested}") }})
  pi.on("tool_approval_resolved", function () {{ report("{tool_approval_resolved}") }})
  pi.on("agent_settled", function () {{ report("{agent_end}") }})
  pi.on("agent_end", function (event) {{
    if (event && event.willContinue === true) return
    report("{agent_end}")
  }})
}}
"#,
        agent_start = ev::AGENT_START,
        tool_start = ev::TOOL_START,
        tool_approval_requested = ev::TOOL_APPROVAL_REQUESTED,
        tool_approval_resolved = ev::TOOL_APPROVAL_RESOLVED,
        agent_end = ev::AGENT_END,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nonce_path_is_scoped_under_the_data_dir_with_a_ts_extension() {
        let dir = tempfile::tempdir().unwrap();
        let path = nonce_extension_path(dir.path(), "abc123");
        assert_eq!(
            path,
            dir.path()
                .join("harness-hooks")
                .join("pi")
                .join("abc123.ts")
        );
    }

    #[test]
    fn extension_source_contains_the_mit_notice_and_every_event_name() {
        let source = extension_source();
        assert!(source.contains("MIT Copyright (c) 2026 Lovecast Inc."));
        assert!(source.contains("internal hook-event"));
        assert!(source.contains("export default function (pi)"));
        for name in [
            ev::AGENT_START,
            ev::TOOL_START,
            ev::TOOL_APPROVAL_REQUESTED,
            ev::TOOL_APPROVAL_RESOLVED,
            ev::AGENT_END,
        ] {
            assert!(source.contains(name), "missing event name {name}: {source}");
        }
        assert!(source.contains("willContinue"));
        assert!(source.contains("DROGON_HOOK_CLI"));
        assert!(source.contains("DROGON_SESSION_ID"));
        assert!(source.contains("DROGON_HOOK_INCARNATION"));
    }

    #[test]
    fn write_then_remove_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = nonce_extension_path(dir.path(), "nonce-1");
        write_extension_file(&path).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), extension_source());
        crate::hooks::remove_settings_file(&path);
        assert!(!path.exists());
    }
}
