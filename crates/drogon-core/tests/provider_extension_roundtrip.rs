//! Named roundtrip regression suite: admitted provider-record extensions
//! (unknown JSON members at every object level the pinned source preserves)
//! must survive admission, typed re-serialization, and the assigned
//! provider-handle transition, and typed callers must never override
//! authority by inserting known keys into an extensions map.
//!
//! Source pin c97906287bb7a390b25e2025b600d9fb3c25d9c3: the transition
//! spreads record/lease with known keys winning
//! (`agent-session-provider-handle-transition.ts`), the durable store
//! persists the validated object verbatim
//! (`agent-session-record-store-file.ts`, `agent-session-store-serialization.ts`),
//! and nested sub-objects plus links are carried by reference; the source
//! writes `processlessAt: null` explicitly
//! (`agent-session-lease-transitions.ts`).

use serde_json::{Value, json};

use drogon_core::session_authority::provider_handle::{
    HandleOrigin, ProviderHandle, ProviderHandleLink,
};
use drogon_core::session_authority::record::{
    RecordReadError, admit_persisted_record, is_agent_session_record,
};
use drogon_core::session_authority::transition::record_agent_session_provider_handle;

/// Shallow-merge `overrides` into `base` (JSON objects only).
fn merge_json(base: &mut Value, overrides: Value) {
    if let (Some(base_map), Value::Object(overrides_map)) = (base.as_object_mut(), overrides) {
        for (key, value) in overrides_map {
            base_map.insert(key, value);
        }
    }
}

fn owner_process_json(overrides: Value) -> Value {
    let mut process = json!({
        "hostId": "local",
        "pid": 4242,
        "processStartTimeMs": 1_700_000_000_000_i64,
        "spawnToken": "spawn-tui",
        "cgroup": "cpu.setA"
    });
    merge_json(&mut process, overrides);
    process
}

fn lease_json(overrides: Value) -> Value {
    let mut lease = json!({
        "sessionId": "session-alpha-1",
        "runtimeKind": "tui",
        "runtimeFence": 7,
        "handoffStage": null,
        "provenHandleLinkId": "link-1",
        "ownerProcess": owner_process_json(json!({})),
        "reservedSpawnToken": "spawn-tui",
        "leaseDeadlineAt": 60_000,
        "lastRenewedAt": 30_000,
        "handoffOperationId": null,
        "journalCheckpoint": {"epoch": 4, "sequence": 9, "writer": "epoch-writer-4"},
        "claimKeyId": "key-1",
        "claimStatus": "live",
        "unreconciled": false,
        "deathEvidence": null,
        "schedulerTrace": "retry-7"
    });
    merge_json(&mut lease, overrides);
    lease
}

/// Valid live record carrying one extension member at every object level the
/// source preserves: record, location, accountHome, lease, ownerProcess,
/// journalCheckpoint, link, and handle.
fn extended_record_json(lease_overrides: Value) -> Value {
    json!({
        "schemaVersion": 2,
        "sessionId": "session-alpha-1",
        "location": {
            "executionHostId": "local",
            "wslDistro": null,
            "workspaceId": "workspace-1",
            "workspaceKind": "git-worktree",
            "hostLabels": ["primary"]
        },
        "provider": "claude",
        "providerHandleChain": [{
            "linkId": "link-1",
            "origin": "created",
            "mintedAtFence": 7,
            "observedAt": 1_000,
            "mintTrace": "mint-1",
            "handle": {
                "provider": "claude",
                "sessionId": "provider-session-alpha-1",
                "leafUuid": null,
                "vendorHint": "v1"
            }
        }],
        "accountHome": {
            "variable": "CLAUDE_CONFIG_DIR",
            "path": "/home/user/.claude",
            "mountHint": "ssd"
        },
        "lease": lease_json(lease_overrides),
        "vendorTelemetry": {"lane": "native"},
        "createdAt": 1_000,
        "updatedAt": 2_000
    })
}

