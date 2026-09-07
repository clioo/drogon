//! Tests for [`super::Actor`] receipt keys and [`super::DispatchCredential`].

use super::{Actor, DispatchCredential};

fn coordinator() -> Actor {
    Actor::Coordinator {
        host_id: "host-1".into(),
        run_id: "run-1".into(),
        coordinator_id: "coord-1".into(),
        consumer_generation: 1,
    }
}

fn worker() -> Actor {
    Actor::Worker {
        host_id: "host-1".into(),
        run_id: "run-1".into(),
        task_id: "task-1".into(),
        dispatch_id: "dispatch-1".into(),
        session_id: "session-1".into(),
        incarnation: "incarnation-1".into(),
    }
}

#[test]
fn mint_is_64_lowercase_hex_ascii() {
    let credential = DispatchCredential::mint().expect("mint");
    let secret = credential.as_secret_str();
    assert_eq!(secret.len(), 64);
    assert!(
        secret
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    );
}

#[test]
fn mint_samples_differ() {
    // Observed distinctness only, not an entropy proof.
    let first = DispatchCredential::mint().expect("mint");
    let second = DispatchCredential::mint().expect("mint");
    assert_ne!(first.as_secret_str(), second.as_secret_str());
}

#[test]
fn digest_matches_presented_wire_secret() {
    use sha2::{Digest, Sha256};
    let credential = DispatchCredential::mint().expect("mint");
    let expected = format!(
        "{:x}",
        Sha256::digest(credential.as_secret_str().as_bytes())
    );
    assert_eq!(credential.digest(), expected);
    assert_eq!(credential.as_secret_str().len(), 64);
}

#[test]
fn debug_omits_secret() {
    let credential = DispatchCredential::mint().expect("mint");
    let shown = format!("{credential:?}");
    assert!(!shown.contains(credential.as_secret_str()));
    assert!(!shown.contains(credential.digest().as_str()));
}

#[test]
fn same_external_id_separates_actor_kinds() {
    let admin = Actor::AdminBootstrap {
        host_id: "host-1".into(),
        coordinator_id: "coord-1".into(),
    };
    let keys = [
        admin.receipt_key("ext-1").expect("admin key"),
        coordinator().receipt_key("ext-1").expect("coordinator key"),
        worker().receipt_key("ext-1").expect("worker key"),
    ];
    assert!(keys.iter().all(|k| {
        k.strip_prefix("\0drogon-coordination-v1:")
            .is_some_and(|digest| {
                digest.len() == 64 && digest.bytes().all(|b| b.is_ascii_hexdigit())
            })
    }));
    assert_ne!(keys[0], keys[1]);
    assert_ne!(keys[0], keys[2]);
    assert_ne!(keys[1], keys[2]);
}

#[test]
fn every_actor_field_contributes_to_key() {
    let baseline = worker().receipt_key("ext-1").expect("key");
    let variants = [
        Actor::Worker {
            host_id: "host-2".into(),
            run_id: "run-1".into(),
            task_id: "task-1".into(),
            dispatch_id: "dispatch-1".into(),
            session_id: "session-1".into(),
            incarnation: "incarnation-1".into(),
        },
        Actor::Worker {
            host_id: "host-1".into(),
            run_id: "run-2".into(),
            task_id: "task-1".into(),
            dispatch_id: "dispatch-1".into(),
            session_id: "session-1".into(),
            incarnation: "incarnation-1".into(),
        },
        Actor::Worker {
            host_id: "host-1".into(),
            run_id: "run-1".into(),
            task_id: "task-2".into(),
            dispatch_id: "dispatch-1".into(),
            session_id: "session-1".into(),
            incarnation: "incarnation-1".into(),
        },
        Actor::Worker {
            host_id: "host-1".into(),
            run_id: "run-1".into(),
            task_id: "task-1".into(),
            dispatch_id: "dispatch-2".into(),
            session_id: "session-1".into(),
            incarnation: "incarnation-1".into(),
        },
        Actor::Worker {
            host_id: "host-1".into(),
            run_id: "run-1".into(),
            task_id: "task-1".into(),
            dispatch_id: "dispatch-1".into(),
            session_id: "session-2".into(),
            incarnation: "incarnation-1".into(),
        },
        Actor::Worker {
            host_id: "host-1".into(),
            run_id: "run-1".into(),
            task_id: "task-1".into(),
            dispatch_id: "dispatch-1".into(),
            session_id: "session-1".into(),
            incarnation: "incarnation-2".into(),
        },
        Actor::Coordinator {
            host_id: "host-2".into(),
            run_id: "run-1".into(),
            coordinator_id: "coord-1".into(),
            consumer_generation: 1,
        },
        Actor::Coordinator {
            host_id: "host-1".into(),
            run_id: "run-1".into(),
            coordinator_id: "coord-2".into(),
            consumer_generation: 1,
        },
        Actor::Coordinator {
            host_id: "host-1".into(),
            run_id: "run-1".into(),
            coordinator_id: "coord-1".into(),
            consumer_generation: 2,
        },
    ];
    for variant in &variants {
        let comparison = match variant {
            Actor::Coordinator { .. } => coordinator().receipt_key("ext-1").expect("key"),
            _ => baseline.clone(),
        };
        assert_ne!(variant.receipt_key("ext-1").expect("key"), comparison);
    }
}

