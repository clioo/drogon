//! `drogon-core`: the engine behind `drogond`. Implements
//! `docs/migration/protocol-v1.md`'s methods against a single host-owned
//! SQLite database and `portable-pty` sessions. `drogond` owns framing,
//! auth and the transport; this crate never sees a raw socket.

mod automation_rpc;
pub mod automations;
mod bot_mutation_rpc;
pub mod bot_run_rpc;
mod bot_snapshot_rpc;
pub mod bots;
pub mod claim_identity;
mod coordination_access;
mod coordination_attempts;
mod coordination_identity;
mod coordination_launch;
mod coordination_mail;
mod coordination_mail_groups;
mod coordination_mail_rpc;
mod coordination_output;
mod coordination_question_rpc;
mod coordination_receipts;
mod coordination_runs;
mod coordination_worker_control;
mod coordination_workers;
mod desktop_relay_rpc;
pub mod jira;
pub mod locale_ordering;
pub mod mentu;
mod mentu_rpc;
pub mod session_authority;

mod agent_state;
mod db;
pub(crate) use desktop_relay_rpc::RelayState;
mod agent_settings;
mod error;
pub mod git;
pub mod git_process;
mod git_rpc;
pub mod git_worktree;
mod harness;
mod hooks;
mod project;
// R16-BC (additive): `ports.kill` — workspace-owned process stop.
mod ports;
mod ring;
mod session;
mod session_env;
mod workspace;
mod workspace_file_rpc;
mod workspace_files;
mod worktree_rpc;

mod service_quiescence;
mod session_events;

/// Public only for the `gh`-binary test seam (`set_gh_bin_override`);
/// the RPC surface stays `Engine::dispatch`.
pub mod tasks_rpc;

pub mod requests;

#[cfg(test)]
#[path = "dispatch_authenticated_tests.rs"]
mod dispatch_authenticated_tests;

#[cfg(test)]
mod session_stop_tests;

/// The on-disk SQLite filename under a data directory, exposed so
/// integration tests (a separate crate that only sees `pub` items) can open
/// their own connection to the same file for fault injection.
pub use db::DB_FILE_NAME;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock, RwLockWriteGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use drogon_protocol::{PROTOCOL_VERSION, Request, Response, RpcError};
use requests::RequestLedger;
use rusqlite::{Connection, OptionalExtension};
use serde_json::{Value, json};
use session::SessionHandle;

const CAPABILITIES: &[&str] = &[
    "automation.v1",
    "orchestration.native.v1",
    "workspace.v1",
    "files.v1",
    "session.pty.v1",
    "session.cursor-read.v1",
    "session.incarnation.v1",
    "request.idempotency.v1",
    "harness.catalog.v1",
    "harness.launch.v1",
    "agent.settings.v1",
    "git.v1",
    drogon_protocol::browser::BROWSER_RELAY_CAPABILITY,
    "runtime.quiescent-shutdown.v1",
    drogon_protocol::project::PROJECT_CAPABILITY,
    drogon_protocol::worktree::WORKTREE_CAPABILITY,
    drogon_protocol::tasks::TASKS_CAPABILITY,
    "session.agent-state.v1",
    // R2-S: the Bots page (list/create/chat/history) is real end-to-end as
    // of this capability landing; desktop's `isBotsAvailable` gate
    // (apps/desktop/src/renderer/src/bots-mount.ts) has referenced this
    // exact string all along, dark until now.
    "bot.snapshot.v1",
    // R5-S: Mentu (recipes, content-bound approval, execution through the
    // pinned mentu-recipes runtime, run evidence, retry).
    drogon_protocol::mentu::MENTU_CAPABILITY,
];

pub(crate) fn now_rfc3339() -> String {
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    humantime_rfc3339(dur.as_secs(), dur.subsec_nanos())
}

pub(crate) fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

/// Minimal UTC RFC3339 formatter so this crate does not need a chrono/time
/// dependency for one timestamp column. Deliberately second-resolution.
fn humantime_rfc3339(secs: u64, _nanos: u32) -> String {
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, mo, d) = civil_from_days(days as i64);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

