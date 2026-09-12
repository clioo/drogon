// MIT Copyright (c) 2026 Lovecast Inc.
// Launch preference semantics ported from shared/tui-agent-launch-defaults.ts,
// tui-agent-permissions.ts and tui-agent-selection.ts. Storage is Drogon's own.
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use drogon_harness::{HarnessLaunchPlan, HarnessLaunchRequest, PermissionMode};
use drogon_protocol::RpcError;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{Engine, error};

/// Unknown fields are tolerated on read (no `deny_unknown_fields`) and
/// missing known fields fall back to the struct's own `Default` on purpose:
/// this file has no schema_versions-style migration scaffolding, so the
/// first time a newer build ever changes its shape, an owner rolling back
/// must lose NOTHING — the reader keeps every field it knows, ignores the
/// ones it does not, and defaults only what it cannot recover. The rewrite
/// path pairs this with a backup-before-rewrite (see
/// `do_agent_settings_update`) so even the fields a rewrite drops stay on
/// disk in `agent-settings.json.previous`.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct AgentSettings {
    pub default_tui_agent: Option<String>,
    pub disabled_tui_agents: Vec<String>,
    pub agent_cmd_overrides: BTreeMap<String, String>,
    pub agent_default_args: BTreeMap<String, String>,
    pub agent_default_env: BTreeMap<String, BTreeMap<String, String>>,
    pub agent_status_hooks_enabled: bool,
    pub tab_auto_generate_title: bool,
    pub prompt_cache_timer_enabled: bool,
    pub prompt_cache_ttl_ms: u64,
    pub codex_session_source_home: String,
}

impl Default for AgentSettings {
    fn default() -> Self {
        Self {
            default_tui_agent: None,
            disabled_tui_agents: Vec::new(),
            agent_cmd_overrides: BTreeMap::new(),
            agent_default_args: [
                ("claude", "--dangerously-skip-permissions"),
                ("codex", "--dangerously-bypass-approvals-and-sandbox"),
                ("antigravity", "--dangerously-skip-permissions"),
            ]
            .into_iter()
            .map(|(id, args)| (id.into(), args.into()))
            .collect(),
            agent_default_env: BTreeMap::new(),
            agent_status_hooks_enabled: true,
            tab_auto_generate_title: false,
            prompt_cache_timer_enabled: false,
            prompt_cache_ttl_ms: 300_000,
            codex_session_source_home: String::new(),
        }
    }
}

fn known(id: &str) -> bool {
    matches!(id, "claude" | "codex" | "opencode" | "pi" | "antigravity")
}

impl AgentSettings {
    fn with_launch_defaults(mut self) -> Self {
        for (id, args) in Self::default().agent_default_args {
            self.agent_default_args.entry(id).or_insert(args);
        }
        self
    }

    fn validate(&self) -> Result<(), RpcError> {
        if self
            .default_tui_agent
            .as_deref()
            .is_some_and(|id| id != "blank" && !known(id))
            || self.disabled_tui_agents.len() > 5
            || self.disabled_tui_agents.iter().any(|id| !known(id))
            || !matches!(self.prompt_cache_ttl_ms, 300_000 | 3_600_000)
        {
            return Err(error::invalid_argument("Invalid agent preference"));
        }
        for (id, command) in &self.agent_cmd_overrides {
            if !known(id) || command.len() > 4096 || command.chars().any(char::is_control) {
                return Err(error::invalid_argument("Invalid agent command"));
            }
        }
        for (id, args) in &self.agent_default_args {
            if !known(id) {
                return Err(error::invalid_argument("Unknown agent"));
            }
            split_launch_args(args)?;
        }
        for (id, env) in &self.agent_default_env {
            if !known(id)
                || env.len() > 64
                || serde_json::to_vec(env).unwrap_or_default().len() > 8192
            {
                return Err(error::invalid_argument("Invalid agent environment"));
            }
            for (key, value) in env {
                if key.is_empty()
                    || key.len() > 128
                    || !key.bytes().enumerate().all(|(i, b)| {
                        b == b'_' || b.is_ascii_alphabetic() || (i > 0 && b.is_ascii_digit())
                    })
                    || key.starts_with("DROGON_")
                    || key.starts_with("ORCA_")
                    || matches!(key.as_str(), "CODEX_HOME" | "TERM_PROGRAM")
                    || value.contains('\0')
                {
                    return Err(error::invalid_argument(
                        "Invalid or managed agent environment variable",
                    ));
                }
            }
        }
        let home = &self.codex_session_source_home;
        if home.len() > 4096
            || home.chars().any(char::is_control)
            || (!home.is_empty() && !Path::new(home).is_absolute())
        {
            return Err(error::invalid_argument(
                "Codex session source home must be an absolute path",
            ));
        }
        Ok(())
    }
}

