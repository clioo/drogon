use super::*;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::json;

fn invoke(engine: &Engine, method: &str, params: Value) -> drogon_protocol::Response {
    let request: Request = serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION, "requestId": uuid::Uuid::new_v4().to_string(),
        "auth": "fixture-token", "method": method, "params": params,
    }))
    .unwrap();
    engine.dispatch_authenticated(request, "fixture-token")
}

#[test]
fn preferences_persist_merge_and_never_overwrite_initialization() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    assert_eq!(engine.agent_settings().unwrap()["initialized"], false);
    for updates in [
        json!({"defaultTuiAgent": "pi", "agentDefaultArgs": {"pi": "--thinking high"}}),
        json!({"agentDefaultArgs": {"codex": "--model 'fixture model'"}, "agentStatusHooksEnabled": false}),
    ] {
        let response = invoke(
            &engine,
            "agent.settings_update",
            json!({"updates": updates}),
        );
        assert!(response.ok, "{response:?}");
    }
    let response = invoke(
        &engine,
        "agent.settings_update",
        json!({"onlyIfUninitialized": true, "updates": {"defaultTuiAgent": "claude"}}),
    );
    assert!(response.ok);
    drop(engine);
    let reopened = Engine::open(dir.path()).unwrap();
    let settings = reopened.read_agent_settings().unwrap().unwrap();
    assert_eq!(settings.default_tui_agent.as_deref(), Some("pi"));
    assert_eq!(settings.agent_default_args["pi"], "--thinking high");
    assert_eq!(
        settings.agent_default_args["codex"],
        "--model 'fixture model'"
    );
    assert!(!settings.agent_status_hooks_enabled);
    assert!(
        invoke(
            &reopened,
            "agent.settings_update",
            json!({"updates": {"disabledTuiAgents": ["pi"]}})
        )
        .ok
    );
    assert!(
        reopened
            .read_agent_settings()
            .unwrap()
            .unwrap()
            .default_tui_agent
            .is_none()
    );
}

#[test]
fn rejects_invalid_updates_without_losing_previous_settings() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    assert!(
        invoke(
            &engine,
            "agent.settings_update",
            json!({"updates": {"defaultTuiAgent": "codex"}})
        )
        .ok
    );
    for updates in [
        json!({"unknown": true}),
        json!({"defaultTuiAgent": "unimplemented"}),
        json!({"agentDefaultArgs": {"pi": "'unfinished"}}),
        json!({"agentCmdOverrides": {"pi": "pi\nrm"}}),
        json!({"promptCacheTtlMs": 0}),
        json!({"agentDefaultEnv": {"codex": {"CODEX_HOME": "/do/not/write"}}}),
        json!({"agentDefaultEnv": {"pi": {"DROGON_SESSION_ID": "other-session"}}}),
        json!({"agentDefaultEnv": {"pi": {"1BAD": "x"}}}),
        json!({"agentDefaultArgs": {"unknown": null}}),
    ] {
        assert!(
            !invoke(
                &engine,
                "agent.settings_update",
                json!({"updates": updates})
            )
            .ok,
            "{updates}"
        );
        assert_eq!(
            engine
                .read_agent_settings()
                .unwrap()
                .unwrap()
                .default_tui_agent
                .as_deref(),
            Some("codex")
        );
    }
}

#[test]
fn shell_tokens_are_grouped_but_never_evaluated() {
    assert_eq!(
        split_launch_args("--model 'has spaces' \"\" '$(touch nope)' a\\ b").unwrap(),
        ["--model", "has spaces", "", "$(touch nope)", "a b"]
    );
    assert!(split_launch_args("trailing\\").is_err());
    assert!(split_launch_args(&"a".repeat(8193)).is_err());
}

