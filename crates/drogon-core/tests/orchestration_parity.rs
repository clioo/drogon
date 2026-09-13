//! End-to-end Drogon worker contract checks with a local shell harness.
//! No model is launched: the fixture is only proving the daemon's injected
//! brief, policy selection and session admission seams.
#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

static ENV_LOCK: Mutex<()> = Mutex::new(());

fn call(engine: &Engine, method: &str, params: Value) -> drogon_protocol::Response {
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: uuid::Uuid::new_v4().to_string(),
        auth: None,
        method: method.into(),
        params,
    })
}

fn ok(engine: &Engine, method: &str, params: Value) -> Value {
    let response = call(engine, method, params);
    assert!(response.ok, "{method}: {:?}", response.error);
    response.result.unwrap()
}

fn write_executable(path: &Path, body: &str) {
    std::fs::write(path, body).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn prepend_path(bin: &Path) -> Option<std::ffi::OsString> {
    let old = std::env::var_os("PATH");
    let mut paths = old
        .as_ref()
        .map(std::env::split_paths)
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    paths.insert(0, bin.to_path_buf());
    unsafe { std::env::set_var("PATH", std::env::join_paths(paths).unwrap()) };
    old
}

struct PathGuard(Option<std::ffi::OsString>);

impl Drop for PathGuard {
    fn drop(&mut self) {
        match self.0.take() {
            Some(path) => unsafe { std::env::set_var("PATH", path) },
            None => unsafe { std::env::remove_var("PATH") },
        }
    }
}

fn wait_for_file(path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if path.is_file() {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("fixture did not write {}", path.display());
}

fn shell_quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}

#[test]
fn ordinary_harness_gets_drogon_context_on_its_first_turn_without_policy_files() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let root = tempfile::tempdir().unwrap();
    let bin = root.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let capture = root.path().join("harness-argv.txt");
    write_executable(
        &bin.join("claude"),
        &format!(
            "#!/bin/sh\n{{\n  for arg do printf '<%s>\\n' \"$arg\"; done\n}} > {}\nexit 0\n",
            shell_quote(&capture)
        ),
    );
    let _path_guard = PathGuard(prepend_path(&bin));
    let workspace = root.path().join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    let engine = Engine::open(&root.path().join("data")).unwrap();
    let workspace_id = ok(
        &engine,
        "workspace.register",
        json!({"path": workspace.to_str().unwrap()}),
    )["id"]
        .as_str()
        .unwrap()
        .to_string();
    let started = ok(
        &engine,
        "harness.start",
        json!({
            "workspaceId": workspace_id,
            "harnessId": "claude",
            "prompt": "delega un subagente que te diga hola"
        }),
    );
    wait_for_file(&capture);
    let fixture = std::fs::read_to_string(&capture).unwrap();
    assert!(
        fixture.contains("=== DROGON RUNTIME CONTEXT ==="),
        "{fixture}"
    );
    assert!(
        fixture.contains("drogon-cli skills get --topic orchestration"),
        "{fixture}"
    );
    assert!(
        fixture.contains("delega un subagente que te diga hola"),
        "{fixture}"
    );
    assert!(!workspace.join("AGENTS.md").exists());
    assert!(!workspace.join("CLAUDE.md").exists());
    let stopped = ok(
        &engine,
        "session.stop",
        json!({
            "sessionId": started["id"],
            "incarnation": started["incarnation"]
        }),
    );
    assert_eq!(stopped["verdict"], "exited");
}