fn resumed_link_json(link_id: &str, leaf: &str, fence: i64) -> Value {
    json!({
        "linkId": link_id,
        "origin": "resumed",
        "mintedAtFence": fence,
        "observedAt": 4_000,
        "mintTrace": format!("mint-{link_id}"),
        "handle": {
            "provider": "claude",
            "sessionId": "provider-session-alpha-1",
            "leafUuid": leaf,
            "vendorHint": "v2"
        }
    })
}

#[test]
fn admitted_extensions_survive_admission_serialization_and_repeat() {
    let raw = extended_record_json(json!({}));
    let record = admit_persisted_record(&raw).expect("extension-bearing record must admit");
    let serialized = record.to_json();
    assert!(
        is_agent_session_record(&serialized),
        "serialization with extensions must still validate as a record"
    );
    // Every source-preserved level keeps its extension member verbatim.
    assert_eq!(serialized["vendorTelemetry"], json!({"lane": "native"}));
    assert_eq!(serialized["location"]["hostLabels"], json!(["primary"]));
    assert_eq!(serialized["accountHome"]["mountHint"], json!("ssd"));
    assert_eq!(serialized["lease"]["schedulerTrace"], json!("retry-7"));
    assert_eq!(
        serialized["lease"]["ownerProcess"]["cgroup"],
        json!("cpu.setA")
    );
    assert_eq!(
        serialized["lease"]["journalCheckpoint"]["writer"],
        json!("epoch-writer-4")
    );
    assert_eq!(
        serialized["providerHandleChain"][0]["mintTrace"],
        json!("mint-1")
    );
    assert_eq!(
        serialized["providerHandleChain"][0]["handle"]["vendorHint"],
        json!("v1")
    );
    // Repeated roundtrip is stable: admit the serialized form again.
    let re_admitted =
        admit_persisted_record(&serialized).expect("serialized extensions must re-admit");
    assert_eq!(
        re_admitted.to_json(),
        serialized,
        "roundtrip must be stable"
    );
}

#[test]
fn extensions_survive_live_transition_and_appended_link_known_fields_win() {
    let record = admit_persisted_record(&extended_record_json(json!({})))
        .expect("extension-bearing record must admit");
    let appended = ProviderHandleLink::from_json(&resumed_link_json("link-2", "leaf-2", 7))
        .expect("extension-bearing link must parse");
    let next =
        record_agent_session_provider_handle(&record, 7, &appended, 4_500).expect("live advance");
    let serialized = next.to_json();
    assert!(is_agent_session_record(&serialized));
    // Record- and lease-level extensions carried through the spreads.
    assert_eq!(serialized["vendorTelemetry"], json!({"lane": "native"}));
    assert_eq!(serialized["lease"]["schedulerTrace"], json!("retry-7"));
    // Nested levels untouched by the transition keep their extensions.
    assert_eq!(serialized["location"]["hostLabels"], json!(["primary"]));
    assert_eq!(
        serialized["lease"]["ownerProcess"]["cgroup"],
        json!("cpu.setA")
    );
    // The appended link and its handle keep their extensions, and the
    // untouched head link keeps its own.
    assert_eq!(
        serialized["providerHandleChain"][0]["mintTrace"],
        json!("mint-1")
    );
    assert_eq!(
        serialized["providerHandleChain"][0]["handle"]["vendorHint"],
        json!("v1")
    );
    assert_eq!(
        serialized["providerHandleChain"][1]["mintTrace"],
        json!("mint-link-2")
    );
    assert_eq!(
        serialized["providerHandleChain"][1]["handle"]["vendorHint"],
        json!("v2")
    );
    // Known fields written after the source spreads win.
    assert_eq!(serialized["lease"]["lastRenewedAt"], json!(4_500));
    assert_eq!(serialized["updatedAt"], json!(4_500));
    assert_eq!(serialized["lease"]["provenHandleLinkId"], json!("link-2"));
}