#[test]
fn delimiter_splits_and_unicode_forms_cannot_collide() {
    let key = |task: &str, dispatch: &str| {
        Actor::Worker {
            host_id: "host-1".into(),
            run_id: "run-1".into(),
            task_id: task.into(),
            dispatch_id: dispatch.into(),
            session_id: "session-1".into(),
            incarnation: "incarnation-1".into(),
        }
        .receipt_key("ext-1")
        .expect("key")
    };
    assert_ne!(key("a|b", "c"), key("a", "b|c"));
    assert_ne!(key("a:b", "c"), key("a", "b:c"));
    assert_ne!(key("caf\u{e9}", "d"), key("cafe\u{301}", "d"));
    assert_ne!(key("task-\u{1f600}", "d"), key("task-\u{1f601}", "d"));
    // Non-ASCII identities are accepted and deterministic.
    assert_eq!(
        key("\u{6d4b}\u{8bd5}-1", "d"),
        key("\u{6d4b}\u{8bd5}-1", "d")
    );
}

#[test]
fn same_identity_is_deterministic_and_opaque() {
    let first = worker().receipt_key("ext-1").expect("key");
    let second = worker().receipt_key("ext-1").expect("key");
    assert_eq!(first, second);
    assert_ne!(first, worker().receipt_key("ext-2").expect("key"));
    for raw in [
        "host-1",
        "run-1",
        "task-1",
        "dispatch-1",
        "session-1",
        "incarnation-1",
        "ext-1",
    ] {
        assert!(!first.contains(raw), "key must not embed actor fields");
    }
}

#[test]
fn internal_receipt_key_is_outside_legacy_request_namespace() {
    let key = worker().receipt_key("ext-1").expect("key");
    let request = drogon_protocol::Request {
        protocol: drogon_protocol::PROTOCOL_VERSION,
        request_id: key.clone(),
        method: "status".into(),
        params: serde_json::json!({}),
        auth: None,
    };
    assert!(
        request.validate().is_err(),
        "legacy caller can claim an internal key"
    );
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute("CREATE TABLE identity_probe (key TEXT PRIMARY KEY)", [])
        .unwrap();
    conn.execute("INSERT INTO identity_probe VALUES (?1)", [&key])
        .unwrap();
    let restored: String = conn
        .query_row(
            "SELECT key FROM identity_probe WHERE key=?1",
            [&key],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(restored, key);
}

#[test]
fn invalid_fields_fail_closed() {
    let long = "x".repeat(129);
    let bad_ids = [
        "",
        " ",
        "has space",
        "has\ttab",
        "has\nnewline",
        "has\x01control",
        &long,
    ];
    for bad in bad_ids {
        let actor = Actor::Worker {
            host_id: bad.into(),
            run_id: "run-1".into(),
            task_id: "task-1".into(),
            dispatch_id: "dispatch-1".into(),
            session_id: "session-1".into(),
            incarnation: "incarnation-1".into(),
        };
        assert!(
            actor.receipt_key("ext-1").is_err(),
            "host_id {bad:?} must fail"
        );
    }
    for generation in [
        0,
        drogon_protocol::orchestration_scope::MAX_CONSUMER_GENERATION + 1,
    ] {
        let actor = Actor::Coordinator {
            host_id: "host-1".into(),
            run_id: "run-1".into(),
            coordinator_id: "coord-1".into(),
            consumer_generation: generation,
        };
        assert!(
            actor.receipt_key("ext-1").is_err(),
            "generation {generation} must fail"
        );
    }
    for bad_external in ["", "has\nnewline", "has\x7fcontrol", &long] {
        assert!(
            worker().receipt_key(bad_external).is_err(),
            "external id {bad_external:?} must fail"
        );
    }
}

#[test]
fn fingerprint_nested_reorder_is_existing_green() {
    // Existing behavior of `requests::fingerprint`, labeled GREEN (passes on
    // the unchanged candidate): nested object key order is insignificant,
    // while array order, values, and method are significant.
    use crate::requests::fingerprint;
    use serde_json::json;
    let ordered = json!({"a": 1, "b": {"x": 1, "y": [1, 2]}});
    let reordered = json!({"b": {"y": [1, 2], "x": 1}, "a": 1});
    assert_eq!(fingerprint("m", &ordered), fingerprint("m", &reordered));
    assert_ne!(
        fingerprint("m", &ordered),
        fingerprint("m", &json!({"a": 1, "b": {"x": 1, "y": [2, 1]}}))
    );
    assert_ne!(
        fingerprint("m", &ordered),
        fingerprint("m", &json!({"a": 2, "b": {"x": 1, "y": [1, 2]}}))
    );
    assert_ne!(fingerprint("other", &ordered), fingerprint("m", &ordered));
}
