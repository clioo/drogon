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
//! `pi` only) and message-preview capture. The reference's session-metadata
//! capture IS ported, as the conversation locator: `session_start` hands this
//! extension Pi's own `sessionManager`, and every report carries
//! `session_id`/`session_file` so the daemon can record which conversation
//! the session is (a Resume then reopens THAT one — `pi --session <id|file>`
//! — instead of asking Pi for its most recent session in the directory, which
//! starts a NEW one when the store has nothing to continue). The
//! `DROGON_SESSION_ID`/`DROGON_HOOK_INCARNATION` environment identity still
//! names the CALLBACK, not the conversation.

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

/// Where the extension writes its load-time marker (`DROGON_HOOK_MARKER`):
/// proof the extension module actually executed inside Pi, independent of
/// whether any `pi.on(...)` handler above ever fires — needed for a live
/// launch verification that sends no prompt (plain Pi's own `session_start`
/// is a UI-only event this repo does not wire; the source itself treats it
/// as a no-op for non-OMP kinds, so it is not a reliable pre-prompt signal
/// either).
pub(crate) fn marker_path(extension_path: &Path) -> PathBuf {
    let mut name = extension_path.as_os_str().to_owned();
    name.push(".loaded");
    PathBuf::from(name)
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

// The conversation locator Pi itself owns, captured at session_start and
// attached to every report: the daemon stores it on this session's row, and
// that is what makes a later Resume open THIS conversation
// (`pi --session <id|file>`) instead of silently starting a new one.
var identity = {{}}

function captureIdentity(ctx) {{
  try {{
    var manager = ctx && ctx.sessionManager
    if (!manager) return
    var id = typeof manager.getSessionId === "function" ? manager.getSessionId() : undefined
    var file = typeof manager.getSessionFile === "function" ? manager.getSessionFile() : undefined
    if (typeof id === "string" && id) identity.session_id = id
    if (typeof file === "string" && file) identity.session_file = file
  }} catch (err) {{
    // Why: the locator only feeds the reopen path; never fail the run over it.
  }}
}}

function report(eventName, prompt, usage) {{
  var cli = process.env.DROGON_HOOK_CLI || "drogon-cli"
  var sessionId = process.env.DROGON_SESSION_ID || ""
  var incarnation = process.env.DROGON_HOOK_INCARNATION || ""
  if (!sessionId || !incarnation) return
  return new Promise(function (resolve) {{
    try {{
      var child = require("node:child_process").execFile(
        cli,
        ["internal", "hook-event", "--session", sessionId, "--incarnation", incarnation, "--event", eventName],
        {{ timeout: 5000, maxBuffer: 65536, windowsHide: true }},
        function () {{ resolve() }}
      )
      if (child.stdin) {{
        child.stdin.on("error", function () {{}})
        child.stdin.end(JSON.stringify({{
          prompt: typeof prompt === "string" ? prompt.slice(0, 512) : undefined,
          piUsage: usage,
          session_id: identity.session_id,
          session_file: identity.session_file
        }}))
      }}
    }} catch (err) {{ resolve() }}
  }})
}}

// Why: proves the extension module actually executed inside pi even when no
// pi.on(...) handler below ever fires (e.g. a live check that sends no
// prompt) -- independent of the report() transport above.
try {{
  var markerPath = process.env.DROGON_HOOK_MARKER
  if (markerPath) require("node:fs").writeFileSync(markerPath, String(Date.now()))
}} catch (err) {{
  // Why: the marker is a diagnostic only; never fail the pi run over it.
}}

export default function (pi) {{
  // Pi hands over its sessionManager here and nowhere else, so this is where
  // the conversation locator is captured; the event itself lands the row on
  // the idle session boundary (a just-launched TUI is not working). Reported
  // BEFORE the usage-only return below: a coordination worker's launch still
  // needs its conversation recorded even though it reports no turn signals.
  pi.on("session_start", function (event, ctx) {{
    captureIdentity(ctx)
    return report("{session_start}")
  }})
  pi.on("message_end", async function (event) {{
    var message = event && event.message
    if (!message || message.role !== "assistant" || !message.usage) return
    if (typeof message.provider !== "string" || typeof message.model !== "string" || !Number.isFinite(message.timestamp)) return
    var reported = {{}}
    var keys = {{ input: "inputTokens", output: "outputTokens", cacheRead: "cacheReadTokens", cacheWrite: "cacheWriteTokens" }}
    for (var key of Object.keys(keys)) {{
      var value = message.usage[key]
      if (Number.isSafeInteger(value) && value >= 0) reported[keys[key]] = value
    }}
    if (!Object.keys(reported).length) return
    if ((message.stopReason === "error" || message.stopReason === "aborted") && !Object.values(reported).some(function (value) {{ return value > 0 }})) return
    // Hash for replay identity only; no message content crosses the hook transport.
    reported.id = require("node:crypto").createHash("sha256").update(JSON.stringify([
      message.timestamp, message.provider, message.model, message.usage, message.content
    ])).digest("hex")
    reported.model = message.provider + "/" + message.model
    await report("PiUsage", undefined, reported)
  }})
  if (process.env.DROGON_HOOK_USAGE_ONLY === "1") return
  pi.on("before_agent_start", function (event) {{ return report("{agent_start}", event && event.prompt) }})
  pi.on("agent_start", function () {{ return report("{agent_start}") }})
  pi.on("tool_execution_start", function () {{ return report("{tool_start}") }})
  pi.on("tool_call", function () {{ return report("{tool_start}") }})
  pi.on("tool_approval_requested", function () {{ return report("{tool_approval_requested}") }})
  pi.on("tool_approval_resolved", function () {{ return report("{tool_approval_resolved}") }})
  pi.on("agent_settled", function () {{ return report("{agent_end}") }})
  pi.on("agent_end", function (event) {{
    if (event && event.willContinue === true) return
    return report("{agent_end}")
  }})
}}
"#,
        agent_start = ev::AGENT_START,
        tool_start = ev::TOOL_START,
        tool_approval_requested = ev::TOOL_APPROVAL_REQUESTED,
        tool_approval_resolved = ev::TOOL_APPROVAL_RESOLVED,
        agent_end = ev::AGENT_END,
        session_start = ev::SESSION_START,
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
            ev::SESSION_START,
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
        assert!(source.contains("DROGON_HOOK_MARKER"));
    }

    /// The conversation locator is the whole point of the extension's second
    /// job: Pi's own session id/file, captured where Pi hands them over and
    /// attached to every payload the daemon reads (the CLI maps
    /// `session_id` -> `agentSessionId`, `session_file` -> transcript path).
    #[test]
    fn extension_source_reports_the_pi_conversation_locator() {
        let source = extension_source();
        assert!(source.contains("pi.on(\"session_start\""));
        assert!(source.contains("captureIdentity(ctx)"));
        assert!(source.contains("ctx.sessionManager"));
        assert!(source.contains("getSessionId"));
        assert!(source.contains("getSessionFile"));
        // The keys the hook transport reads, on the same payload as the
        // status signal (never a second transport).
        assert!(source.contains("session_id: identity.session_id"));
        assert!(source.contains("session_file: identity.session_file"));
        assert_eq!(source.matches("child.stdin.end(").count(), 1);
    }

    /// The session boundary report is registered ahead of the usage-only
    /// return, so a coordination worker's conversation is recorded too: that
    /// launch mode deliberately reports no turn/wait signals, but its
    /// conversation is exactly what a human (or the coordinator) wants back
    /// after the service restarts.
    #[test]
    fn extension_source_reports_the_session_boundary_before_the_usage_only_return() {
        let source = extension_source();
        let boundary = source
            .find("pi.on(\"session_start\"")
            .expect("the session boundary must be registered");
        let usage_only = source
            .find("DROGON_HOOK_USAGE_ONLY")
            .expect("the usage-only switch must exist");
        assert!(
            boundary < usage_only,
            "the locator capture must precede the usage-only return"
        );
        assert!(source.contains(&format!("return report(\"{}\")", ev::SESSION_START)));
    }

    #[test]
    fn marker_path_is_a_sibling_of_the_extension_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = nonce_extension_path(dir.path(), "abc123");
        assert_eq!(marker_path(&path), path.with_extension("ts.loaded"));
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
