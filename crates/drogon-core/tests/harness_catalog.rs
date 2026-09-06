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

#[test]
fn catalog_has_real_host_identity_and_no_claim_of_model_readiness() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let status = call(&engine, "status", json!({})).result.unwrap();
    let catalog = call(&engine, "harness.list", json!({})).result.unwrap();
    assert_eq!(catalog["hostId"], status["hostId"]);
    assert_eq!(catalog["harnesses"].as_array().unwrap().len(), 4);
    for item in catalog["harnesses"].as_array().unwrap() {
        assert!(item.get("models").is_none());
        assert!(item.get("auth").is_none());
        assert!(item.get("ready").is_none());
    }
    assert!(
        status["capabilities"]
            .as_array()
            .unwrap()
            .contains(&json!("harness.catalog.v1"))
    );
}

#[test]
fn unknown_harness_and_malformed_preferences_do_not_spawn() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    for params in [
        json!({"workspaceId":"missing","harnessId":"not-a-harness"}),
        json!({"workspaceId":"missing","harnessId":"pi","permissionMode":"bypass"}),
    ] {
        assert_eq!(
            call(&engine, "harness.start", params).error.unwrap().code,
            "invalid_argument"
        );
    }
    assert!(
        call(&engine, "session.list", json!({})).result.unwrap()["sessions"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}
