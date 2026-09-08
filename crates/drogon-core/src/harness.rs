use std::path::PathBuf;

use drogon_harness::{
    HarnessAvailability, HarnessId, HarnessLaunchPlan, HarnessLaunchRequest, discover, plan_launch,
};
use drogon_protocol::RpcError;
use serde_json::{Value, json};

use crate::session::session_admission;
use crate::{Engine, error, require_dimension, require_str};

#[path = "harness_hooks/mod.rs"]
mod harness_hooks;

/// What's fixed *before* admission (the launch argv and, for Pi, the
/// `--extension` path) versus resolved *after* it (the incarnation the hook
/// commands embed) — the same two-phase shape `write_settings_file` already
/// needed for claude, generalized to OpenCode and Pi.
enum PendingHookInstall {
    None,
    Claude {
        path: PathBuf,
    },
    Opencode {
        nonce: String,
        existing_config_dir: Option<String>,
    },
    Pi {
        path: PathBuf,
    },
}

/// The install once admission minted real identity: every artifact to
/// remove on exit (claude/opencode: one; pi: its `--extension` file and its
/// sibling load marker), the environment overlay to apply on top of the
/// base session environment, and whether this harness clears `needs_input`
/// only through its own hook events (see
/// `SessionHandle::set_explicit_wait_clear`).
struct ReadyHookInstall {
    cleanup_paths: Vec<PathBuf>,
    extra_env: Vec<(String, String)>,
    explicit_wait_clear: bool,
}

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
        // Each harness's wait signal (permission prompts, questions, turn
        // end) is reported through `session.hook_event` by a per-harness
        // hook install below. Any argv the install needs (claude's
        // `--settings`, Pi's `--extension`) must be fixed before admission,
        // since admission mints the session id/incarnation the hook
        // commands embed — a nonce name breaks the cycle: argv carries the
        // path now, the file/overlay gains the real identity after
        // admission and before spawn.
        let mut args = plan.args;
        // Headless daemon runs (`pi -p`, `claude -p`, `opencode run`,
        // `agy -p`) consume the prompt and exit: no TUI to report wait
        // signals from, so no hook install either — installing one would
        // only risk pinning the run at `needs_input` with nobody able to
        // answer (issue #186).
        let pending = if request.headless {
            PendingHookInstall::None
        } else {
            match request.harness_id {
                HarnessId::Claude => {
                    let nonce = uuid::Uuid::new_v4().to_string();
                    let path = crate::hooks::nonce_settings_path(&self.data_dir, &nonce);
                    args.push("--settings".to_string());
                    args.push(path.to_string_lossy().into_owned());
                    PendingHookInstall::Claude { path }
                }
                HarnessId::Opencode => PendingHookInstall::Opencode {
                    nonce: uuid::Uuid::new_v4().to_string(),
                    // Why: mirrors the reference's `buildPtyHostEnv`, which
                    // resolves the user's existing config dir from its own
                    // process env rather than guessing OpenCode's default path.
                    existing_config_dir: std::env::var("OPENCODE_CONFIG_DIR").ok(),
                },
                HarnessId::Pi => {
                    let nonce = uuid::Uuid::new_v4().to_string();
                    let path = harness_hooks::pi::nonce_extension_path(&self.data_dir, &nonce);
                    args.push("--extension".to_string());
                    args.push(path.to_string_lossy().into_owned());
                    PendingHookInstall::Pi { path }
                }
                HarnessId::Antigravity => PendingHookInstall::None,
            }
        };
        let cols = require_dimension(params, "cols", 80)?;
        let rows = require_dimension(params, "rows", 24)?;
        let cwd = {
            let conn = self.db.lock().unwrap();
            crate::workspace::get_path(&conn, workspace_id)?
        };
        // Same reserve (admission) + commit + launch shape as
        // `session::spawn`, with the hook install written between commit
        // and spawn so its on-disk target exists (and its env values are
        // known) at startup.
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
        let cli = crate::session_env::cli_command_for_hooks(&self.data_dir);
        let ready = match self.finish_hook_install(pending, &cli, &prepared) {
            Ok(ready) => ready,
            Err(err) => {
                // Never leave a `pending` row a later recovery could misread
                // as a session that ran.
                let conn = self.db.lock().unwrap();
                let _ = conn.execute(
                    "UPDATE sessions SET verdict = 'exited', exit_code = NULL WHERE id = ?1 AND verdict = 'pending'",
                    [prepared.session_id()],
                );
                return Err(err);
            }
        };
        let extra_env = ready
            .as_ref()
            .map(|r| r.extra_env.clone())
            .unwrap_or_default();
        let (session_id, handle, session_json) = match session_admission::launch_reserved(
            self.db.clone(),
            &self.data_dir,
            prepared,
            None,
            &extra_env,
        ) {
            Ok(launched) => launched,
            Err(err) => {
                if let Some(ready) = &ready {
                    for path in &ready.cleanup_paths {
                        crate::hooks::remove_settings_file(path);
                    }
                }
                return Err(err);
            }
        };
        if request.headless {
            handle.set_headless();
        }
        if let Some(ready) = ready {
            for path in ready.cleanup_paths {
                handle.add_hook_cleanup_path(path);
            }
            if ready.explicit_wait_clear {
                handle.set_explicit_wait_clear();
            }
        }
        self.sessions
            .lock()
            .unwrap()
            .insert(session_id, handle.clone());
        // Retain ownership even when the post-spawn durable transition fails.
        crate::session::persist_admission(&handle)?;
        Ok(session_json)
    }

    /// Writes/installs the hook artifact now that admission minted the real
    /// session id/incarnation, and computes its environment overlay.
    /// `None` for harnesses without hook wiring (today: antigravity).
    fn finish_hook_install(
        &self,
        pending: PendingHookInstall,
        cli: &str,
        prepared: &session_admission::PreparedSession,
    ) -> Result<Option<ReadyHookInstall>, RpcError> {
        match pending {
            PendingHookInstall::None => Ok(None),
            PendingHookInstall::Claude { path } => {
                crate::hooks::write_settings_file(
                    &path,
                    cli,
                    prepared.session_id(),
                    prepared.incarnation(),
                )?;
                Ok(Some(ReadyHookInstall {
                    cleanup_paths: vec![path],
                    extra_env: Vec::new(),
                    explicit_wait_clear: false,
                }))
            }
            PendingHookInstall::Opencode {
                nonce,
                existing_config_dir,
            } => {
                let overlay = harness_hooks::opencode::install(
                    &self.data_dir,
                    &nonce,
                    existing_config_dir.as_deref(),
                )?;
                let mut extra_env =
                    crate::session_env::harness_hook_env(cli, prepared.incarnation());
                extra_env.push((
                    "OPENCODE_CONFIG_DIR".to_string(),
                    overlay.to_string_lossy().into_owned(),
                ));
                extra_env.push((
                    "DROGON_HOOK_MARKER".to_string(),
                    harness_hooks::opencode::marker_path(&overlay)
                        .to_string_lossy()
                        .into_owned(),
                ));
                Ok(Some(ReadyHookInstall {
                    // The load marker lives inside the overlay dir (see
                    // `opencode::marker_path`), so removing the overlay
                    // removes it too -- one cleanup path suffices.
                    cleanup_paths: vec![overlay],
                    extra_env,
                    explicit_wait_clear: true,
                }))
            }
            PendingHookInstall::Pi { path } => {
                harness_hooks::pi::write_extension_file(&path)?;
                let marker = harness_hooks::pi::marker_path(&path);
                let mut extra_env =
                    crate::session_env::harness_hook_env(cli, prepared.incarnation());
                extra_env.push((
                    "DROGON_HOOK_MARKER".to_string(),
                    marker.to_string_lossy().into_owned(),
                ));
                Ok(Some(ReadyHookInstall {
                    // The load marker is a sibling file, not inside a
                    // removable directory -- both paths need cleanup.
                    cleanup_paths: vec![path, marker],
                    extra_env,
                    explicit_wait_clear: true,
                }))
            }
        }
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
