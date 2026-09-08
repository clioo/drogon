use drogon_harness::{
    HarnessAvailability, HarnessId, HarnessLaunchPlan, HarnessLaunchRequest, discover, plan_launch,
};
use drogon_protocol::RpcError;
use serde_json::{Value, json};

use crate::session::session_admission;
use crate::{Engine, error, require_dimension, require_str};

impl Engine {
    pub(super) fn harness_list(&self) -> Value {
        let path = std::env::var_os("PATH");
        json!({"hostId": self.host_id, "harnesses": discover(path.as_deref())})
    }

    pub(super) fn do_harness_start(&self, params: &Value) -> Result<Value, RpcError> {
        let workspace_id = require_str(params, "workspaceId")?;
        let request: HarnessLaunchRequest = serde_json::from_value(params.clone())
            .map_err(|_| error::invalid_argument("Invalid harness launch preferences"))?;
        let plan = resolve_launch(&request)?;
        // Claude Code waits (permission prompts, questions, end of turn) are
        // reported through `session.hook_event` by the per-session hooks
        // file below; other harnesses keep activity-based states. The
        // `--settings` path must be fixed before admission (admission mints
        // the session id the hook commands embed), so a nonce name breaks
        // the cycle: argv carries the path, the file gains the real ids
        // after admission and before spawn.
        let mut args = plan.args;
        let hook_settings = if request.harness_id == HarnessId::Claude {
            let nonce = uuid::Uuid::new_v4().to_string();
            let path = crate::hooks::nonce_settings_path(&self.data_dir, &nonce);
            args.push("--settings".to_string());
            args.push(path.to_string_lossy().into_owned());
            Some(path)
        } else {
            None
        };
        let cols = require_dimension(params, "cols", 80)?;
        let rows = require_dimension(params, "rows", 24)?;
        let cwd = {
            let conn = self.db.lock().unwrap();
            crate::workspace::get_path(&conn, workspace_id)?
        };
        // Same reserve (admission) + commit + launch shape as
        // `session::spawn`, with the hooks file written between commit and
        // spawn so claude's `--settings` target exists at startup.
        let prepared = {
            let conn = self.db.lock().unwrap();
            let tx = rusqlite::Transaction::new_unchecked(
                &conn,
                rusqlite::TransactionBehavior::Immediate,
            )
            .map_err(error::from_sqlite)?;
            let prepared = session_admission::reserve(
                &tx,
                &self.host_id,
                workspace_id,
                &cwd,
                &plan.command,
                &args,
                Some(harness_id_wire(request.harness_id).to_string()),
                cols,
                rows,
            )?;
            tx.commit().map_err(error::from_sqlite)?;
            prepared
        };
        if let Some(path) = &hook_settings
            && let Err(err) = crate::hooks::write_settings_file(
                path,
                &crate::session_env::cli_command_for_hooks(&self.data_dir),
                prepared.session_id(),
                prepared.incarnation(),
            )
        {
            // Never leave a `pending` row a later recovery could misread
            // as a session that ran.
            let conn = self.db.lock().unwrap();
            let _ = conn.execute(
                "UPDATE sessions SET verdict = 'exited', exit_code = NULL WHERE id = ?1 AND verdict = 'pending'",
                [prepared.session_id()],
            );
            return Err(err);
        }
        let (session_id, handle, session_json) = match session_admission::launch_reserved(
            self.db.clone(),
            &self.data_dir,
            prepared,
            None,
        ) {
            Ok(launched) => launched,
            Err(err) => {
                if let Some(path) = &hook_settings {
                    crate::hooks::remove_settings_file(path);
                }
                return Err(err);
            }
        };
        if let Some(path) = hook_settings {
            handle.set_hook_settings_file(path);
        }
        self.sessions
            .lock()
            .unwrap()
            .insert(session_id, handle.clone());
        // Retain ownership even when the post-spawn durable transition fails.
        crate::session::persist_admission(&handle)?;
        Ok(session_json)
    }
}

pub(crate) fn resolve_launch(
    request: &HarnessLaunchRequest,
) -> Result<HarnessLaunchPlan, RpcError> {
    let path = std::env::var_os("PATH");
    let installation = discover(path.as_deref())
        .into_iter()
        .find(|item| item.harness_id == request.harness_id)
        .ok_or_else(|| error::not_found("Unknown harness"))?;
    if installation.availability == HarnessAvailability::UnsupportedLauncher {
        return Err(RpcError::new(
            "unsupported_platform",
            "Harness needs a validated Windows launcher",
        ));
    }
    let executable = installation
        .executable
        .ok_or_else(|| error::not_found("Harness is not installed on this execution host"))?;
    plan_launch(request, &executable)
}

/// The wire spelling of the harness id, matching the shared session
/// contract's `HarnessId` union ("claude" | "pi" | "opencode" |
/// "antigravity") so a session record round-trips into `harness.start`.
fn harness_id_wire(harness_id: HarnessId) -> &'static str {
    match harness_id {
        HarnessId::Claude => "claude",
        HarnessId::Pi => "pi",
        HarnessId::Opencode => "opencode",
        HarnessId::Antigravity => "antigravity",
    }
}