/// Howard Hinnant's civil-from-days algorithm (public domain), used instead
/// of pulling in a date/time crate for one column's formatting.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub struct Engine {
    data_dir: PathBuf,
    db: Arc<Mutex<Connection>>,
    host_id: String,
    service_instance_id: String,
    sessions: Mutex<HashMap<String, Arc<SessionHandle>>>,
    agent_settings_lock: Mutex<()>,
    ledger: RequestLedger,
    /// In-memory desktop command relay (browser.relay.v1). Never persisted;
    /// a daemon restart drops every queued command.
    desktop_relay: Mutex<RelayState>,
    worker_cli: Option<PathBuf>,
    worker_operations: Mutex<HashMap<String, std::sync::Weak<Mutex<()>>>>,
    /// R17-A: Jira integration state (site/token store, per-site request
    /// queues, in-flight search registry). Lives on the Engine so parallel
    /// tests with their own temp data dirs never share it. No outer mutex:
    /// every member locks itself, and a search must never hold a lock
    /// across its HTTP call or `jira.cancelSearchIssues` could not run on
    /// another connection until the search finished.
    jira: jira::JiraState,
    /// Lifecycle admission gate for quiescent shutdown. Every mutating
    /// method (`Engine::mutating`) holds the *read* side across its whole
    /// ledger interaction — admission, the work itself (including PTY
    /// spawn/IO/wait), and the durable receipt completion — while read-only
    /// methods never touch the gate at all, so unrelated normal I/O is not
    /// serialized. Shared holders never block each other, and the write
    /// side is only ever try-acquired, so no reader ever queues behind a
    /// pending writer.
    /// `runtime.shutdown` try-acquires the *write* side and retains it from
    /// its all-exited check through the durable receipt persist and the
    /// `quiescent` store (`do_runtime_shutdown`), refusing `runtime_busy`
    /// rather than blocking behind in-flight work — that single span makes
    /// admission atomic with the freeze.
    lifecycle_gate: RwLock<()>,
    /// Set once a `runtime.shutdown` request has durably persisted an
    /// accepted receipt. The server uses its separate post-reply gate to
    /// stop listening; this flag only fences core mutations.
    quiescent: AtomicBool,
    /// Test-only admission-window seam: when set, `do_runtime_shutdown`
    /// invokes it exactly once between the ledger's durable receipt persist
    /// and the `quiescent` store, passing `self` so the test can observe
    /// gate state inside that precise window — the one the admission fix
    /// must keep closed. Kept on the instance (not a process global) so
    /// parallel unit tests can never consume each other's hook; invisible
    /// to other crates and absent from production builds.
    #[cfg(test)]
    pre_freeze_hook: Mutex<Option<PreFreezeHook>>,
}

/// Test-only seam type for [`Engine::pre_freeze_hook`]; exists only under
/// `cfg(test)`.
#[cfg(test)]
type PreFreezeHook = Box<dyn Fn(&Engine) + Send>;

impl Engine {
    pub fn open(data_dir: &Path) -> Result<Engine, RpcError> {
        fs::create_dir_all(data_dir)
            .map_err(|e| error::io_error(format!("cannot create data dir: {e}")))?;
        // This crate's own precondition, independent of any caller (such as
        // `drogond::serve`) that may additionally guard its own entry path:
        // `Engine::open` is the documented entry point and must not trust a
        // symlinked data directory or silently continue past a permission
        // failure it could not actually apply.
        reject_unsafe_data_dir(data_dir)?;
        // Resolve platform aliases such as macOS /var before SQLite's no-follow open.
        let canonical_data_dir = fs::canonicalize(data_dir)
            .map_err(|e| error::io_error(format!("cannot resolve data dir: {e}")))?;
        let data_dir = canonical_data_dir.as_path();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(data_dir, fs::Permissions::from_mode(0o700)).map_err(|e| {
                error::io_error(format!("cannot restrict data dir permissions: {e}"))
            })?;
        }

        db::validate_files(data_dir)
            .map_err(|e| error::io_error(format!("Unsafe database files: {e}")))?;
        let conn = db::open(data_dir).map_err(error::from_sqlite)?;
        // Migration refusal must roll back recovery and host identity too.
        let gate = db::migrate_and_recover(&conn);
        // Refusal can leave files behind; permission failures take precedence.
        #[cfg(unix)]
        db::harden_permissions(data_dir).map_err(|e| {
            error::io_error(format!("cannot restrict database file permissions: {e}"))
        })?;
        let host_id =
            gate.map_err(|e| error::internal_error(format!("startup schema/recovery gate: {e}")))?;

        // Every Drogon terminal resolves `drogon-cli`/`drogon` through these
        // shims; installing them here keeps hook commands and session `PATH`
        // lookups pointed at this daemon's CLI.
        session_env::install_shims(data_dir)?;