// Argv tokenization, never shell evaluation: spaces/quotes/backslashes group
// arguments; $, pipes and redirects remain literal bytes passed to the binary.
pub(crate) fn split_launch_args(text: &str) -> Result<Vec<String>, RpcError> {
    if text.len() > 8192 || text.contains('\0') {
        return Err(error::invalid_argument(
            "Arguments must fit in 8192 bytes without NUL",
        ));
    }
    let mut args = Vec::new();
    let mut word = String::new();
    let mut quote = None;
    let mut escape = false;
    let mut started = false;
    for ch in text.chars() {
        if escape {
            word.push(ch);
            escape = false;
        } else if ch == '\\' && quote != Some('\'') {
            escape = true;
            started = true;
        } else if quote == Some(ch) {
            quote = None;
        } else if quote.is_none() && matches!(ch, '\'' | '"') {
            quote = Some(ch);
            started = true;
        } else if quote.is_none() && ch.is_whitespace() {
            if started {
                args.push(std::mem::take(&mut word));
                started = false;
            }
        } else {
            word.push(ch);
            started = true;
        }
    }
    if escape || quote.is_some() {
        return Err(error::invalid_argument(
            "Unclosed quote or trailing escape in arguments",
        ));
    }
    if started {
        args.push(word);
    }
    if args.len() > 256 {
        return Err(error::invalid_argument("Too many launch arguments"));
    }
    Ok(args)
}

pub(crate) fn resolve_command(command: &str) -> Option<PathBuf> {
    drogon_harness::resolve_executable(command, std::env::var_os("PATH").as_deref())
}