#[test]
fn policy_worker_gets_structured_brief_and_exact_provider_model() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let root = tempfile::tempdir().unwrap();
    let bin = root.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let capture = root.path().join("worker-argv.txt");
    let capture_literal = shell_quote(&capture);
    write_executable(
        &bin.join("pi"),
        &format!(
            "#!/bin/sh\n{{\n  echo ARGS\n  for arg do printf '<%s>\\n' \"$arg\"; done\n  echo RUN=$DROGON_RUN_ID\n  echo TASK=$DROGON_TASK_ID\n  echo DISPATCH=$DROGON_DISPATCH_ID\n}} > {capture_literal}\nexit 0\n"
        ),
    );
    let worker_cli = bin.join("drogon-cli-fixture");
    write_executable(&worker_cli, "#!/bin/sh\nexit 0\n");
    let _path_guard = PathGuard(prepend_path(&bin));

    {
        let workspace = root.path().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let data = root.path().join("data");
        let engine = Engine::open(&data)
            .unwrap()
            .with_worker_cli(&worker_cli)
            .unwrap();
        let workspace_id = ok(
            &engine,
            "workspace.register",
            json!({"path": workspace.to_str().unwrap()}),
        )["id"]
            .as_str()
            .unwrap()
            .to_string();
        ok(
            &engine,
            "graph.write_intent",
            json!({
                "workspaceId": workspace_id,
                "intent": {
                    "nodes": [],
                    "policy": {
                        "approvedRuntimes": [{
                            "harness": "pi",
                            "provider": "openai-codex",
                            "model": "gpt-5.6-luna"
                        }],
                        "fallbackRuntime": {
                            "harness": "pi",
                            "provider": "dgx-spark",
                            "model": "qwen3.8-flash-next-nvidia-nvfp4"
                        }
                    }
                }
            }),
        );
        let host = ok(&engine, "status", json!({}))["hostId"]
            .as_str()
            .unwrap()
            .to_string();
        let run = ok(
            &engine,
            "orchestration.runCreate",
            json!({
                "contractVersion": 1,
                "hostId": host,
                "coordinatorId": "owner",
                "objective": "worker brief parity"
            }),
        )["run"]["runId"]
            .as_str()
            .unwrap()
            .to_string();
        let scope = json!({
            "contractVersion": 1,
            "hostId": host,
            "runId": run,
            "coordinatorId": "owner",
            "consumerGeneration": 1
        });
        let mut task_create = scope.clone();
        task_create["spec"] = json!({
            "title": "Ship the parity fix",
            "instructions": "Inspect the exact bytes ✓\nand report the result.",
            "metadata": {"paths": ["crates/drogon-core", "skill-guides/orchestration.md"]}
        });
        let task = ok(&engine, "orchestration.taskCreate", task_create)["task"]["taskId"]
            .as_str()
            .unwrap()
            .to_string();

        let mut start = scope;
        start["taskId"] = json!(task);
        start["workspaceId"] = json!(workspace_id);
        start["mode"] = json!("policy");
        let started = call(&engine, "orchestration.workerStart", start);
        assert!(started.ok, "worker start: {:?}", started.error);
        let dispatch = started.result.as_ref().unwrap()["dispatchId"]
            .as_str()
            .unwrap()
            .to_string();

        wait_for_file(&capture);
        let fixture = std::fs::read_to_string(&capture).unwrap();
        assert!(fixture.contains("=== DROGON WORKER BRIEF ==="), "{fixture}");
        assert!(
            fixture.contains("Objective: Ship the parity fix"),
            "{fixture}"
        );
        assert!(fixture.contains("Scope / paths:"), "{fixture}");
        assert!(fixture.contains("- crates/drogon-core"), "{fixture}");
        assert!(
            fixture.contains("Exact instructions (verbatim):"),
            "{fixture}"
        );
        assert!(fixture.contains("Inspect the exact bytes ✓"), "{fixture}");
        assert!(fixture.contains(&format!("Run ID: {run}")), "{fixture}");
        assert!(fixture.contains(&format!("Task ID: {task}")), "{fixture}");
        assert!(
            fixture.contains(&format!("Dispatch ID: {dispatch}")),
            "{fixture}"
        );
        assert!(fixture.contains("worker_done"), "{fixture}");
        assert!(fixture.contains("orchestration ask"), "{fixture}");
        assert!(fixture.contains("status"), "{fixture}");
        assert!(fixture.contains(&format!("RUN={run}")), "{fixture}");
        assert!(fixture.contains(&format!("TASK={task}")), "{fixture}");
        assert!(
            fixture.contains(&format!("DISPATCH={dispatch}")),
            "{fixture}"
        );

        let mut show = json!({
            "contractVersion": 1,
            "hostId": host,
            "runId": run,
            "coordinatorId": "owner",
            "consumerGeneration": 1,
            "dispatchId": dispatch
        });
        let shown = ok(&engine, "orchestration.workerShow", show.take());
        assert_eq!(shown["launch"]["harnessId"], "pi");
        assert_eq!(shown["launch"]["provider"], "openai-codex");
        assert_eq!(shown["launch"]["model"], "gpt-5.6-luna");
        assert_eq!(shown["assignmentState"], "ready");
    }
}