        Ok(Engine {
            data_dir: data_dir.to_path_buf(),
            db: Arc::new(Mutex::new(conn)),
            host_id,
            service_instance_id: uuid::Uuid::new_v4().to_string(),
            sessions: Mutex::new(HashMap::new()),
            agent_settings_lock: Mutex::new(()),
            ledger: RequestLedger::default(),
            desktop_relay: Mutex::new(RelayState::default()),
            worker_cli: None,
            worker_operations: Mutex::new(HashMap::new()),
            jira: jira::JiraState::new(data_dir),
            lifecycle_gate: RwLock::new(()),
            quiescent: AtomicBool::new(false),
            #[cfg(test)]
            pre_freeze_hook: Mutex::new(None),
        })
    }

    /// Whether a `runtime.shutdown` request has durably admitted this
    /// instance for quiescent shutdown. Never true as a side effect of a
    /// refused or unpersisted attempt — see `do_runtime_shutdown`.
    pub fn is_quiescent(&self) -> bool {
        self.quiescent.load(Ordering::Acquire)
    }

    /// The data directory this instance opened. Used by `mentu_rpc` to
    /// resolve the pinned `mentu-recipes` runtime at
    /// `<data_dir>/mentu/runtime/bin/mentu-recipes`.
    pub(crate) fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    /// A clone of this instance's shared database handle, for a background
    /// thread (Mentu's run watcher) to write a result back with once the
    /// RPC call that started it has already returned.
    pub(crate) fn db_handle(&self) -> Arc<Mutex<Connection>> {
        self.db.clone()
    }

    pub fn dispatch(&self, request: Request) -> Response {
        if let Err(err) = request.validate() {
            return Response::failure(request.request_id, err);
        }
        let result = self.dispatch_inner(&request);
        match result {
            Ok(value) => Response::success(request.request_id, value),
            Err(err) => Response::failure(request.request_id, err),
        }
    }

    /// Resolve worker authority without entering the trusted admin dispatcher.
    pub fn dispatch_authenticated(&self, request: Request, service_credential: &str) -> Response {
        if let Err(err) = request.validate() {
            return Response::failure(request.request_id, err);
        }
        if request.auth.as_deref() == Some(service_credential) {
            return self.finish_dispatch(request);
        }
        let authorized = {
            let conn = self.db.lock().unwrap();
            coordination_access::authorize_worker(
                &conn,
                &self.host_id,
                request.auth.as_deref().unwrap_or(""),
                &request.method,
                &request.params,
            )
        };
        match authorized {
            Ok(binding) => self.dispatch_worker(binding, request),
            Err(err) => Response::failure(request.request_id, err),
        }
    }

    fn finish_dispatch(&self, request: Request) -> Response {
        match self.dispatch_inner(&request) {
            Ok(value) => Response::success(request.request_id, value),
            Err(err) => Response::failure(request.request_id, err),
        }
    }

    // Recheck exact identity because revocation can race entry authorization.
    fn dispatch_worker(
        &self,
        binding: coordination_access::WorkerBinding,
        request: Request,
    ) -> Response {
        let rechecked = {
            let conn = self.db.lock().unwrap();
            let tx = match conn.unchecked_transaction() {
                Ok(tx) => tx,
                Err(err) => return Response::failure(request.request_id, error::from_sqlite(err)),
            };
            let result = coordination_access::recheck_in_tx(&tx, &binding, &request.method);
            let _ = tx.rollback();
            result
        };
        match rechecked {
            Err(err) => Response::failure(request.request_id, err),
            Ok(_) if request.method == "status" => {
                Response::success(request.request_id, self.status())
            }
            Ok(_) if request.method == "orchestration.requestShow" => {
                match self.show_coordination_receipt(&request, Some(&binding)) {
                    Ok(value) => Response::success(request.request_id, value),
                    Err(err) => Response::failure(request.request_id, err),
                }
            }
            Ok(_)
                if matches!(
                    request.method.as_str(),
                    "orchestration.send" | "orchestration.check"
                ) =>
            {
                match self.dispatch_worker_mail(&binding, &request) {
                    Ok(value) => Response::success(request.request_id, value),
                    Err(err) => Response::failure(request.request_id, err),
                }
            }
            Ok(_)
                if matches!(
                    request.method.as_str(),
                    "orchestration.ask" | "orchestration.reply"
                ) =>
            {
                match self.dispatch_coordination_question(&request, Some(&binding)) {
                    Ok(value) => Response::success(request.request_id, value),
                    Err(err) => Response::failure(request.request_id, err),
                }
            }
            Ok(_) => {
                Response::failure(request.request_id, error::method_not_found(&request.method))
            }
        }
    }

    fn dispatch_inner(&self, request: &Request) -> Result<Value, RpcError> {
        match request.method.as_str() {
            "status" => Ok(self.status()),
            "runtime.shutdown" => self.do_runtime_shutdown(request),
            "harness.list" => self.harness_list(),
            "agent.settings" => self.agent_settings(),
            "agent.settings_update" => self.mutating(request, Self::do_agent_settings_update),
            "bot.snapshot" => self.bot_snapshot(&request.params),
            "bot.create" => self.bot_create(request),
            "bot.run" => self.bot_run(request),
            "bot.responsibility_create" => self.bot_responsibility_create(request),
            "bot.responsibility_delete" => self.bot_responsibility_delete(request),
            "bot.delete" => self.bot_delete(request),
            "automation.create" => self.automation_create(request),
            "automation.list" => self.automation_list(&request.params),
            "automation.update" => self.automation_update(request),
            "automation.delete" => self.automation_delete(request),
            "automation.run_now" => self.automation_run_now(request),
            "automation.history" => self.automation_history(&request.params),
            "automation.runs_all" => self.automation_runs_all(&request.params),
            "automation.run" => self.automation_run(request),
            "bot.history" => self.bot_history(&request.params),
            "files.list" => self.do_files_list(&request.params),
            // R16-AM (coordinator-owned one-liner): read-only ignored-paths
            // query behind the explorer's git-ignored dimming.
            "files.ignored" => self.do_files_ignored(&request.params),
            "files.search" => self.do_files_search(&request.params),
            "files.read" => self.do_files_read(&request.params),
            "files.write" => self.mutating(request, Self::do_files_write),
            "files.create" => self.mutating(request, Self::do_files_create),
            "files.rename" => self.mutating(request, Self::do_files_rename),
            "files.delete" => self.mutating(request, Self::do_files_delete),
            "desktop.commands.poll" => self.desktop_commands_poll(&request.params),
            "desktop.commands.complete" => self.desktop_commands_complete(&request.params),
            "browser.open" => self.do_browser_open(&request.params),
            "browser.navigate" => self.do_browser_navigate(&request.params),
            "browser.snapshot" => self.do_browser_snapshot(&request.params),
            "browser.click" => self.do_browser_click(&request.params),
            "browser.fill" => self.do_browser_fill(&request.params),
            "browser.tabs" => self.do_browser_tabs(&request.params),
            "git.status" => self.do_git_status(&request.params),
            "git.diff" => self.do_git_diff(&request.params),
            "git.stage" => self.mutating(request, Self::do_git_stage),
            "git.unstage" => self.mutating(request, Self::do_git_unstage),
            "git.commit" => self.mutating(request, Self::do_git_commit),
            "git.push" => self.mutating(request, Self::do_git_push),
            "git.discard" => self.mutating(request, Self::do_git_discard),
            "git.line_counts" => self.do_git_line_counts(&request.params),
            "git.pull" => self.mutating(request, Self::do_git_pull),
            "git.fetch" => self.mutating(request, Self::do_git_fetch),
            "git.pr_create" => self.mutating(request, Self::do_git_pr_create),
            "harness.start" => self.mutating(request, Self::do_harness_start),
            "workspace.register" => self.mutating(request, Self::do_workspace_register),
            "workspace.list" => {
                let conn = self.db.lock().unwrap();
                workspace::list(&conn)
            }
            "session.start" => self.mutating(request, Self::do_session_start),
            "session.list" => self.do_session_list(&request.params),
            "session.read" => self.do_session_read(&request.params),
            "session.write" => self.mutating(request, Self::do_session_write),
            "session.resize" => self.mutating(request, Self::do_session_resize),
            "session.stop" => self.mutating(request, Self::do_session_stop),
            // R16-AL2 (issue #228): the user-initiated close paths. `close`
            // stops a live PTY this instance owns and then forgets the
            // record; `forget` removes a record that has no live handle
            // (a stub or an exited row) and refuses a live one. Both keep
            // the liveness rule: the returned verdict is only ever observed
            // truth, never loss-of-contact rewritten as exit.
            "session.close" => self.mutating(request, Self::do_session_close),
            "session.forget" => self.mutating(request, Self::do_session_forget),
            "session.hook_event" => self.mutating(request, Self::do_session_hook_event),
            // R16-BC (additive): Ports-panel "Stop Process". Workspace-owned
            // local processes only — see `ports.rs` for the authorization rule.
            "ports.kill" => self.mutating(request, Self::do_ports_kill),
            // R16-BF2 push feed: read-only long-poll over the session-state
            // event log. Bypasses the ledger and the quiescence gate like
            // `desktop.commands.poll`: it writes no rows and dedupes nothing.
            "session.events.poll" => self.session_events_poll(&request.params),
            "project.add" => self.mutating(request, Self::do_project_add),
            "project.list" => {
                let conn = self.db.lock().unwrap();
                project::list(&conn)
            }
            "project.changes" => self.do_project_changes(&request.params),
            "project.remove" => self.mutating(request, Self::do_project_remove),
            // R16-BM2 (additive): composer Advanced rows + Quick Session.
            "project.update" => self.mutating(request, Self::do_project_update),
            "project.quickSessionCreate" => {
                self.mutating(request, Self::do_project_quick_session_create)
            }
            "project.sparsePresets" => self.do_project_sparse_presets(&request.params),
            "project.saveSparsePreset" => {
                self.mutating(request, Self::do_project_save_sparse_preset)
            }
            "worktree.create" => self.mutating(request, Self::do_worktree_create),
            "worktree.list" => self.do_worktree_list(&request.params),
            "worktree.remove" => self.mutating(request, Self::do_worktree_remove),
            "worktree.rename" => self.mutating(request, Self::do_worktree_rename),
            "worktree.update" => self.mutating(request, Self::do_worktree_update),
            "tasks.list" => self.do_tasks_list(&request.params),
            "tasks.show" => self.do_tasks_show(&request.params),
            "tasks.start" => self.mutating(request, Self::do_tasks_start),
            "tasks.links" => self.do_tasks_links(&request.params),
            // R17-A: Jira data layer for the Tasks page (owned by this
            // task; additive method arms).
            "jira.connect" => self.jira_connect(&request.params),
            "jira.disconnect" => self.jira_disconnect(&request.params),
            "jira.selectSite" => self.jira_select_site(&request.params),
            "jira.status" => self.jira_status(),
            "jira.testConnection" => self.jira_test_connection(&request.params),
            "jira.searchIssues" => self.jira_search_issues(&request.params),
            "jira.cancelSearchIssues" => self.jira_cancel_search_issues(&request.params),
            "jira.listIssues" => self.jira_list_issues(&request.params),
            "jira.listProjects" => self.jira_list_projects(&request.params),
            "jira.listIssueTypes" => self.jira_list_issue_types(&request.params),
            "jira.listCreateFields" => self.jira_list_create_fields(&request.params),
            "jira.listPriorities" => self.jira_list_priorities(&request.params),
            "jira.searchUsers" => self.jira_search_users(&request.params),
            // R17-C: issue creation, detail dialog, mutations and
            // start-from-issue (additive method arms).
            "jira.getIssue" => self.jira_get_issue(&request.params),
            "jira.comments" => self.jira_comments(&request.params),
            "jira.transitions" => self.jira_list_transitions(&request.params),
            "jira.createIssue" => self.jira_create_issue(&request.params),
            "jira.updateIssue" => self.jira_update_issue(&request.params),
            "jira.addComment" => self.jira_add_comment(&request.params),
            "jira.startIssue" => self.mutating(request, Self::jira_start_issue),
            "tasks.remotes" => self.do_tasks_remotes(&request.params),
            "mentu.recipes" => self.mentu_recipes(&request.params),
            "mentu.recipe" => self.mentu_recipe(&request.params),
            "mentu.recipe_save" => self.mentu_recipe_save(request),
            "mentu.runtime" => self.mentu_runtime_info(&request.params),
            "mentu.runtime_install" => self.mentu_runtime_install(&request.params),
            "mentu.approve" => self.mentu_approve(request),
            "mentu.run" => self.mentu_run(request),
            "mentu.runs" => self.mentu_runs(&request.params),
            "mentu.run_status" => self.mentu_run_status(&request.params),
            "mentu.run_evidence" => self.mentu_run_evidence(&request.params),
            "mentu.retry" => self.mentu_retry(request),
            "mentu.cancel" => self.mentu_cancel(request),
            "orchestration.runCreate"
            | "orchestration.runUse"
            | "orchestration.runList"
            | "orchestration.runShow"
            | "orchestration.taskCreate"
            | "orchestration.taskUpdate"
            | "orchestration.gateCreate"
            | "orchestration.gateResolve"
            | "orchestration.gateList"
            | "orchestration.taskList"
            | "orchestration.taskShow" => self.dispatch_run_task(request),
            "orchestration.workerStart"
            | "orchestration.workerShow"
            | "orchestration.workerRead"
            | "orchestration.workerStop"
            | "orchestration.workerAbandon"
            | "orchestration.workerRelease" => self.dispatch_coordination_worker(request),
            "orchestration.requestShow" => self.show_coordination_receipt(request, None),
            "orchestration.send" | "orchestration.check" => self.dispatch_admin_mail(request),
            "orchestration.ask" | "orchestration.reply" => {
                self.dispatch_coordination_question(request, None)
            }
            other => Err(error::method_not_found(other)),
        }
    }

    fn status(&self) -> Value {
        json!({
            "hostId": self.host_id,
            "serviceInstanceId": self.service_instance_id,
            "protocol": PROTOCOL_VERSION,
            "capabilities": CAPABILITIES,
            "version": env!("CARGO_PKG_VERSION"),
            // Kernel-observer correlation only, per
            // `service-quiescence-contract.md`: "not signaling authority."
            "processId": std::process::id(),
        })
    }

    fn mutating(
        &self,
        request: &Request,
        work: impl FnOnce(&Self, &Value) -> Result<Value, RpcError>,
    ) -> Result<Value, RpcError> {
        let params = request.params.clone();
        // Shutdown must also exclude the mutation's durable receipt write.
        let _gate = self.lifecycle_gate.read().unwrap();
        self.ledger.run(
            &self.db,
            &request.request_id,
            &request.method,
            &params,
            || {
                if self.quiescent.load(Ordering::Acquire) {
                    return Err(error::runtime_busy(
                        "service admission is frozen for shutdown",
                    ));
                }
                work(self, &params)
            },
        )
    }

    /// Fence before replay; retain exclusive admission through durable freeze.
    fn do_runtime_shutdown(&self, request: &Request) -> Result<Value, RpcError> {
        service_quiescence::validate_fences(self, &request.params)?;
        let params = request.params.clone();
        let mut admission_guard: Option<RwLockWriteGuard<'_, ()>> = None;
        let result = self.ledger.run(
            &self.db,
            &request.request_id,
            &request.method,
            &params,
            || {
                // Refuse in-flight work rather than waiting for it to finish.
                let Ok(guard) = self.lifecycle_gate.try_write() else {
                    return Err(error::runtime_busy(
                        "a session or harness admission is currently in flight",
                    ));
                };
                match service_quiescence::check_all_sessions_exited(self) {
                    Ok(receipt) => {
                        admission_guard = Some(guard);
                        Ok(receipt)
                    }
                    Err(err) => Err(err),
                }
            },
        );
        #[cfg(test)]
        let pre_freeze_hook = self
            .pre_freeze_hook
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        #[cfg(test)]
        if let Some(hook) = pre_freeze_hook {
            hook(self);
        }
        // Failed persistence never freezes; successful persistence stays fenced.
        if result.is_ok() {
            self.quiescent.store(true, Ordering::Release);
        }
        drop(admission_guard);
        result
    }

    fn do_workspace_register(&self, params: &Value) -> Result<Value, RpcError> {
        let path = require_str(params, "path")?;
        let name = optional_str(params, "name")?;
        let conn = self.db.lock().unwrap();
        workspace::register(&conn, &self.host_id, path, name)
    }

    fn do_session_start(&self, params: &Value) -> Result<Value, RpcError> {
        let workspace_id = require_str(params, "workspaceId")?.to_string();
        // Additive (R12-E restart reuse): `command` is optional. Absent, the
        // daemon spawns its own default interactive shell — the same spawn a
        // desktop/CLI caller previously had to spell out. A restart passes
        // the prior session's recorded argv back verbatim instead.
        let command = optional_str(params, "command")?
            .map(str::to_string)
            .unwrap_or_else(default_session_command);
        if command.contains('\0') {
            return Err(error::invalid_argument("command must not contain NUL"));
        }
        let args = params
            .get("args")
            .map(|a| {
                let a = a
                    .as_array()
                    .ok_or_else(|| error::invalid_argument("args must be an array"))?;
                a.iter()
                    .map(|v| {
                        v.as_str()
                            .filter(|s| !s.contains('\0'))
                            .map(str::to_string)
                            .ok_or_else(|| error::invalid_argument("args must be NUL-free strings"))
                    })
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()?
            .unwrap_or_default();
        let cols = require_dimension(params, "cols", 80)?;
        let rows = require_dimension(params, "rows", 24)?;

        // R16-BC (#275, additive): optional explicit cwd for the spawn. The
        // explorer's "Open in Terminal" passes the row directory; the spawn
        // honours it only when it resolves to a real directory inside the
        // workspace root — anything else is refused, never broadened.
        let workspace_cwd = {
            let conn = self.db.lock().unwrap();
            workspace::get_path(&conn, &workspace_id)?
        };
        let cwd = match optional_str(params, "cwd")? {
            Some(requested) => {
                let requested_path = Path::new(requested);
                if !requested_path.is_absolute() {
                    return Err(error::invalid_argument("cwd must be an absolute path"));
                }
                let root = fs::canonicalize(&workspace_cwd)
                    .unwrap_or_else(|_| PathBuf::from(&workspace_cwd));
                let resolved = fs::canonicalize(requested_path).map_err(|_| {
                    error::invalid_argument("cwd does not exist or is not readable")
                })?;
                if !(resolved == root || resolved.starts_with(&root)) {
                    return Err(error::invalid_argument(
                        "cwd must be inside the workspace root",
                    ));
                }
                if !resolved.is_dir() {
                    return Err(error::invalid_argument("cwd must be a directory"));
                }
                resolved.to_string_lossy().into_owned()
            }
            None => workspace_cwd,
        };

        // Additive (issue #359, subagent nesting): the optional parent
        // session — the fork records `orchestration.parentPaneKey` at spawn
        // time; this repo's equivalent is a `drogon-cli` invoked inside a
        // terminal reporting its inherited `DROGON_SESSION_ID`. The parent
        // must name an existing session on this host; a parent in another
        // workspace is recorded but renders flat (the sidebar nests only
        // when the parent is in the same row set, like the fork's
        // unreachable-row normalization).
        let parent_session_id = match optional_str(params, "parentSessionId")? {
            Some(parent) => {
                if parent == "\0" || parent.is_empty() {
                    return Err(error::invalid_argument("parentSessionId must not be empty"));
                }
                let conn = self.db.lock().unwrap();
                let exists: bool = conn
                    .query_row(
                        "SELECT COUNT(*) FROM sessions WHERE id = ?1 AND host_id = ?2",
                        rusqlite::params![parent, self.host_id],
                        |r| r.get::<_, i64>(0),
                    )
                    .map_err(error::from_sqlite)?
                    > 0;
                if !exists {
                    return Err(error::not_found(
                        "parentSessionId names no session on this host",
                    ));
                }
                Some(parent.to_string())
            }
            None => None,
        };

        // `session::spawn` durably records the pending admission before it
        // touches the PTY at all, and reconciles the row's terminal state
        // (`live` vs. an already-observed `exited`) itself — see its doc
        // comment for why that ordering matters.
        let (session_id, handle, session_json) = session::spawn(
            self.db.clone(),
            &self.data_dir,
            self.host_id.clone(),
            workspace_id,
            &cwd,
            command,
            args,
            None,
            parent_session_id,
            cols,
            rows,
        )?;

        self.sessions
            .lock()
            .unwrap()
            .insert(session_id, handle.clone());
        // Retain ownership even when the post-spawn durable transition fails.
        session::persist_admission(&handle)?;
        Ok(session_json)
    }

    fn do_session_list(&self, params: &Value) -> Result<Value, RpcError> {
        let workspace_filter = optional_str(params, "workspaceId")?;
        let conn = self.db.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, workspace_id, host_id, incarnation, command, args_json, cols, rows, verdict, exit_code, created_at, harness_id, needs_input_at, parent_session_id FROM sessions ORDER BY created_at",
            )
            .map_err(error::from_sqlite)?;
        let rows: Vec<_> = stmt
            .query_map([], row_to_session_json)
            .map_err(error::from_sqlite)?
            .collect();
        drop(stmt);
        let sessions_guard = self.sessions.lock().unwrap();
        let mut sessions = Vec::new();
        for row in rows {
            let (id, mut value) = row.map_err(error::from_sqlite)?;
            if let Some(handle) = sessions_guard.get(&id) {
                value = session::snapshot(handle);
            }
            if workspace_filter.is_none_or(|w| value["workspaceId"] == w) {
                sessions.push(value);
            }
        }
        Ok(json!({ "sessions": sessions }))
    }

    /// R16-BF2 push feed: long-polls the session-state event log.
    /// `{"afterSeq": n, "waitMs": ms}` → `{"bootId", "events", "nextSeq"}`.
    /// `waitMs` clamps to 30 s; a zero wait drains once without blocking.
    /// The `bootId` is this process's `service_instance_id`: a daemon
    /// restart resets the log's sequence, so a changed boot id tells the
    /// poller to resync from zero instead of waiting on a stale cursor.
    fn session_events_poll(&self, params: &Value) -> Result<Value, RpcError> {
        let after_seq = params.get("afterSeq").and_then(Value::as_u64).unwrap_or(0);
        let wait_ms = params
            .get("waitMs")
            .and_then(Value::as_u64)
            .unwrap_or(20_000)
            .min(30_000);
        let (events, next_seq) = session_events::poll(after_seq, wait_ms);
        Ok(json!({
            "bootId": self.service_instance_id,
            "events": session_events::events_wire(&events),
            "nextSeq": next_seq,
        }))
    }

    fn do_session_read(&self, params: &Value) -> Result<Value, RpcError> {
        let (handle, _) = self.require_session_with_incarnation(params)?;
        let cursor = optional_u64(params, "cursor", 0)?;
        let limit = optional_u64(params, "limitBytes", 65_536)?;
        if !(1..=65_536).contains(&limit) {
            return Err(error::invalid_argument("limitBytes must be 1..=65536"));
        }
        session::read(&handle, cursor, limit as usize)
    }

    fn do_session_write(&self, params: &Value) -> Result<Value, RpcError> {
        let (handle, _) = self.require_session_with_incarnation(params)?;
        let data_b64 = require_str(params, "dataBase64")?;
        let bytes = session::base64_decode(data_b64)?;
        let accepted = session::write(&handle, &bytes)?;
        Ok(json!({ "acceptedBytes": accepted }))
    }

    fn do_session_resize(&self, params: &Value) -> Result<Value, RpcError> {
        let (handle, _) = self.require_session_with_incarnation(params)?;
        let cols = require_dimension(params, "cols", 80)?;
        let rows = require_dimension(params, "rows", 24)?;
        session::resize(&handle, cols, rows)
    }

    fn do_session_stop(&self, params: &Value) -> Result<Value, RpcError> {
        let session_id = require_str(params, "sessionId")?.to_string();
        let incarnation = require_str(params, "incarnation")?;
        let handle = self.sessions.lock().unwrap().get(&session_id).cloned();
        let Some(handle) = handle else {
            // No retained handle: either this process never held one
            // (unknown id -> not_found below) or it was swept to
            // `unverifiable` by a prior-instance crash recovery. Either way
            // this process cannot act on it.
            return self.session_row_as_value(&session_id, incarnation);
        };
        session::check_incarnation(&handle, incarnation)?;
        // The handle stays in `self.sessions` even after a confirmed exit:
        // dropping it here would also drop its ring buffer, making
        // `session.read` unable to serve output the session legitimately
        // still retains. The handle's own state (`exit_code`) already makes
        // every subsequent read/write/resize/stop report the true verdict;
        // write/resize additionally refuse to act on an exited session.
        session::stop(&handle)
    }

    fn do_session_close(&self, params: &Value) -> Result<Value, RpcError> {
        let session_id = require_str(params, "sessionId")?.to_string();
        let incarnation = require_str(params, "incarnation")?;
        // The same identity distinction `session.stop` makes: unknown id ->
        // `not_found`, wrong incarnation -> `stale_incarnation`.
        let row_value = self.session_row_as_value(&session_id, incarnation)?;
        let handle = self.sessions.lock().unwrap().get(&session_id).cloned();
        let value = if let Some(handle) = handle {
            session::check_incarnation(&handle, incarnation)?;
            // The reply carries the observed truth: `exited` with the code
            // when the kill confirms within the stop budget, `unverifiable`
            // when it does not. Either way the child has been signalled and
            // the record is forgotten below — an explicit close is final.
            session::stop(&handle)?
        } else {
            // No handle in this instance: a prior-instance row this process
            // never owned. Nothing to stop; the stored verdict (honest for
            // both `unverifiable` stubs and `exited` history) is the reply.
            row_value
        };
        self.sessions.lock().unwrap().remove(&session_id);
        let conn = self.db.lock().unwrap();
        session::forget_record(&conn, &session_id)?;
        Ok(value)
    }

    fn do_session_forget(&self, params: &Value) -> Result<Value, RpcError> {
        let session_id = require_str(params, "sessionId")?.to_string();
        let incarnation = require_str(params, "incarnation")?;
        let row_value = self.session_row_as_value(&session_id, incarnation)?;
        if let Some(handle) = self.sessions.lock().unwrap().get(&session_id).cloned() {
            session::check_incarnation(&handle, incarnation)?;
            if !handle.is_exited() {
                // Forgetting a live session would orphan its PTY: the one
                // outcome the session owner must never produce. `close` is
                // the route that stops first.
                return Err(error::invalid_argument("session is live; close it instead"));
            }
        }
        self.sessions.lock().unwrap().remove(&session_id);
        let conn = self.db.lock().unwrap();
        session::forget_record(&conn, &session_id)?;
        Ok(row_value)
    }

    fn session_row_as_value(&self, session_id: &str, incarnation: &str) -> Result<Value, RpcError> {
        let conn = self.db.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT id, workspace_id, host_id, incarnation, command, args_json, cols, rows, verdict, exit_code, created_at, harness_id, needs_input_at, parent_session_id FROM sessions WHERE id = ?1",
                [session_id],
                row_to_session_json,
            )
            .optional()
            .map_err(error::from_sqlite)?;
        let Some((_, value)) = row else {
            return Err(error::not_found("session not found"));
        };
        if value["incarnation"] != incarnation {
            return Err(error::stale_incarnation());
        }
        Ok(value)
    }

    fn require_session_with_incarnation(
        &self,
        params: &Value,
    ) -> Result<(Arc<SessionHandle>, String), RpcError> {
        let session_id = require_str(params, "sessionId")?.to_string();
        let incarnation = require_str(params, "incarnation")?;
        let handle = self.sessions.lock().unwrap().get(&session_id).cloned();
        let Some(handle) = handle else {
            // Same identity distinction `session.stop` makes: a
            // never-existing id is `not_found`, a wrong incarnation on an
            // existing row is `stale_incarnation`, and only a *prior-instance
            // session that genuinely has no handle here* is `unverifiable`.
            self.session_row_as_value(&session_id, incarnation)?;
            return Err(error::unverifiable(
                "session exists but has no active handle in this service instance",
            ));
        };
        session::check_incarnation(&handle, incarnation)?;
        Ok((handle, session_id))
    }
}