#[test]
fn transition_known_field_updates_never_resurrect_stale_values() {
    let record = admit_persisted_record(&extended_record_json(json!({})))
        .expect("extension-bearing record must admit");
    let appended = ProviderHandleLink::from_json(&resumed_link_json("link-2", "leaf-2", 7))
        .expect("extension-bearing link must parse");
    let serialized = record_agent_session_provider_handle(&record, 7, &appended, 4_500)
        .expect("live advance")
        .to_json();
    // The moved known fields carry exactly the new values — no stale shadow
    // copy of the pre-transition lease may survive anywhere in the output.
    assert_eq!(serialized["lease"]["lastRenewedAt"], json!(4_500));
    assert_ne!(serialized["lease"]["lastRenewedAt"], json!(30_000));
    assert_eq!(serialized["updatedAt"], json!(4_500));
    assert_ne!(serialized["updatedAt"], json!(2_000));
    assert_eq!(serialized["lease"]["provenHandleLinkId"], json!("link-2"));
    assert_ne!(serialized["lease"]["provenHandleLinkId"], json!("link-1"));
    // Known-optional fields absent from the source record stay absent; the
    // transition must not fabricate them and extension merging must not
    // turn empty extension sets into emitted members.
    for optional in [
        "options",
        "launchArgs",
        "minimumNextFence",
        "processlessAt",
        "settlementRetryRequired",
        "settlementRetryId",
    ] {
        assert!(
            serialized.get(optional).is_none(),
            "{optional} must stay absent"
        );
    }
    for optional in [
        "processlessAt",
        "minimumNextFence",
        "settlementRetryRequired",
        "settlementRetryId",
    ] {
        assert!(
            serialized["lease"].get(optional).is_none(),
            "lease {optional} must stay absent"
        );
    }
}

#[test]
fn known_optional_null_and_absent_states_roundtrip_faithfully() {
    // The source writes `processlessAt: null` explicitly (reservation, commit,
    // evict), so a persisted null must re-serialize as null.
    let null_processless =
        admit_persisted_record(&extended_record_json(json!({"processlessAt": null})))
            .expect("null processlessAt is valid");
    let serialized = null_processless.to_json();
    assert_eq!(
        serialized["lease"].get("processlessAt"),
        Some(&Value::Null),
        "source-written null must not collapse to absent"
    );
    // Absent stays absent through a new-owner-proving transition, and the
    // proving stage must not rewrite the unproven provenHandleLinkId.
    let mut proving_raw = extended_record_json(json!({
        "claimStatus": "reserved",
        "handoffStage": "new-owner-proving",
        "provenHandleLinkId": null,
        "ownerProcess": null,
        "reservedSpawnToken": null,
        "runtimeFence": 8
    }));
    proving_raw["providerHandleChain"][0]["mintedAtFence"] = json!(8);
    let proving = admit_persisted_record(&proving_raw).expect("proving record admits");
    let appended = ProviderHandleLink::from_json(&resumed_link_json("link-2", "leaf-2", 8))
        .expect("extension-bearing link must parse");
    let proving_next = record_agent_session_provider_handle(&proving, 8, &appended, 4_500)
        .expect("proving record records the leaf");
    let proving_serialized = proving_next.to_json();
    assert_eq!(
        proving_serialized["lease"].get("processlessAt"),
        None,
        "absent must stay absent"
    );
    assert_eq!(
        proving_serialized["lease"]["provenHandleLinkId"],
        Value::Null,
        "new-owner-proving keeps the reserved, unproven status"
    );
    assert_eq!(
        proving_serialized["lease"]["claimStatus"],
        json!("reserved")
    );
}

#[test]
fn future_version_quarantine_preserves_extensions_raw() {
    let mut future = extended_record_json(json!({}));
    future["schemaVersion"] = json!(3);
    let error = admit_persisted_record(&future).expect_err("future version is quarantined");
    match &error {
        RecordReadError::UnsupportedSchema { raw } => {
            assert_eq!(raw, &future, "quarantine must keep the raw value verbatim");
            assert_eq!(raw["vendorTelemetry"], json!({"lane": "native"}));
        }
        RecordReadError::Invalid { .. } => panic!("expected UnsupportedSchema, got {error:?}"),
    }
}

