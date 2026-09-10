//! C01 consumer: unavailable-catalog honesty through the existing RPC
//! surface.
//!
//! No host catalog is owned by the daemon yet (held lib.rs seam), so
//! these tests prove the admission neither invents enumeration nor
//! refutes ids it cannot verify: unknown-but-well-shaped ids fail only
//! on real host facts (a missing binary), shape errors still refuse
//! first, and `harness.list` stays discovery-only.
//!
//! Refusal-path tests only: no PTY is spawned and `session.list` stays
//! empty (filesystem-only: a temp data dir, a settings file, plus
//! SQLite — no processes, no probes, no network, no installed CLIs).

use std::path::Path;

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

fn call(engine: &Engine, method: &str, params: Value) -> drogon_protocol::Response {
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: uuid::Uuid::new_v4().to_string(),
        auth: None,
        method: method.into(),
        params,
    })
}

fn sessions_len(engine: &Engine) -> usize {
    call(engine, "session.list", json!({})).result.unwrap()["sessions"]
        .as_array()
        .unwrap()
        .len()
}

/// Point harness command overrides at paths that cannot exist, so host
/// fencing (not selection refutation) decides the outcome.
fn write_missing_overrides(dir: &Path, ids: &[&str]) {
    let mut overrides = serde_json::Map::new();
    for id in ids {
        overrides.insert(
            id.to_string(),
            json!(format!("/nonexistent/drogon-c01-test-{id}")),
        );
    }
    let envelope = json!({
        "version": 1,
        "settings": {
            "defaultTuiAgent": null,
            "disabledTuiAgents": [],
            "agentCmdOverrides": overrides,
            "agentDefaultArgs": {},
            "agentDefaultEnv": {},
            "agentStatusHooksEnabled": true,
            "tabAutoGenerateTitle": false,
            "promptCacheTimerEnabled": false,
            "promptCacheTtlMs": 300000,
            "codexSessionSourceHome": ""
        }
    });
    std::fs::write(
        dir.join("agent-settings.json"),
        serde_json::to_vec(&envelope).unwrap(),
    )
    .unwrap();
}

#[test]
fn unknown_ids_without_catalog_fail_on_host_facts_not_refutation() {
    // Well-shaped but never-enumerated provider/model ids must NOT come
    // back as an invented unknown-provider/unknown-model refusal: with no
    // catalog the daemon carries them unverified, and the only honest
    // refusal left is the missing binary.
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    write_missing_overrides(dir.path(), &["pi"]);
    let response = call(
        &engine,
        "harness.start",
        json!({
            "workspaceId": "missing",
            "harnessId": "pi",
            "provider": "no-such-provider",
            "model": "no-such-model",
            "effort": "high",
        }),
    );
    let error = response.error.expect("missing binary must still refuse");
    assert_eq!(error.code, "not_found");
    assert!(
        !error.message.contains("Unknown provider") && !error.message.contains("Unknown model"),
        "must cite host fencing, not a fabricated catalog verdict: {}",
        error.message
    );
    assert_eq!(sessions_len(&engine), 0);
}

#[test]
fn malformed_shape_refuses_before_fencing() {
    // Same order `validate_selection` enforces: shape first, host facts
    // after — even when the binary is also missing.
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    write_missing_overrides(dir.path(), &["pi"]);
    let response = call(
        &engine,
        "harness.start",
        json!({"workspaceId": "missing", "harnessId": "pi", "model": "bad\nvalue"}),
    );
    assert_eq!(response.error.unwrap().code, "invalid_argument");
    assert_eq!(sessions_len(&engine), 0);
}

#[test]
fn selection_vocabulary_applies_despite_missing_binary() {
    // An unsupported effort refuses with the selection code even though
    // fencing would also refuse: the selection verdict is not masked by
    // host state.
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    write_missing_overrides(dir.path(), &["opencode"]);
    let response = call(
        &engine,
        "harness.start",
        json!({"workspaceId": "missing", "harnessId": "opencode", "effort": "high"}),
    );
    assert_eq!(response.error.unwrap().code, "invalid_argument");
    assert_eq!(sessions_len(&engine), 0);
}

#[test]
fn harness_list_with_overrides_stays_discovery_only() {
    // Overridden-to-missing binaries fence through the list as `missing`,
    // and the list still carries no model enumeration, auth, or readiness
    // claims — nothing here invents a catalog.
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    write_missing_overrides(
        dir.path(),
        &["claude", "pi", "opencode", "antigravity", "codex"],
    );
    let status = call(&engine, "status", json!({})).result.unwrap();
    let catalog = call(&engine, "harness.list", json!({})).result.unwrap();
    assert_eq!(catalog["hostId"], status["hostId"]);
    let harnesses = catalog["harnesses"].as_array().unwrap();
    assert_eq!(harnesses.len(), 5);
    for item in harnesses {
        assert_eq!(item["availability"], "missing");
        assert!(item.get("models").is_none());
        assert!(item.get("auth").is_none());
        assert!(item.get("ready").is_none());
    }
}