/// This process holds no [`session::SessionHandle`] for a row read straight
/// from SQLite (it belongs to a prior process instance, per
/// `db::recover_from_prior_instance`), so there is no PTY activity clock to
/// derive `working`/`idle` from here — only the durable verdict and the
/// durable wait signal (`needs_input_at`, when set) are known.
/// `session::to_json` is the path that has a live handle and computes the
/// full activity-based state.
/// The daemon-side default session shell, matching what the desktop main
/// process sends for an ordinary new terminal. Used when `session.start`
/// omits `command` (additive restart-reuse path).
fn default_session_command() -> String {
    if cfg!(windows) {
        return std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string());
    }
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
}

fn row_to_session_json(r: &rusqlite::Row) -> rusqlite::Result<(String, Value)> {
    let id: String = r.get(0)?;
    let args_json: String = r.get(5)?;
    let args: Vec<String> = serde_json::from_str(&args_json).unwrap_or_default();
    let verdict: String = r.get(8)?;
    // A restored row re-reports an uncleared wait signal with its original
    // stamp (the agent asked and was never answered); anything else without
    // a live handle is honestly `unknown`, never a guessed idle.
    let needs_input_at: Option<String> = r.get(12)?;
    let agent_state = if verdict == "exited" {
        "exited"
    } else if needs_input_at.is_some() {
        "needs_input"
    } else {
        "unknown"
    };
    Ok((
        id.clone(),
        json!({
            "id": id,
            "workspaceId": r.get::<_, String>(1)?,
            "hostId": r.get::<_, String>(2)?,
            "incarnation": r.get::<_, String>(3)?,
            "command": r.get::<_, String>(4)?,
            "args": args,
            "cols": r.get::<_, i64>(6)?,
            "rows": r.get::<_, i64>(7)?,
            "verdict": verdict,
            "exitCode": r.get::<_, Option<i64>>(9)?,
            "createdAt": r.get::<_, String>(10)?,
            "agentState": agent_state,
            "agentStateAt": needs_input_at,
            "agentPromptPreview": null,
            "cacheIdleAt": null,
            "harnessId": r.get::<_, Option<String>>(11)?,
            "parentSessionId": r.get::<_, Option<String>>(13)?,
        }),
    ))
}