#[test]
fn retry_append_dedupe_preserves_head_link_extensions() {
    let record = admit_persisted_record(&extended_record_json(json!({})))
        .expect("extension-bearing record must admit");
    // Same handle as the head at the same fence: a retry, not a new identity.
    let head_handle_json = json!({
        "provider": "claude",
        "sessionId": "provider-session-alpha-1",
        "leafUuid": null
    });
    let retry = ProviderHandleLink::from_json(&json!({
        "linkId": "link-retry",
        "origin": "resumed",
        "mintedAtFence": 7,
        "observedAt": 4_000,
        "handle": head_handle_json
    }))
    .expect("retry link must parse");
    let next =
        record_agent_session_provider_handle(&record, 7, &retry, 4_500).expect("retry renews");
    let serialized = next.to_json();
    assert_eq!(
        serialized["providerHandleChain"].as_array().unwrap().len(),
        1
    );
    assert_eq!(
        serialized["providerHandleChain"][0]["mintTrace"],
        json!("mint-1")
    );
    assert_eq!(serialized["lease"]["lastRenewedAt"], json!(4_500));
    assert_eq!(serialized["lease"]["provenHandleLinkId"], json!("link-1"));
}

#[test]
fn raw_unknown_values_and_minimum_next_fence_survive_roundtrip() {
    let mut raw = extended_record_json(json!({
        "minimumNextFence": {"floor": "21"}
    }));
    raw["vendorNull"] = Value::Null;
    raw["vendorPairs"] = json!([1, 2]);
    raw["vendorDeep"] = json!({"a": [true, 1.5, "s"]});
    raw["lease"]["vendorValues"] = json!({"n": null, "xs": [1, 2], "f": 1.5});
    let record = admit_persisted_record(&raw).expect("raw extension values must admit");
    let serialized = record.to_json();
    assert_eq!(
        serialized["lease"]["minimumNextFence"],
        json!({"floor": "21"}),
        "raw minimumNextFence stays verbatim, unvalidated"
    );
    assert_eq!(serialized["vendorNull"], Value::Null);
    assert_eq!(serialized["vendorPairs"], json!([1, 2]));
    assert_eq!(serialized["vendorDeep"], json!({"a": [true, 1.5, "s"]}));
    assert_eq!(
        serialized["lease"]["vendorValues"],
        json!({"n": null, "xs": [1, 2], "f": 1.5})
    );
}