#[cfg(unix)]
#[test]
fn live_hooks_are_removed_restored_and_feed_titles_and_cache() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let binary = dir.path().join("claude-fixture");
    std::fs::write(&binary, "#!/bin/sh\nread line\n").unwrap();
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(
        invoke(
            &engine,
            "agent.settings_update",
            json!({"updates": {"agentCmdOverrides": {"claude": binary}}})
        )
        .ok
    );
    let workspace = invoke(&engine, "workspace.register", json!({"path": dir.path()}))
        .result
        .unwrap();
    let started = invoke(
        &engine,
        "harness.start",
        json!({"workspaceId": workspace["id"], "harnessId": "claude"}),
    );
    assert!(started.ok, "{started:?}");
    let session = started.result.unwrap();
    let handle = engine
        .sessions
        .lock()
        .unwrap()
        .get(session["id"].as_str().unwrap())
        .unwrap()
        .clone();
    struct Stop(std::sync::Arc<crate::session::SessionHandle>);
    impl Drop for Stop {
        fn drop(&mut self) {
            let _ = crate::session::stop(&self.0);
        }
    }
    let _stop = Stop(handle);
    let args = session["args"].as_array().unwrap();
    let index = args.iter().position(|arg| arg == "--settings").unwrap();
    let path = Path::new(args[index + 1].as_str().unwrap());
    let original = std::fs::read(path).unwrap();
    let event = |name: &str, preview: Option<&str>| {
        invoke(
            &engine,
            "session.hook_event",
            json!({"sessionId": session["id"], "incarnation": session["incarnation"], "event": name, "promptPreview": preview}),
        )
    };
    let prompt = "Please refactor auth";
    let first = event("UserPromptSubmit", Some(prompt));
    assert_eq!(first.result.unwrap()["agentPromptPreview"], prompt);
    let stopped = event("Stop", None).result.unwrap();
    assert!(stopped["cacheIdleAt"].is_string());
    // Issue #360 fork parity: Claude's Stop concludes the turn (the
    // reference maps it to done), never needs_input; with no PTY output
    // observed the turn-end hook itself is the idle authority.
    assert_eq!(stopped["agentState"], "idle");
    assert!(
        invoke(
            &engine,
            "agent.settings_update",
            json!({"updates": {"agentStatusHooksEnabled": false}})
        )
        .ok
    );
    assert!(
        !std::fs::read_to_string(path)
            .unwrap()
            .contains("internal hook-event")
    );
    assert_ne!(
        event("Stop", None).result.unwrap()["agentState"],
        "needs_input"
    );
    assert!(
        invoke(
            &engine,
            "agent.settings_update",
            json!({"updates": {"agentStatusHooksEnabled": true}})
        )
        .ok
    );
    assert_eq!(std::fs::read(path).unwrap(), original);
    let next = event("UserPromptSubmit", Some("Later prompt"))
        .result
        .unwrap();
    assert_eq!(next["agentPromptPreview"], prompt);
    assert!(next["cacheIdleAt"].is_null());
    let closed = invoke(
        &engine,
        "session.close",
        json!({"sessionId": session["id"], "incarnation": session["incarnation"]}),
    );
    assert!(closed.ok, "{closed:?}");
    assert_eq!(closed.result.unwrap()["verdict"], "exited");
}

#[cfg(unix)]
#[test]
fn real_pty_uses_command_arguments_environment_and_disabled_hooks() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let binary = dir.path().join("agent fixture");
    std::fs::write(&binary, "#!/bin/sh\nprintf 'ARG=%s\\n' \"$@\"\nprintf 'ENV=%s\\n' \"$AGENT_FIXTURE_VALUE\"\nprintf 'fixture-complete\\n'\n").unwrap();
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(invoke(&engine, "agent.settings_update", json!({"updates": {
        "agentCmdOverrides": {"pi": binary}, "agentDefaultArgs": {"pi": "--model 'fixture model' '$(not-executed)'"},
        "agentDefaultEnv": {"pi": {"AGENT_FIXTURE_VALUE": "persisted value"}}, "agentStatusHooksEnabled": false
    }})).ok);
    let listed = engine.harness_list().unwrap();
    let pi = listed["harnesses"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["harnessId"] == "pi")
        .unwrap();
    assert_eq!(pi["availability"], "available");
    let registered = invoke(&engine, "workspace.register", json!({"path": dir.path()}));
    let started = invoke(
        &engine,
        "harness.start",
        json!({"workspaceId": registered.result.unwrap()["id"], "harnessId": "pi", "permissionMode": "unattended"}),
    );
    assert!(started.ok, "{started:?}");
    let session = started.result.unwrap();
    struct Cleanup<'a>(&'a Engine, Value);
    impl Drop for Cleanup<'_> {
        fn drop(&mut self) {
            let _ = invoke(
                self.0,
                "session.close",
                json!({"sessionId": self.1["id"], "incarnation": self.1["incarnation"]}),
            );
        }
    }
    let _cleanup = Cleanup(&engine, session.clone());
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    let text = loop {
        let response = invoke(
            &engine,
            "session.read",
            json!({"sessionId": session["id"], "incarnation": session["incarnation"]}),
        );
        assert!(response.ok, "{response:?}");
        let value = response.result.unwrap();
        use base64::Engine as _;
        let text = String::from_utf8(
            base64::engine::general_purpose::STANDARD
                .decode(value["dataBase64"].as_str().unwrap())
                .unwrap(),
        )
        .unwrap();
        if value["session"]["verdict"] == "exited" && text.contains("fixture-complete") {
            break text;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "fixture did not exit: {value}"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    };
    assert!(text.contains("ARG=fixture model"), "{text}");
    assert!(text.contains("ARG=$(not-executed)"), "{text}");
    assert!(text.contains("ENV=persisted value"), "{text}");
    assert!(
        !text.contains("--extension"),
        "disabled hooks must not install: {text}"
    );
    assert!(
        !text.contains("--approve"),
        "source Pi defaults have no invented permission flag: {text}"
    );
    assert!(
        invoke(
            &engine,
            "agent.settings_update",
            json!({"updates": {"disabledTuiAgents": ["pi"]}})
        )
        .ok
    );
    let refused = invoke(
        &engine,
        "harness.start",
        json!({"workspaceId": session["workspaceId"], "harnessId": "pi"}),
    );
    assert!(!refused.ok);
}
