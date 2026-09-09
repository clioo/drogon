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
    Codex {
        home: PathBuf,
        source_home: PathBuf,
        history_home: Option<PathBuf>,
        install_hooks: bool,
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
    pub(super) fn harness_list(&self) -> Result<Value, RpcError> {
        let path = std::env::var_os("PATH");
        let mut installations = discover(path.as_deref());
        if let Some(settings) = self.read_agent_settings()? {
            for item in &mut installations {
                if let Some(command) = settings
                    .agent_cmd_overrides
                    .get(harness_id_wire(item.harness_id))
                    .filter(|cmd| !cmd.is_empty())
                {
                    item.executable = crate::agent_settings::resolve_command(command);
                    item.availability = if item.executable.is_some() {
                        HarnessAvailability::Available
                    } else {
                        HarnessAvailability::Missing
                    };
                }
            }
        }
        Ok(json!({"hostId": self.host_id, "harnesses": installations}))
    }

    pub(super) fn do_harness_start(&self, params: &Value) -> Result<Value, RpcError> {
        let workspace_id = require_str(params, "workspaceId")?;
        let request: HarnessLaunchRequest = serde_json::from_value(params.clone())
            .map_err(|_| error::invalid_argument("Invalid harness launch preferences"))?;
        let settings = self.read_agent_settings()?;
        let plan = match settings.as_ref() {
            Some(settings) => crate::agent_settings::plan_with_settings(&request, settings)?,
            None => resolve_launch(&request)?,
        };
        let hooks_enabled = settings
            .as_ref()
            .is_none_or(|settings| settings.agent_status_hooks_enabled);
        // Each harness's wait signal (permission prompts, questions, turn
        // end) is reported through `session.hook_event` by a per-harness
        // hook install below. Any argv the install needs (claude's
        // `--settings`, Pi's `--extension`) must be fixed before admission,
        // since admission mints the session id/incarnation the hook
        // commands embed — a nonce name breaks the cycle: argv carries the
        // path now, the file/overlay gains the real identity after
        // admission and before spawn.
        let mut args = plan.args;
        // Headless daemon runs consume their prompt and exit, so their
        // completion signal is the process verdict. Codex still gets a
        // managed home in headless mode: config/resources must never be read
        // from or written to the user's real `~/.codex`.
        let pending = match request.harness_id {
            id if !hooks_enabled && id != HarnessId::Codex => PendingHookInstall::None,
            HarnessId::Codex => {
                let nonce = uuid::Uuid::new_v4().to_string();
                PendingHookInstall::Codex {
                    home: harness_hooks::codex::nonce_home_path(&self.data_dir, &nonce),
                    source_home: harness_hooks::codex::source_home_path(),
                    history_home: settings.as_ref().map(|settings| {
                        if settings.codex_session_source_home.is_empty() {
                            harness_hooks::codex::source_home_path()
                        } else {
                            PathBuf::from(&settings.codex_session_source_home)
                        }
                    }),
                    install_hooks: !request.headless && hooks_enabled,
                }
            }
            HarnessId::Claude if request.headless => PendingHookInstall::None,
            HarnessId::Opencode if request.headless => PendingHookInstall::None,
            HarnessId::Pi if request.headless => PendingHookInstall::None,
            HarnessId::Antigravity => PendingHookInstall::None,
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
        };
        let cols = require_dimension(params, "cols", 80)?;
        let rows = require_dimension(params, "rows", 24)?;
        // Issue #359: same optional parent-session record as
        // `session.start` — a harness launched by `drogon-cli` inside a
        // terminal carries the PTY's inherited `DROGON_SESSION_ID`.
        let parent_session_id = match crate::optional_str(params, "parentSessionId")? {
            Some(parent) => {
                let conn = self.db.lock().unwrap();
                let exists: bool = conn
                    .query_row(
                        "SELECT COUNT(*) FROM sessions WHERE id = ?1 AND host_id = ?2",
                        rusqlite::params![parent, self.host_id],
                        |r| r.get::<_, i64>(0),
                    )
                    .map_err(crate::error::from_sqlite)?
                    > 0;
                if !exists {
                    return Err(crate::error::not_found(
                        "parentSessionId names no session on this host",
                    ));
                }
                Some(parent.to_string())
            }
            None => None,
        };
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
                parent_session_id,
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
        let mut extra_env: Vec<(String, String)> = settings
            .as_ref()
            .and_then(|settings| {
                settings
                    .agent_default_env
                    .get(harness_id_wire(request.harness_id))
            })
            .map(|env| {
                env.iter()
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect()
            })
            .unwrap_or_default();
        extra_env.extend(
            ready
                .as_ref()
                .map(|r| r.extra_env.clone())
                .unwrap_or_default(),
        );
        let mut cleanup_paths: Vec<PathBuf> = ready
            .as_ref()
            .map(|r| r.cleanup_paths.clone())
            .unwrap_or_default();
        // Headless daemon runs (bots/automations) must not load the user's
        // global harness config — skills, extensions, MCP servers — the
        // way the interactive TUI banners do (issue #187): give the launch
        // an isolated config dir instead (Pi: PI_CODING_AGENT_DIR,
        // the fork's binary-facing override for unattended runs), linking
        // only the provider/model/auth definitions the run was configured
        // with. The overlay applies after the base session environment, so
        // it wins over an inherited value even when the daemon itself runs
        // inside another runtime's terminal.
        if request.headless {
            // The user's own Pi agent dir: their custom
            // PI_CODING_AGENT_DIR if the daemon inherited one, else the
            // default ~/.pi/agent. A dir inside this data dir is one of
            // our own isolated headless dirs (e.g. the daemon was launched
            // from a Drogon bot terminal) and must not mirror itself. An
            // inherited dir must also look like a real config root: a
            // Pi run creates its override dir on first use (sessions,
            // empty auth/models-store), so a bare `is_dir` check would
            // trust a Pi-created empty overlay over the real config and
            // link nothing useful on later runs.
            let own_root = self.data_dir.join("harness-env");
            let looks_like_config_root =
                |path: &std::path::Path| path.join("models.json").is_file();
            let inherited_agent_dir = std::env::var_os("PI_CODING_AGENT_DIR")
                .map(PathBuf::from)
                .filter(|path| {
                    path.is_dir() && !path.starts_with(&own_root) && looks_like_config_root(path)
                });
            let source_agent_dir = inherited_agent_dir.or_else(|| {
                std::env::var_os("HOME")
                    .map(PathBuf::from)
                    .map(|home| home.join(".pi").join("agent"))
                    .filter(|path| path.is_dir())
            });
            if let Some(plan) = drogon_harness::plan_headless_env(
                request.harness_id,
                &self.data_dir,
                &uuid::Uuid::new_v4().to_string(),
                source_agent_dir.as_deref(),
            ) {
                std::fs::create_dir_all(&plan.dir).map_err(|e| {
                    error::io_error(format!("cannot create headless config dir: {e}"))
                })?;
                for (source, name) in &plan.link_files {
                    if !source.is_file() {
                        continue;
                    }
                    let dest = plan.dir.join(name);
                    #[cfg(unix)]
                    if std::os::unix::fs::symlink(source, &dest).is_err() {
                        // Symlink denied (rare hardened mounts): fall back
                        // to a copy; the file is read-only input for the run.
                        let _ = std::fs::copy(source, &dest);
                    }
                    #[cfg(not(unix))]
                    {
                        let _ = std::fs::copy(source, &dest);
                    }
                }
                extra_env.extend(plan.env);
                cleanup_paths.push(plan.dir);
            }
        }
        let (session_id, handle, _session_json) =
            match session_admission::launch_reserved_with_cleanup(
                self.db.clone(),
                &self.data_dir,
                prepared,
                None,
                &extra_env,
                session_admission::LaunchOptions {
                    cleanup_paths: cleanup_paths.clone(),
                    headless: request.headless,
                    explicit_wait_clear: ready
                        .as_ref()
                        .is_some_and(|install| install.explicit_wait_clear),
                },
            ) {
                Ok(launched) => launched,
                Err(err) => {
                    for path in &cleanup_paths {
                        crate::hooks::remove_settings_file(path);
                    }
                    return Err(err);
                }
            };

        if let Some(prompt) = request.prompt.as_deref() {
            handle.note_agent_prompt(prompt);
        }
        self.sessions
            .lock()
            .unwrap()
            .insert(session_id, handle.clone());
        // Retain ownership even when the post-spawn durable transition fails.
        crate::session::persist_admission(&handle)?;
        Ok(crate::session::snapshot(&handle))
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
            PendingHookInstall::Codex {
                home,
                source_home,
                history_home,
                install_hooks,
            } => {
                if let Err(err) = harness_hooks::codex::install(
                    &home,
                    &source_home,
                    cli,
                    prepared.session_id(),
                    prepared.incarnation(),
                    install_hooks,
                ) {
                    // The install can fail after copying one or more resources
                    // (for example, a malformed source hooks.json). The
                    // reservation is retired by the caller, and this failed
                    // attempt must not strand its private home on disk.
                    crate::hooks::remove_settings_file(&home);
                    return Err(err);
                }
                if let Some(history_home) = history_home
                    && let Err(err) = harness_hooks::codex::import_history(&history_home, &home)
                {
                    crate::hooks::remove_settings_file(&home);
                    return Err(err);
                }
                let mut extra_env = Vec::with_capacity(2);
                extra_env.push((
                    "CODEX_HOME".to_string(),
                    home.to_string_lossy().into_owned(),
                ));
                // Interactive Codex hooks report wait/clear signals. A
                // headless `codex exec` has no client that can answer a hook
                // wait, so keep the ordinary PTY/activity policy there.
                Ok(Some(ReadyHookInstall {
                    cleanup_paths: vec![home],
                    extra_env,
                    explicit_wait_clear: install_hooks,
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
/// "antigravity" | "codex") so a session record round-trips into
/// `harness.start`.
pub(crate) fn harness_id_wire(harness_id: HarnessId) -> &'static str {
    match harness_id {
        HarnessId::Claude => "claude",
        HarnessId::Pi => "pi",
        HarnessId::Opencode => "opencode",
        HarnessId::Antigravity => "antigravity",
        HarnessId::Codex => "codex",
    }
}

#[cfg(test)]
mod headless_env_tests {
    //! Behavioral proof for the headless config isolation (issue #187): a
    //! daemon-run (headless) Pi launch spawns with `PI_CODING_AGENT_DIR`
    //! pointing at an isolated, empty dir under the data dir, inherits no
    //! `ORCA_*` from the daemon environment, and the dir is removed when
    //! the session exits.
    //!
    //! Discovery resolves `pi` from this process's `PATH`, which parallel
    //! tests must not mutate, so the seeded case re-execs this test binary
    //! in a child whose PATH leads with a temp bin holding a fake `pi`
    //! (same pattern as `session_admission_tests`' seeded subprocess).

    use drogon_protocol::PROTOCOL_VERSION;
    use serde_json::{Value, json};

    use crate::Engine;

    const SERVICE_CREDENTIAL: &str = "service-secret-token";
    const SEED_FAKE_PI_BIN: &str = "DROGON_TEST_FAKE_PI_BIN";
    const DONE_MARKER: &str = "FAKE-PI-DONE";

    fn request(method: &str, params: Value) -> drogon_protocol::Request {
        serde_json::from_value(json!({
            "protocol": PROTOCOL_VERSION,
            // Request ids dedupe retries: every call mints its own.
            "requestId": format!("req-{}", uuid::Uuid::new_v4()),
            "auth": SERVICE_CREDENTIAL,
            "method": method,
            "params": params,
        }))
        .unwrap()
    }

    fn fake_pi_script() -> &'static str {
        "#!/bin/sh\n\
         echo \"PI_AGENT_DIR=${PI_CODING_AGENT_DIR:-}\"\n\
         echo \"PI_DIR_EXISTS=$([ -n \"${PI_CODING_AGENT_DIR:-}\" ] && [ -d \"$PI_CODING_AGENT_DIR\" ] && echo 1 || echo 0)\"\n\
         echo \"MODELS_LINKED=$([ -e \"$PI_CODING_AGENT_DIR/models.json\" ] && echo 1 || echo 0)\"\n\
         echo \"SKILLS_ABSENT=$([ ! -e \"$PI_CODING_AGENT_DIR/skills\" ] && [ ! -e \"$PI_CODING_AGENT_DIR/extensions\" ] && [ ! -e \"$PI_CODING_AGENT_DIR/mcp.json\" ] && [ ! -e \"$PI_CODING_AGENT_DIR/settings.json\" ] && echo 1 || echo 0)\"\n\
         echo \"ORCA_COUNT=$(env | grep -c '^ORCA_' || true)\"\n\
         echo \"PI_COUNT=$(env | grep -c '^PI_CODING_AGENT_DIR=' || true)\"\n\
         echo \"FAKE-PI-DONE\"\n"
    }

    #[test]
    fn headless_pi_runs_against_an_isolated_empty_agent_dir() {
        if std::env::var_os(SEED_FAKE_PI_BIN).is_none() {
            let bin = tempfile::tempdir().expect("fake bin dir");
            let pi = bin.path().join("pi");
            std::fs::write(&pi, fake_pi_script()).expect("write fake pi");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&pi, std::fs::Permissions::from_mode(0o755))
                    .expect("chmod fake pi");
            }
            // A hermetic fake user Pi home: provider/auth definitions to
            // link, plus the config that must never reach the run.
            let home = tempfile::tempdir().expect("fake home");
            let agent = home.path().join(".pi").join("agent");
            std::fs::create_dir_all(agent.join("skills")).expect("fake skills dir");
            std::fs::create_dir_all(agent.join("extensions")).expect("fake extensions dir");
            for (name, body) in [
                ("models.json", "{\"providers\":{}}"),
                ("models-store.json", "{}"),
                ("auth.json", "{}"),
                ("mcp.json", "{\"mcpServers\":{}}"),
                ("settings.json", "{\"packages\":[\"npm:fake\"]}"),
            ] {
                std::fs::write(agent.join(name), body).expect("fake config file");
            }
            // An inherited overlay dir that Pi itself created on an earlier
            // run: it exists and holds Pi-managed files, but no
            // models.json — it must not be trusted as the config source
            // (that would link empty files and lose the provider config).
            let foreign = tempfile::tempdir().expect("foreign overlay dir");
            for (name, body) in [("models-store.json", "{}"), ("auth.json", "{}")] {
                std::fs::write(foreign.path().join(name), body).expect("foreign file");
            }
            std::fs::create_dir(foreign.path().join("sessions")).expect("foreign sessions");
            let exe = std::env::current_exe().expect("test executable");
            let status = std::process::Command::new(exe)
                .arg("harness::headless_env_tests::headless_pi_runs_against_an_isolated_empty_agent_dir")
                .arg("--exact")
                .arg("--nocapture")
                .env(SEED_FAKE_PI_BIN, bin.path())
                .env("HOME", home.path())
                .env(
                    "PATH",
                    format!(
                        "{}:{}",
                        bin.path().to_string_lossy(),
                        std::env::var("PATH").unwrap_or_default()
                    ),
                )
                .env("ORCA_PI_SOURCE_AGENT_DIR", "/tmp/foreign-orca-overlay")
                // A bogus inherited PI_CODING_AGENT_DIR must be replaced,
                // not mirrored — even when the dir exists (Pi creates its
                // override dir on first use, so existence alone proves
                // nothing about whether real config lives there).
                .env(
                    "PI_CODING_AGENT_DIR",
                    foreign.path().to_string_lossy().into_owned(),
                )
                .env("ORCA_PI_STATUS_OWNED", "1")
                .status()
                .expect("spawn seeded child");
            assert!(status.success(), "seeded child must pass");
            return;
        }

        let dir = tempfile::tempdir().expect("data dir");
        let engine = Engine::open(dir.path()).expect("engine");
        let folder = dir.path().join("folder");
        std::fs::create_dir(&folder).unwrap();
        let registered = engine.dispatch_authenticated(
            request("workspace.register", json!({ "path": folder })),
            SERVICE_CREDENTIAL,
        );
        assert!(registered.ok, "{registered:?}");
        let workspace_id = registered.result.unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();

        let started = engine.dispatch_authenticated(
            request(
                "harness.start",
                json!({
                    "workspaceId": workspace_id,
                    "harnessId": "pi",
                    "headless": true,
                    "prompt": "hello",
                }),
            ),
            SERVICE_CREDENTIAL,
        );
        assert!(started.ok, "{started:?}");
        let started = started.result.unwrap();
        let session_id = started["id"].as_str().unwrap().to_string();
        let incarnation = started["incarnation"].as_str().unwrap().to_string();

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        let mut text = String::new();
        // The exit verdict lags the final output chunk by a reap tick, so
        // keep polling after the marker appears instead of requiring both
        // in the same read.
        let exited = loop {
            let read = engine.dispatch_authenticated(
                request(
                    "session.read",
                    json!({ "sessionId": session_id, "incarnation": incarnation }),
                ),
                SERVICE_CREDENTIAL,
            );
            assert!(read.ok, "{read:?}");
            let result = read.result.unwrap();
            use base64::Engine as _;
            let chunk = base64::engine::general_purpose::STANDARD
                .decode(
                    result["dataBase64"]
                        .as_str()
                        .expect("dataBase64")
                        .as_bytes(),
                )
                .expect("buffer is base64");
            text.push_str(&String::from_utf8_lossy(&chunk));
            let verdict_exited = result["session"]["verdict"] == "exited";
            if verdict_exited
                || (!text.contains(DONE_MARKER) && std::time::Instant::now() >= deadline)
            {
                break verdict_exited;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "timed out waiting for {DONE_MARKER}; buffer so far: {text}"
            );
            std::thread::sleep(std::time::Duration::from_millis(50));
        };

        // macOS canonicalizes the temp root (/var -> /private/var); the
        // daemon works with canonical paths, so compare canonically.
        let data_dir = dir
            .path()
            .canonicalize()
            .expect("canonical data dir")
            .to_string_lossy()
            .into_owned();
        assert!(
            text.contains(&format!("PI_AGENT_DIR={data_dir}/harness-env/pi/")),
            "headless Pi must see the isolated agent dir: {text}"
        );
        assert!(
            text.contains("PI_DIR_EXISTS=1"),
            "the isolated dir must exist at spawn: {text}"
        );
        assert!(
            text.contains("ORCA_COUNT=0"),
            "no ORCA_* variable may reach the run: {text}"
        );
        assert!(
            text.contains("MODELS_LINKED=1"),
            "provider/model definitions must stay reachable: {text}"
        );
        assert!(
            text.contains("SKILLS_ABSENT=1"),
            "skills/extensions/MCP/settings must stay isolated: {text}"
        );
        assert!(
            text.contains("PI_COUNT=1"),
            "exactly one PI_CODING_AGENT_DIR override: {text}"
        );
        assert!(exited, "the fake pi exits, so the run completes: {text}");

        // Cleanup: the isolated dir is removed whole on exit, leaving no
        // state a later run could pick up.
        let leftover = dir.path().join("harness-env").join("pi");
        let leftovers: Vec<_> = leftover
            .read_dir()
            .map(|entries| entries.flatten().collect())
            .unwrap_or_default();
        assert!(
            leftovers.is_empty(),
            "isolated dirs must be removed on exit: {leftovers:?}"
        );
    }
}