#[test]
fn typed_known_keys_in_extensions_never_override_serialization() {
    let mut record = admit_persisted_record(&extended_record_json(json!({
        "deathEvidence": {
            "kind": "exit-observed",
            "detail": "observed process exit",
            "observedAt": 9_000
        }
    })))
    .expect("fixture admits");
    let shadow = || json!("shadow");
    record.extensions.insert("updatedAt".into(), json!(999));
    record.extensions.insert("schemaVersion".into(), json!(3));
    // Known-optional absent: a shadow entry must not resurrect the key.
    record
        .extensions
        .insert("options".into(), json!({"shadow": "v"}));
    record
        .location
        .extensions
        .insert("workspaceKind".into(), shadow());
    record
        .account_home
        .extensions
        .insert("variable".into(), shadow());
    let lease = &mut record.lease;
    lease.extensions.insert("runtimeFence".into(), json!(999));
    lease
        .extensions
        .insert("settlementRetryRequired".into(), json!(true));
    lease
        .owner_process
        .as_mut()
        .unwrap()
        .extensions
        .insert("pid".into(), json!(1));
    lease
        .journal_checkpoint
        .as_mut()
        .unwrap()
        .extensions
        .insert("epoch".into(), json!(999));
    lease
        .death_evidence
        .as_mut()
        .unwrap()
        .extensions
        .insert("kind".into(), shadow());
    record.provider_handle_chain[0]
        .extensions
        .insert("origin".into(), shadow());
    if let ProviderHandle::Claude { extensions, .. } = &mut record.provider_handle_chain[0].handle {
        extensions.insert("sessionId".into(), shadow());
    }
    let serialized = record.to_json();
    assert_eq!(serialized["updatedAt"], json!(2_000));
    assert_eq!(serialized["schemaVersion"], json!(2));
    assert!(serialized.get("options").is_none());
    assert_eq!(
        serialized["location"]["workspaceKind"],
        json!("git-worktree")
    );
    assert_eq!(
        serialized["accountHome"]["variable"],
        json!("CLAUDE_CONFIG_DIR")
    );
    assert_eq!(serialized["lease"]["runtimeFence"], json!(7));
    assert!(serialized["lease"].get("settlementRetryRequired").is_none());
    assert_eq!(serialized["lease"]["ownerProcess"]["pid"], json!(4242));
    assert_eq!(serialized["lease"]["journalCheckpoint"]["epoch"], json!(4));
    assert_eq!(
        serialized["lease"]["deathEvidence"]["kind"],
        json!("exit-observed")
    );
    assert_eq!(
        serialized["providerHandleChain"][0]["origin"],
        json!("created")
    );
    assert_eq!(
        serialized["providerHandleChain"][0]["handle"]["sessionId"],
        json!("provider-session-alpha-1")
    );
}

#[test]
fn codex_handle_and_link_extensions_reject_known_smuggling_and_roundtrip() {
    let mut handle = ProviderHandle::Codex {
        thread_id: "thread-1".to_string(),
        extensions: serde_json::Map::new(),
    };
    if let ProviderHandle::Codex { extensions, .. } = &mut handle {
        extensions.insert("threadId".into(), json!("shadow"));
        extensions.insert("vendorHint".into(), json!("v1"));
    }
    let mut link = ProviderHandleLink {
        link_id: "link-1".to_string(),
        handle,
        origin: HandleOrigin::Created,
        minted_at_fence: 1,
        observed_at: 1_000,
        forked_from_key: None,
        extensions: serde_json::Map::new(),
    };
    link.extensions.insert("origin".into(), json!("forked"));
    link.extensions.insert("mintTrace".into(), json!("mint-1"));
    let serialized = link.to_json();
    // Known fields serialize from typed state; unknown members survive.
    assert_eq!(serialized["handle"]["threadId"], json!("thread-1"));
    assert_eq!(serialized["origin"], json!("created"));
    assert_eq!(serialized["handle"]["vendorHint"], json!("v1"));
    assert_eq!(serialized["mintTrace"], json!("mint-1"));
    // Repeat roundtrip: intake filters known keys, output stays stable.
    let reparsed = ProviderHandleLink::from_json(&serialized).expect("parses");
    assert!(reparsed.extensions.get("origin").is_none());
    assert_eq!(reparsed.extensions.get("mintTrace"), Some(&json!("mint-1")));
    assert_eq!(reparsed.to_json(), serialized);
}

#[test]
fn death_evidence_extension_survives_admission_and_repeat_roundtrip() {
    let raw = extended_record_json(json!({
        "deathEvidence": {
            "kind": "pid-absent",
            "detail": "no such pid",
            "observedAt": 9_000,
            "autopsyId": "auto-9"
        }
    }));
    let record = admit_persisted_record(&raw).expect("deathEvidence fixture admits");
    let serialized = record.to_json();
    assert_eq!(
        serialized["lease"]["deathEvidence"]["autopsyId"],
        json!("auto-9")
    );
    let re_admitted = admit_persisted_record(&serialized).expect("re-admits");
    assert_eq!(
        re_admitted.to_json(),
        serialized,
        "roundtrip must be stable"
    );
    assert_eq!(
        re_admitted
            .lease
            .death_evidence
            .unwrap()
            .extensions
            .get("autopsyId"),
        Some(&json!("auto-9"))
    );
}