#[cfg(unix)]
fn reject_unsafe_data_dir(data_dir: &Path) -> Result<(), RpcError> {
    let meta = fs::symlink_metadata(data_dir)
        .map_err(|e| error::io_error(format!("cannot inspect data dir: {e}")))?;
    if meta.file_type().is_symlink() {
        return Err(error::invalid_argument(
            "refusing a symlinked data directory",
        ));
    }
    Ok(())
}

#[cfg(not(unix))]
fn reject_unsafe_data_dir(_data_dir: &Path) -> Result<(), RpcError> {
    Ok(())
}

fn require_str<'a>(params: &'a Value, field: &str) -> Result<&'a str, RpcError> {
    params
        .get(field)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error::invalid_argument(format!("missing or invalid field: {field}")))
}

/// Only absence selects the default; malformed values must not broaden a request.
fn optional_u64(params: &Value, field: &str, default: u64) -> Result<u64, RpcError> {
    match params.get(field) {
        None => Ok(default),
        Some(value) => value.as_u64().ok_or_else(|| {
            error::invalid_argument(format!("{field} must be a non-negative integer"))
        }),
    }
}

/// Same present-but-invalid-is-an-error rule as `optional_u64`, for a
/// filter field: a caller who mistypes `workspaceId`'s type must see an
/// error, never a silently unfiltered (broader) result set.
fn optional_str<'a>(params: &'a Value, field: &str) -> Result<Option<&'a str>, RpcError> {
    match params.get(field) {
        None => Ok(None),
        Some(value) => value
            .as_str()
            .filter(|value| !value.is_empty())
            .map(Some)
            .ok_or_else(|| error::invalid_argument(format!("{field} must be a string"))),
    }
}

fn require_dimension(params: &Value, field: &str, default: u16) -> Result<u16, RpcError> {
    let Some(value) = params.get(field) else {
        return Ok(default);
    };
    let n = value
        .as_u64()
        .ok_or_else(|| error::invalid_argument(format!("{field} must be a positive integer")))?;
    if !(1..=1000).contains(&n) {
        return Err(error::invalid_argument(format!("{field} must be 1..=1000")));
    }
    Ok(n as u16)
}
