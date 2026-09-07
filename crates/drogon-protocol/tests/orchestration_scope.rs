use drogon_protocol::orchestration_scope::{
    CoordinatorScope, DispatchScope, HostScope, MAX_CONSUMER_GENERATION,
};
use serde_json::{Value, json};

fn coordinator() -> Value {
    json!({"contractVersion":1,"hostId":"host-a","runId":"run-a",
        "coordinatorId":"coordinator-a","consumerGeneration":1})
}

#[test]
fn contexts_round_trip_without_changing_the_existing_envelope() {
    let value = coordinator();
    let scope: CoordinatorScope = serde_json::from_value(value.clone()).unwrap();
    scope.validate_shape("host-a").unwrap();
    assert_eq!(serde_json::to_value(scope).unwrap(), value);
    let worker = json!({"contractVersion":1,"hostId":"host-a","runId":"run-a",
        "taskId":"task-a","dispatchId":"attempt-a"});
    let scope: DispatchScope = serde_json::from_value(worker.clone()).unwrap();
    scope.validate_shape("host-a").unwrap();
    assert_eq!(serde_json::to_value(scope).unwrap(), worker);
}

#[test]
fn additive_context_fields_are_not_identity_or_authority() {
    let mut value = coordinator();
    value["future"] = json!({"optional":true});
    value["auth"] = json!("must-not-be-an-actor-credential");
    let scope: CoordinatorScope = serde_json::from_value(value).unwrap();
    assert_eq!(serde_json::to_value(&scope).unwrap(), coordinator());
    assert!(!format!("{scope:?}").contains("must-not-be-an-actor-credential"));
}

#[test]
fn context_requires_explicit_host_version_and_binding_fields() {
    for field in [
        "contractVersion",
        "hostId",
        "runId",
        "coordinatorId",
        "consumerGeneration",
    ] {
        let mut value = coordinator();
        value.as_object_mut().unwrap().remove(field);
        assert!(
            serde_json::from_value::<CoordinatorScope>(value).is_err(),
            "{field}"
        );
    }
    for version in [0, 2, u32::MAX] {
        let scope = HostScope {
            contract_version: version,
            host_id: "host-a".into(),
        };
        assert_eq!(
            scope.validate_target("host-a").unwrap_err().code,
            "unsupported_orchestration_contract"
        );
    }
}

#[test]
fn another_execution_host_is_refused_without_local_substitution() {
    let scope: CoordinatorScope = serde_json::from_value(coordinator()).unwrap();
    assert_eq!(
        scope.validate_shape("host-b").unwrap_err().code,
        "unsupported_host"
    );
}

#[test]
fn ids_are_bounded_opaque_tokens_and_errors_do_not_echo_input() {
    for field in ["hostId", "runId", "coordinatorId"] {
        for invalid in [
            "".to_string(),
            " ".into(),
            "a\nb".into(),
            "x".repeat(129),
            "a\u{2003}b".into(),
        ] {
            let mut value = coordinator();
            value[field] = json!(invalid);
            let scope: CoordinatorScope = serde_json::from_value(value).unwrap();
            let error = scope.validate_shape("host-a").unwrap_err();
            assert_eq!(error.code, "invalid_argument");
            assert_eq!(error.message, "Invalid orchestration context.");
        }
    }
    let mut value = coordinator();
    value["runId"] = json!("x".repeat(128));
    serde_json::from_value::<CoordinatorScope>(value)
        .unwrap()
        .validate_shape("host-a")
        .unwrap();
}

#[test]
fn generation_is_positive_and_exact_in_electron_json() {
    for generation in [0, MAX_CONSUMER_GENERATION + 1, u64::MAX] {
        let mut value = coordinator();
        value["consumerGeneration"] = json!(generation);
        let scope: CoordinatorScope = serde_json::from_value(value).unwrap();
        assert_eq!(
            scope.validate_shape("host-a").unwrap_err().code,
            "invalid_argument"
        );
    }
    for generation in [json!(-1), json!(1.5), json!("1"), Value::Null] {
        let mut value = coordinator();
        value["consumerGeneration"] = generation;
        assert!(serde_json::from_value::<CoordinatorScope>(value).is_err());
    }
    let mut value = coordinator();
    value["consumerGeneration"] = json!(MAX_CONSUMER_GENERATION);
    serde_json::from_value::<CoordinatorScope>(value)
        .unwrap()
        .validate_shape("host-a")
        .unwrap();
}

#[test]
fn a_dispatch_scope_never_defaults_missing_attempt_identity() {
    let value = json!({"contractVersion":1,"hostId":"host-a","runId":"run-a",
        "taskId":"task-a","dispatchId":"attempt-a"});
    for field in ["runId", "taskId", "dispatchId"] {
        let mut missing = value.clone();
        missing.as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<DispatchScope>(missing).is_err());
        let mut empty = value.clone();
        empty[field] = json!("");
        assert!(
            serde_json::from_value::<DispatchScope>(empty)
                .unwrap()
                .validate_shape("host-a")
                .is_err()
        );
    }
}