impl Engine {
    pub(crate) fn read_agent_settings(&self) -> Result<Option<AgentSettings>, RpcError> {
        let path = self.data_dir.join("agent-settings.json");
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(error::io_error("Cannot read agent settings")),
        };
        if bytes.len() > 131_072 {
            return Err(error::invalid_argument("Agent settings file is too large"));
        }
        let envelope: Value = serde_json::from_slice(&bytes)
            .map_err(|_| error::invalid_argument("Invalid agent settings file"))?;
        // A version this build does not know is refused SPECIFICALLY, not
        // with the generic parse failure: the owner must be able to tell a
        // rollback skew ("file is newer than this build") from corruption,
        // the same distinction the schema refusal draws for the database.
        // The file is left untouched; nothing rewrites it on a refused
        // read, so no setting is lost while the newer build is away.
        if envelope["version"] != 1 {
            return Err(error::invalid_argument(format!(
                "Agent settings file is version {} but this build only supports version 1; \
                 open it with the newer Drogon build it was written by",
                envelope["version"]
            )));
        }
        let settings = serde_json::from_value::<AgentSettings>(envelope["settings"].clone())
            .map_err(|_| error::invalid_argument("Invalid agent settings file"))?
            .with_launch_defaults();
        settings.validate()?;
        Ok(Some(settings))
    }

    pub(crate) fn agent_settings(&self) -> Result<Value, RpcError> {
        let settings = self.read_agent_settings()?;
        Ok(json!({ "initialized": settings.is_some(), "settings": settings.unwrap_or_default() }))
    }

    pub(crate) fn do_agent_settings_update(&self, params: &Value) -> Result<Value, RpcError> {
        let _guard = self.agent_settings_lock.lock().unwrap();
        let current = self.read_agent_settings()?;
        // Renderer migration must not overwrite preferences initialized by another window.
        if params["onlyIfUninitialized"] == true && current.is_some() {
            return self.agent_settings();
        }
        let status_hooks_were_enabled = current
            .as_ref()
            .is_none_or(|current| current.agent_status_hooks_enabled);
        let mut value = serde_json::to_value(current.unwrap_or_default()).unwrap();
        let patch = params["updates"]
            .as_object()
            .ok_or_else(|| error::invalid_argument("Expected agent settings updates"))?;
        for (key, next) in patch {
            if !value.as_object().unwrap().contains_key(key) {
                return Err(error::invalid_argument("Unknown agent setting"));
            }
            if matches!(
                key.as_str(),
                "agentCmdOverrides" | "agentDefaultArgs" | "agentDefaultEnv"
            ) {
                let entries = next
                    .as_object()
                    .ok_or_else(|| error::invalid_argument("Expected agent preference map"))?;
                let target = value[key].as_object_mut().unwrap();
                for (id, entry) in entries {
                    if !known(id) {
                        return Err(error::invalid_argument("Unknown agent"));
                    }
                    if entry.is_null() {
                        target.remove(id);
                    } else {
                        target.insert(id.clone(), entry.clone());
                    }
                }
            } else {
                value[key] = next.clone();
            }
        }
        let mut settings = serde_json::from_value::<AgentSettings>(value)
            .map_err(|_| error::invalid_argument("Invalid agent preferences"))?
            .with_launch_defaults();
        settings.validate()?;
        settings.disabled_tui_agents.sort();
        settings.disabled_tui_agents.dedup();
        if settings
            .default_tui_agent
            .as_ref()
            .is_some_and(|id| settings.disabled_tui_agents.contains(id))
        {
            settings.default_tui_agent = None;
        }
        let settings_path = self.data_dir.join("agent-settings.json");
        // Back up the previous file before any rewrite: a future build may
        // write a shape this build only partially understands, and the
        // rewrite itself drops exactly what the tolerant reader ignored.
        // `agent-settings.json.previous` keeps one full generation so the
        // owner (or a newer build) can always recover it. A backup failure
        // refuses the update — an unbacked rewrite is the one thing this
        // file must never do.
        if settings_path.exists() {
            let backup_temp = self
                .data_dir
                .join(format!(".agent-settings-previous-{}", uuid::Uuid::new_v4()));
            let backup_ok = std::fs::copy(&settings_path, &backup_temp).and_then(|_| {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    std::fs::set_permissions(
                        &backup_temp,
                        std::fs::Permissions::from_mode(0o600),
                    )?;
                }
                std::fs::rename(&backup_temp, self.data_dir.join("agent-settings.json.previous"))
            });
            if let Err(backup_error) = backup_ok {
                let _ = std::fs::remove_file(&backup_temp);
                return Err(error::io_error(format!(
                    "Cannot back up the previous agent settings file: {backup_error}"
                )));
            }
        }
        let payload = serde_json::to_vec(&json!({ "version": 1, "settings": settings })).unwrap();
        let temp = self
            .data_dir
            .join(format!(".agent-settings-{}", uuid::Uuid::new_v4()));
        let saved = (|| {
            use std::io::Write;
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temp)?;
            file.write_all(&payload)?;
            file.sync_all()?;
            std::fs::rename(&temp, settings_path)
        })();
        if saved.is_err() {
            let _ = std::fs::remove_file(&temp);
            return Err(error::io_error("Cannot save agent settings"));
        }
        if patch.contains_key("agentStatusHooksEnabled") {
            // Only a real transition touches live sessions: the reset in
            // `set_status_hooks_enabled` drops every lifecycle fact, and a
            // no-op re-save of the same value must not blip a running
            // claude turn back to `unknown` (the hooks re-report on their
            // own cadence). An actual flip — either direction — resets so
            // no fact can outlive the authority that produced it.
            let changed = status_hooks_were_enabled != settings.agent_status_hooks_enabled;
            if changed {
                let handles: Vec<_> = self.sessions.lock().unwrap().values().cloned().collect();
                for handle in handles {
                    handle.set_status_hooks_enabled(settings.agent_status_hooks_enabled)?;
                    crate::session_events::record_snapshot(&crate::session::snapshot(&handle));
                }
            }
        }
        Ok(json!({ "initialized": true, "settings": settings }))
    }
}

pub(crate) fn plan_with_settings(
    request: &HarnessLaunchRequest,
    settings: &AgentSettings,
) -> Result<HarnessLaunchPlan, RpcError> {
    let id = super::harness::harness_id_wire(request.harness_id);
    if settings
        .disabled_tui_agents
        .iter()
        .any(|disabled| disabled == id)
    {
        return Err(error::invalid_argument(
            "This agent is disabled in Settings → Agents",
        ));
    }
    let command = settings
        .agent_cmd_overrides
        .get(id)
        .filter(|cmd| !cmd.trim().is_empty())
        .map(String::as_str)
        .unwrap_or(request.harness_id.executable());
    let executable = resolve_command(command)
        .ok_or_else(|| error::not_found("Agent command is not installed on this execution host"))?;
    let mut request = request.clone();
    // Headless runs retain their explicit bot/automation policy; interactive
    // launches use the source's arguments instead of synthesized permission flags.
    if !request.headless {
        request.permission_mode = PermissionMode::Inherit;
    }
    let args = if request.headless {
        Vec::new()
    } else {
        split_launch_args(
            settings
                .agent_default_args
                .get(id)
                .map(String::as_str)
                .unwrap_or(""),
        )?
    };
    drogon_harness::plan_launch_with_args(&request, &executable, &args)
}

#[cfg(test)]
#[path = "agent_settings_tests.rs"]
mod tests;
