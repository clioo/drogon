//! Parity port of the Orca agent-session provider handle chain and
//! schema-v2 provider conversation record contracts (dependency slice 1).
//!
//! Mapped case-by-case from the frozen source at revision
//! c97906287bb7a390b25e2025b600d9fb3c25d9c3 and recorded in
//! tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/:
//!
//! - `src/shared/agent-session-provider-handle.test.ts` — the 17-case /
//!   45-assertion handle suite, ported as the `source_case_*` tests below.
//! - `src/main/runtime/agent-session-provider-handle-transition.test.ts` —
//!   the 2-case / 4-assertion transition suite, admitted under
//!   `tests/parity/ports/WP-ENG-RUNTIME/identity-leases/provider-transition/`,
//!   ported as its two `source_case_*` tests.
//! - The record validators in `src/shared/agent-session-record.ts` — ported
//!   as the record model and validator tests plus their JSON fixture.
//!
//! NOT mapped here: the lease policy semantics of
//! `src/shared/agent-session-lease-adjudication.ts` and the pure transitions
//! of `src/main/runtime/agent-session-lease-transitions.ts` (reserve, commit,
//! prove, renew, evict, handoff, journal) are pending later dependency
//! slices; only `record_agent_session_provider_handle` from that area is in
//! scope for this slice.
//!
//! The module is a registered production module (`pub mod session_authority`
//! in `drogon-core`); these tests consume its public API like any external
//! caller.

use serde_json::{Value, json};

use drogon_core::session_authority::error::SessionAuthorityError;
use drogon_core::session_authority::provider_handle::{
    HandleOrigin, HandleProvider, ProviderHandle, ProviderHandleLink, append_link, chain_head,
    find_link, handle_key, handle_root, handles_equal, is_handle_chain_json, is_handle_field,
    is_handle_provider_value, js_json_quote, js_utf16_len,
};
use drogon_core::session_authority::record::{
    AgentSessionRecord, ClaimStatus, DeathEvidenceKind, ExecutionLocation, JournalCheckpoint,
    RecordReadError, WorkspaceKind, admit_persisted_record,
    agent_session_execution_locations_equal, agent_session_scope_key,
    is_agent_session_execution_location, is_agent_session_id, is_agent_session_launch_args,
    is_agent_session_launch_env, is_agent_session_lease, is_agent_session_process_identity,
    is_agent_session_record,
};
use drogon_core::session_authority::transition::record_agent_session_provider_handle;

fn claude_handle() -> ProviderHandle {
    ProviderHandle::Claude {
        session_id: "sess-1".to_string(),
        leaf_uuid: Some("leaf-1".to_string()),
    }
}

fn link(overrides: impl FnOnce(&mut ProviderHandleLink)) -> ProviderHandleLink {
    let mut built = ProviderHandleLink {
        link_id: "link-1".to_string(),
        handle: claude_handle(),
        origin: HandleOrigin::Created,
        minted_at_fence: 1,
        observed_at: 1_000,
        forked_from_key: None,
    };
    overrides(&mut built);
    built
}

fn err_code_vec(result: Result<Vec<ProviderHandleLink>, SessionAuthorityError>) -> &'static str {
    result.expect_err("expected an error").code()
}

// ---------------------------------------------------------------------------
// Fixture parity: the source test fixture
// (src/shared/agent-session-record.test-fixture.ts), verbatim as JSON.
// ---------------------------------------------------------------------------

fn owner_process_json() -> Value {
    json!({
        "hostId": "local",
        "pid": 4242,
        "processStartTimeMs": 1_700_000_000_000_i64,
        "spawnToken": "spawn-tui"
    })
}

fn lease_json(overrides: Value) -> Value {
    let mut lease = json!({
        "sessionId": "session-alpha-1",
        "runtimeKind": "tui",
        "runtimeFence": 7,
        "handoffStage": null,
        "provenHandleLinkId": "link-1",
        "ownerProcess": owner_process_json(),
        "reservedSpawnToken": "spawn-tui",
        "leaseDeadlineAt": 60_000,
        "lastRenewedAt": 30_000,
        "handoffOperationId": null,
        "journalCheckpoint": null,
        "claimKeyId": "key-1",
        "claimStatus": "live",
        "unreconciled": false,
        "deathEvidence": null
    });
    merge_json(&mut lease, overrides);
    lease
}

fn record_json(lease: Value) -> Value {
    json!({
        "schemaVersion": 2,
        "sessionId": "session-alpha-1",
        "location": {
            "executionHostId": "local",
            "wslDistro": null,
            "workspaceId": "workspace-1",
            "workspaceKind": "git-worktree"
        },
        "provider": "claude",
        "providerHandleChain": [{
            "linkId": "link-1",
            "origin": "created",
            "mintedAtFence": lease.get("runtimeFence").cloned().unwrap_or(json!(7)),
            "observedAt": 1_000,
            "handle": { "provider": "claude", "sessionId": "provider-session-alpha-1", "leafUuid": null }
        }],
        "accountHome": { "variable": "CLAUDE_CONFIG_DIR", "path": "/home/user/.claude" },
        "lease": lease,
        "createdAt": 1_000,
        "updatedAt": 2_000
    })
}

/// Shallow-merge `overrides` into `base` (JSON objects only; null removes by
/// overwriting — used only with object overrides in fixtures).
fn merge_json(base: &mut Value, overrides: Value) {
    if let (Some(base_map), Value::Object(overrides_map)) = (base.as_object_mut(), overrides) {
        for (key, value) in overrides_map {
            base_map.insert(key, value);
        }
    }
}

fn live_fixture_record() -> AgentSessionRecord {
    admit_persisted_record(&record_json(lease_json(json!({}))))
        .expect("source fixture record must admit")
}

fn resumed_link(fence: i64) -> ProviderHandleLink {
    ProviderHandleLink {
        link_id: "link-2".to_string(),
        handle: ProviderHandle::Claude {
            session_id: "provider-session-alpha-1".to_string(),
            leaf_uuid: Some("leaf-2".to_string()),
        },
        origin: HandleOrigin::Resumed,
        minted_at_fence: fence,
        observed_at: 4_000,
        forked_from_key: None,
    }
}

// ---------------------------------------------------------------------------
// Numeric extraction parity — Number.isSafeInteger over raw JSON spellings.
// Regression coverage for the root review findings: i64::MIN reached
// i64::abs (panic) and integral float/exponent spellings (1.0, 1e0) were
// rejected by Value::as_i64 although Node JSON.parse + isSafeInteger accept
// them. All inputs below go through serde_json::from_str on raw JSON text.
// ---------------------------------------------------------------------------

/// Serialize then re-parse through raw JSON text so numeric spellings are
/// exercised exactly as `serde_json` parses them from persisted bytes.
fn raw_round_trip(value: &Value) -> Value {
    let text = serde_json::to_string(value).expect("fixture serializes");
    serde_json::from_str(&text).expect("raw JSON parses")
}

/// Full valid record whose lease fields (and the matching link fence) are
/// replaced by `replacement`, round-tripped through raw JSON text.
fn raw_record_with_numeric(replacement: Value) -> Value {
    let lease = lease_json(json!({
        "runtimeFence": replacement.clone(),
        "leaseDeadlineAt": replacement.clone(),
        "lastRenewedAt": replacement.clone(),
        "ownerProcess": {
            "hostId": "host-1",
            "pid": replacement.clone(),
            "processStartTimeMs": replacement.clone(),
            "spawnToken": "token-1"
        },
        "deathEvidence": {
            "kind": "exit-observed",
            "detail": "done",
            "observedAt": replacement.clone()
        },
        "journalCheckpoint": { "epoch": replacement.clone(), "sequence": replacement },
        "claimStatus": "reserved"
    }));
    let fence = lease.get("runtimeFence").cloned().unwrap_or(json!(7));
    let mut record = record_json(lease);
    merge_json(
        record
            .get_mut("providerHandleChain")
            .and_then(Value::as_array_mut)
            .and_then(|chain| chain.first_mut())
            .expect("fixture chain has a head"),
        json!({ "mintedAtFence": fence, "observedAt": fence }),
    );
    raw_round_trip(&record)
}

#[test]
fn numeric_extraction_accepts_integral_float_spellings_from_raw_json() {
    // Node: Number.isSafeInteger(JSON.parse("1.0")) === true. Every persisted
    // numeric field in the slice must agree: fences, observedAt, lease
    // timestamps, owner process identity, journal checkpoint, death evidence.
    let raw = raw_record_with_numeric(json!(1.0));
    assert!(
        is_agent_session_record(&raw),
        "integral 1.0 spellings must admit like the source"
    );
    let admitted = admit_persisted_record(&raw).expect("1.0 record must admit");
    assert_eq!(admitted.lease.runtime_fence, 1);
    assert_eq!(admitted.provider_handle_chain[0].minted_at_fence, 1);
}

#[test]
fn numeric_extraction_accepts_exponent_spelling_from_raw_json() {
    // Node: Number.isSafeInteger(JSON.parse("1e0")) === true. Surgical raw
    // text replacement so the exponent spelling is genuinely parsed.
    // `mintedAtFence` is unique to the chain link; `leaseDeadlineAt` is a
    // lease-only key — both tokens appear exactly once in the fixture.
    let raw = raw_record_with_numeric(json!(7));
    let mut text = serde_json::to_string(&raw).expect("fixture serializes");
    let before = text.clone();
    text = text.replacen("\"mintedAtFence\":7", "\"mintedAtFence\":1e0", 1);
    text = text.replacen("\"leaseDeadlineAt\":7", "\"leaseDeadlineAt\":1e0", 1);
    assert_ne!(text, before, "fixture must contain the numeric tokens");
    let reparsed: Value = serde_json::from_str(&text).expect("1e0 raw JSON parses");
    assert!(
        is_agent_session_record(&reparsed),
        "exponent 1e0 spellings must admit like the source"
    );
    let admitted = admit_persisted_record(&reparsed).expect("1e0 record must admit");
    assert_eq!(admitted.lease.lease_deadline_at, 1);
    assert_eq!(admitted.provider_handle_chain[0].minted_at_fence, 1);
}

#[test]
fn numeric_extraction_rejects_fractions_unsafe_integers_and_i64_min_from_raw_json() {
    for (label, spelling) in [
        ("fraction", "1.5"),
        ("just over safe range", "9007199254740992"),
        ("huge exponent", "1e100"),
        ("i64 min", "-9223372036854775808"),
    ] {
        let raw = raw_record_with_numeric(json!(7));
        let mut text = serde_json::to_string(&raw).expect("fixture serializes");
        text = text.replacen(
            "\"runtimeFence\":7",
            &format!("\"runtimeFence\":{spelling}"),
            1,
        );
        let reparsed: Value =
            serde_json::from_str(&text).unwrap_or_else(|_| panic!("{label} raw JSON parses"));
        assert!(
            !is_agent_session_record(&reparsed),
            "{label} ({spelling}) must not validate"
        );
        assert!(
            matches!(
                admit_persisted_record(&reparsed),
                Err(RecordReadError::Invalid { .. })
            ),
            "{label} ({spelling}) must quarantine as invalid, not panic"
        );
    }
}

#[test]
fn numeric_extraction_accepts_exact_safe_integer_boundaries_from_raw_json() {
    for (label, spelling, expected) in [
        ("max safe", "9007199254740991", 9_007_199_254_740_991_i64),
        ("min safe", "-9007199254740991", -9_007_199_254_740_991_i64),
    ] {
        // leaseDeadlineAt is a lease-only key (appears exactly once) and, as a
        // plain safe-integer field, has no sign constraint — unlike the
        // nonnegative mintedAtFence.
        let raw = raw_record_with_numeric(json!(7));
        let mut text = serde_json::to_string(&raw).expect("fixture serializes");
        let before = text.clone();
        text = text.replacen(
            "\"leaseDeadlineAt\":7",
            &format!("\"leaseDeadlineAt\":{spelling}"),
            1,
        );
        assert_ne!(
            text, before,
            "{label}: fixture must contain the replacement token"
        );
        let reparsed: Value =
            serde_json::from_str(&text).unwrap_or_else(|_| panic!("{label} raw JSON parses"));
        let admitted = admit_persisted_record(&reparsed)
            .unwrap_or_else(|_| panic!("{label} ({spelling}) must admit"));
        assert_eq!(admitted.lease.lease_deadline_at, expected);
    }
}

#[test]
fn typed_link_validation_rejects_i64_min_without_panic() {
    // A typed link constructed in memory (as later-slice transitions do) with
    // minted_at_fence = i64::MIN must be rejected, not panic i64::abs.
    let bad = link(|l| l.minted_at_fence = i64::MIN);
    assert!(!bad.is_valid());
    let chain = vec![link(|_| {})];
    assert!(append_link(&chain, &bad).is_err());
    assert_eq!(chain.len(), 1, "refused append must leave the chain intact");
}

// ---------------------------------------------------------------------------
// source_case_handle_identity_* — port of describe('handle identity').
// ---------------------------------------------------------------------------

#[test]
fn source_case_handle_identity_rejects_unknown_provider_names() {
    // isAgentSessionHandleProvider: gemini must not impersonate Codex.
    assert!(is_handle_provider_value(&json!("codex")));
    assert!(is_handle_provider_value(&json!("claude")));
    assert!(!is_handle_provider_value(&json!("gemini")));
    assert!(!is_handle_provider_value(&json!(null)));
    // JSON has no `undefined`; any non-string persisted value is equally rejected.
    assert!(!is_handle_provider_value(&json!({"provider": "codex"})));
}

#[test]
fn source_case_handle_identity_claude_key_uses_session_and_leaf() {
    // Concurrent resumes branch one transcript silently; the session id alone
    // cannot name a writer.
    let branch_b = ProviderHandle::Claude {
        session_id: "sess-1".to_string(),
        leaf_uuid: Some("leaf-2".to_string()),
    };
    assert_ne!(handle_key(&claude_handle()), handle_key(&branch_b));
    assert_eq!(handle_root(&claude_handle()), handle_root(&branch_b));
}

#[test]
fn source_case_handle_identity_codex_key_uses_thread_alone() {
    let codex = ProviderHandle::Codex {
        thread_id: "thread-1".to_string(),
    };
    assert_eq!(handle_key(&codex), "codex:\"thread-1\"");
    assert_eq!(handle_root(&codex), "codex:\"thread-1\"");
    let other = ProviderHandle::Codex {
        thread_id: "thread-2".to_string(),
    };
    assert!(!handles_equal(&codex, &other));
}

#[test]
fn source_case_handle_identity_null_leaf_vs_empty_and_malformed() {
    let null_leaf = ProviderHandle::Claude {
        session_id: "sess-1".to_string(),
        leaf_uuid: None,
    };
    assert!(ProviderHandle::from_json(&null_leaf.to_json()).is_some());
    let empty_leaf = ProviderHandle::Claude {
        session_id: "sess-1".to_string(),
        leaf_uuid: Some(String::new()),
    };
    assert!(ProviderHandle::from_json(&empty_leaf.to_json()).is_none());
    assert!(ProviderHandle::from_json(&json!({"provider": "claude", "sessionId": ""})).is_none());
    assert!(ProviderHandle::from_json(&json!({"provider": "gemini", "sessionId": "x"})).is_none());
    assert!(
        ProviderHandle::from_json(
            &json!({"provider": "claude", "sessionId": " sess-1 ", "leafUuid": "leaf-1"})
        )
        .is_none()
    );
}

#[test]
fn source_case_handle_identity_collision_free_keys_with_delimiters() {
    let left = ProviderHandle::Claude {
        session_id: "a#b".to_string(),
        leaf_uuid: Some("c".to_string()),
    };
    let right = ProviderHandle::Claude {
        session_id: "a".to_string(),
        leaf_uuid: Some("b#c".to_string()),
    };
    assert_ne!(handle_key(&left), handle_key(&right));
    assert!(!handles_equal(&left, &right));
}

// ---------------------------------------------------------------------------
// source_case_chain_append_* — port of describe('chain append').
// ---------------------------------------------------------------------------

#[test]
fn source_case_chain_append_starts_only_created_or_adopted() {
    assert_eq!(
        append_link(&[], &link(|_| {})).expect("created"),
        [link(|_| {})]
    );
    assert_eq!(
        append_link(&[], &link(|l| l.origin = HandleOrigin::Adopted))
            .expect("adopted")
            .len(),
        1
    );
    assert_eq!(
        err_code_vec(append_link(
            &[],
            &link(|l| l.origin = HandleOrigin::Resumed)
        )),
        SessionAuthorityError::ProviderHandleInvalid.code()
    );
}

#[test]
fn source_case_chain_append_refuses_fork_recorded_as_resume() {
    // --fork-session keeps the original item ids; calling it a resume would
    // claim continuity the provider never gave.
    let chain = vec![link(|_| {})];
    let resumed = link(|link| {
        link.link_id = "link-2".to_string();
        link.origin = HandleOrigin::Resumed;
        link.handle = ProviderHandle::Claude {
            session_id: "sess-2".to_string(),
            leaf_uuid: Some("leaf-9".to_string()),
        };
        link.minted_at_fence = 2;
    });
    assert_eq!(
        err_code_vec(append_link(&chain, &resumed)),
        SessionAuthorityError::ProviderHandleForked.code()
    );
}

#[test]
fn source_case_chain_append_records_fork_only_with_new_root_and_seed() {
    let chain = vec![link(|_| {})];
    let seed_key = handle_key(&claude_handle());
    let forked = link(|link| {
        link.link_id = "link-2".to_string();
        link.origin = HandleOrigin::Forked;
        link.handle = ProviderHandle::Claude {
            session_id: "sess-2".to_string(),
            leaf_uuid: Some("leaf-9".to_string()),
        };
        link.minted_at_fence = 2;
        link.forked_from_key = Some(seed_key.clone());
    });
    assert_eq!(append_link(&chain, &forked).expect("fork").len(), 2);
    let wrong_seed = link(|link| {
        link.link_id = "link-2".to_string();
        link.origin = HandleOrigin::Forked;
        link.handle = ProviderHandle::Claude {
            session_id: "sess-2".to_string(),
            leaf_uuid: Some("leaf-9".to_string()),
        };
        link.minted_at_fence = 2;
        link.forked_from_key = Some("claude:other".to_string());
    });
    assert_eq!(
        err_code_vec(append_link(&chain, &wrong_seed)),
        SessionAuthorityError::ProviderHandleInvalid.code()
    );
    let same_root_fork = link(|link| {
        link.link_id = "link-2".to_string();
        link.origin = HandleOrigin::Forked;
        link.handle = claude_handle();
        link.minted_at_fence = 2;
        link.forked_from_key = Some(seed_key);
    });
    assert_eq!(
        err_code_vec(append_link(&chain, &same_root_fork)),
        SessionAuthorityError::ProviderHandleInvalid.code()
    );
}

#[test]
fn source_case_chain_append_rejects_link_minted_under_older_fence() {
    let chain = vec![link(|link| link.minted_at_fence = 5)];
    let stale = link(|link| {
        link.link_id = "link-2".to_string();
        link.origin = HandleOrigin::Resumed;
        link.handle = ProviderHandle::Claude {
            session_id: "sess-1".to_string(),
            leaf_uuid: Some("leaf-2".to_string()),
        };
        link.minted_at_fence = 4;
    });
    assert_eq!(
        err_code_vec(append_link(&chain, &stale)),
        SessionAuthorityError::ProviderHandleStaleFence.code()
    );
}

#[test]
fn source_case_chain_append_rejects_provider_change_mid_chain() {
    let changed = link(|link| {
        link.link_id = "link-2".to_string();
        link.origin = HandleOrigin::Resumed;
        link.handle = ProviderHandle::Codex {
            thread_id: "thread-1".to_string(),
        };
        link.minted_at_fence = 2;
    });
    assert_eq!(
        err_code_vec(append_link(&[link(|_| {})], &changed)),
        SessionAuthorityError::ProviderHandleProviderMismatch.code()
    );
}

#[test]
fn source_case_chain_append_same_handle_same_fence_is_retry_not_new_link() {
    let chain = vec![link(|link| link.minted_at_fence = 3)];
    let retried = append_link(
        &chain,
        &link(|link| {
            link.link_id = "link-2".to_string();
            link.origin = HandleOrigin::Resumed;
            link.minted_at_fence = 3;
        }),
    )
    .expect("retry elides");
    assert_eq!(retried.len(), 1);
    assert_eq!(retried[0].link_id, "link-1");
    // A later fence on the same handle is a genuine re-acquisition and appends.
    assert_eq!(
        append_link(
            &chain,
            &link(|link| {
                link.link_id = "link-2".to_string();
                link.origin = HandleOrigin::Resumed;
                link.minted_at_fence = 4;
            })
        )
        .expect("re-acquisition appends")
        .len(),
        2
    );
}

#[test]
fn source_case_chain_append_rejects_stable_link_id_reuse() {
    let reused = link(|link| {
        link.origin = HandleOrigin::Resumed;
        link.handle = ProviderHandle::Claude {
            session_id: "sess-1".to_string(),
            leaf_uuid: Some("leaf-2".to_string()),
        };
        link.minted_at_fence = 2;
    });
    assert_eq!(
        err_code_vec(append_link(&[link(|_| {})], &reused)),
        SessionAuthorityError::ProviderHandleInvalid.code()
    );
}

#[test]
fn source_case_chain_append_refuses_growth_past_cap() {
    let mut chain = vec![link(|_| {})];
    for index in 1..256 {
        chain.push(link(|link| {
            link.link_id = format!("link-{}", index + 1);
            link.origin = HandleOrigin::Resumed;
            link.handle = ProviderHandle::Claude {
                session_id: "sess-1".to_string(),
                leaf_uuid: Some(format!("leaf-{}", index + 1)),
            };
            link.minted_at_fence = (index + 1) as i64;
        }));
    }
    assert_eq!(chain.len(), 256);
    let overflow = link(|link| {
        link.link_id = "link-overflow".to_string();
        link.origin = HandleOrigin::Resumed;
        link.handle = ProviderHandle::Claude {
            session_id: "sess-1".to_string(),
            leaf_uuid: Some("leaf-overflow".to_string()),
        };
        link.minted_at_fence = 999;
    });
    assert_eq!(
        err_code_vec(append_link(&chain, &overflow)),
        SessionAuthorityError::ProviderHandleChainOverflow.code()
    );
    // Refusal, never truncation: the chain still validates and the head is intact.
    assert!(is_handle_chain_json(&json!(
        chain.iter().map(|l| l.to_json()).collect::<Vec<_>>()
    )));
    assert_eq!(chain_head(&chain).expect("head").link_id, "link-256");
}

#[test]
fn source_case_chain_append_never_mutates_input_chain() {
    let chain = vec![link(|_| {})];
    append_link(
        &chain,
        &link(|link| {
            link.link_id = "link-2".to_string();
            link.origin = HandleOrigin::Resumed;
            link.handle = ProviderHandle::Claude {
                session_id: "sess-1".to_string(),
                leaf_uuid: Some("leaf-2".to_string()),
            };
            link.minted_at_fence = 2;
        }),
    )
    .expect("append succeeds");
    assert_eq!(chain.len(), 1);
}

// ---------------------------------------------------------------------------
// source_case_chain_validation_* — port of describe('chain lookup and validation').
// ---------------------------------------------------------------------------

#[test]
fn source_case_chain_validation_finds_link_and_reports_head() {
    let chain = append_link(
        &[link(|_| {})],
        &link(|link| {
            link.link_id = "link-2".to_string();
            link.origin = HandleOrigin::Resumed;
            link.handle = ProviderHandle::Claude {
                session_id: "sess-1".to_string(),
                leaf_uuid: Some("leaf-2".to_string()),
            };
            link.minted_at_fence = 2;
        }),
    )
    .expect("append");
    assert_eq!(
        find_link(&chain, "link-1").expect("found").origin,
        HandleOrigin::Created
    );
    assert!(find_link(&chain, "missing").is_none());
    assert_eq!(chain_head(&chain).expect("head").link_id, "link-2");
    assert!(chain_head(&[]).is_none());
}

#[test]
fn source_case_chain_validation_rejects_over_cap_or_malformed_persisted_chain() {
    let mut negative_fence = link(|_| {}).to_json();
    negative_fence["mintedAtFence"] = json!(-1);
    assert!(!is_handle_chain_json(&json!([negative_fence])));

    let mut bad_link_id = link(|_| {}).to_json();
    bad_link_id["linkId"] = json!("not a link id!");
    assert!(!is_handle_chain_json(&json!([bad_link_id])));

    let mut stray_seed = link(|_| {}).to_json();
    stray_seed["forkedFromKey"] = json!("claude:seed");
    assert!(!is_handle_chain_json(&json!([stray_seed])));

    let over_cap: Vec<Value> = (0..257)
        .map(|index| link(|link| link.link_id = format!("link-{index}")).to_json())
        .collect();
    assert!(!is_handle_chain_json(&json!(over_cap)));
}

#[test]
fn source_case_chain_validation_rejects_persisted_chains_bypassing_append() {
    // A second 'created' link violates the append invariants.
    let second_created = vec![
        link(|_| {}).to_json(),
        link(|link| {
            link.link_id = "link-2".to_string();
            link.origin = HandleOrigin::Created;
            link.minted_at_fence = 2;
        })
        .to_json(),
    ];
    assert!(!is_handle_chain_json(&json!(second_created)));

    // A missing linkId is malformed.
    let mut missing_id = link(|link| {
        link.origin = HandleOrigin::Resumed;
        link.handle = ProviderHandle::Claude {
            session_id: "sess-1".to_string(),
            leaf_uuid: Some("leaf-2".to_string()),
        };
        link.minted_at_fence = 2;
    })
    .to_json();
    missing_id.as_object_mut().expect("object").remove("linkId");
    assert!(!is_handle_chain_json(&json!([
        link(|_| {}).to_json(),
        missing_id
    ])));

    // A resume that changed the identity root is a fork, not a resume.
    let changed_root = vec![
        link(|_| {}).to_json(),
        link(|link| {
            link.link_id = "link-2".to_string();
            link.origin = HandleOrigin::Resumed;
            link.handle = ProviderHandle::Claude {
                session_id: "sess-2".to_string(),
                leaf_uuid: Some("leaf-2".to_string()),
            };
            link.minted_at_fence = 2;
        })
        .to_json(),
    ];
    assert!(!is_handle_chain_json(&json!(changed_root)));
}

// ---------------------------------------------------------------------------
// source_case_transition_* — port of the 2 admitted provider-handle-transition
// cases (4 assertion evaluations), frozen byte-identical under
// tests/parity/ports/WP-ENG-RUNTIME/identity-leases/provider-transition/.
// ---------------------------------------------------------------------------

#[test]
fn source_case_transition_advances_live_claude_chain_head_and_proof() {
    let record = live_fixture_record();
    let next = record_agent_session_provider_handle(
        &record,
        record.lease.runtime_fence,
        &resumed_link(record.lease.runtime_fence),
        4_000,
    )
    .expect("live record accepts a new leaf");
    assert_eq!(
        chain_head(&next.provider_handle_chain)
            .expect("head")
            .handle,
        resumed_link(record.lease.runtime_fence).handle
    );
    assert_eq!(next.lease.proven_handle_link_id.as_deref(), Some("link-2"));
}

#[test]
fn source_case_transition_records_leaf_during_proof_without_granting_ownership() {
    let proving_lease = lease_json(json!({
        "runtimeFence": 8,
        "claimStatus": "reserved",
        "handoffStage": "new-owner-proving",
        "provenHandleLinkId": null,
        "ownerProcess": null
    }));
    let record =
        admit_persisted_record(&record_json(proving_lease)).expect("proving fixture admits");
    let next = record_agent_session_provider_handle(
        &record,
        record.lease.runtime_fence,
        &resumed_link(record.lease.runtime_fence),
        4_000,
    )
    .expect("proving record accepts a new leaf");
    assert_eq!(
        chain_head(&next.provider_handle_chain)
            .expect("head")
            .handle,
        resumed_link(8).handle
    );
    assert_eq!(next.lease.claim_status, ClaimStatus::Reserved);
    assert_eq!(next.lease.proven_handle_link_id, None);
}

// ---------------------------------------------------------------------------
// JSON.stringify escaping vectors captured from the pinned Node 24 runtime
// (source behavior, not a reimplementation).
// ---------------------------------------------------------------------------

#[test]
fn js_json_quote_matches_pinned_node_escaping() {
    assert_eq!(js_json_quote("\u{0}"), "\"\\u0000\"");
    assert_eq!(js_json_quote("\u{1}"), "\"\\u0001\"");
    assert_eq!(js_json_quote("\u{8}"), "\"\\b\"");
    assert_eq!(js_json_quote("\u{c}"), "\"\\f\"");
    assert_eq!(js_json_quote("\n"), "\"\\n\"");
    assert_eq!(js_json_quote("\r"), "\"\\r\"");
    assert_eq!(js_json_quote("\t"), "\"\\t\"");
    assert_eq!(js_json_quote("\u{1f}"), "\"\\u001f\"");
    // DEL, U+2028/U+2029, non-ASCII and surrogate pairs pass through verbatim.
    assert_eq!(js_json_quote("\u{7f}"), "\"\u{7f}\"");
    assert_eq!(js_json_quote("\u{2028}"), "\"\u{2028}\"");
    assert_eq!(js_json_quote("é"), "\"é\"");
    assert_eq!(js_json_quote("😀"), "\"😀\"");
    assert_eq!(js_json_quote("quote\"x"), "\"quote\\\"x\"");
    assert_eq!(js_json_quote("back\\slash"), "\"back\\\\slash\"");
}

#[test]
fn handle_keys_embed_exact_node_json_for_tricky_ids() {
    assert_eq!(
        handle_key(&claude_handle()),
        "claude:[\"sess-1\",\"leaf-1\"]"
    );
    assert_eq!(
        handle_root(&ProviderHandle::Claude {
            session_id: "sess-1".to_string(),
            leaf_uuid: Some("leaf-1".to_string()),
        }),
        "claude:\"sess-1\""
    );
    let null_leaf = ProviderHandle::Claude {
        session_id: "sess-1".to_string(),
        leaf_uuid: None,
    };
    assert_eq!(handle_key(&null_leaf), "claude:[\"sess-1\",null]");
    let nul_id = ProviderHandle::Claude {
        session_id: "a\u{0}b".to_string(),
        leaf_uuid: None,
    };
    assert_eq!(handle_key(&nul_id), "claude:[\"a\\u0000b\",null]");
    let quoted = ProviderHandle::Claude {
        session_id: "q\"w".to_string(),
        leaf_uuid: Some("e\\f".to_string()),
    };
    assert_eq!(handle_key(&quoted), "claude:[\"q\\\"w\",\"e\\\\f\"]");
}

#[test]
fn js_utf16_len_counts_code_units_like_javascript() {
    assert_eq!(js_utf16_len("😀"), 2);
    assert_eq!(js_utf16_len("é"), 1);
    assert_eq!(js_utf16_len("ab😀cd"), 6);
    assert_eq!(js_utf16_len("😀😀"), 4);
    assert_eq!(js_utf16_len(&"x".repeat(512)), 512);
}

#[test]
fn handle_field_bounds_are_utf16_and_trim_checked() {
    assert!(is_handle_field(&"x".repeat(512)));
    assert!(!is_handle_field(&"x".repeat(513)));
    // 256 emoji = 512 UTF-16 units: valid; 257 emoji: over the bound.
    assert!(is_handle_field(&"😀".repeat(256)));
    assert!(!is_handle_field(&"😀".repeat(257)));
    assert!(!is_handle_field(""));
    assert!(!is_handle_field(" padded"));
    assert!(!is_handle_field("padded "));
    // JavaScript trim removes NBSP; so does the port.
    assert!(!is_handle_field("\u{a0}x\u{a0}"));
}

#[test]
fn handle_field_trim_matches_javascript_whitespace_set() {
    // ECMAScript WhiteSpace + LineTerminator boundary cases. A value whose
    // only "padding" is U+FEFF must be rejected exactly like the source,
    // because JS trim strips it and `value === value.trim()` then fails.
    for padding in [
        '\u{feff}', // ZWNBSP — trimmed by JS, NOT by Rust's char::is_whitespace
        '\u{2028}', // line separator
        '\u{2029}', // paragraph separator
        '\u{1680}', // ogham space mark
        '\u{2000}', // en quad
        '\u{205f}', // medium mathematical space
        '\u{3000}', // ideographic space
        '\u{b}',    // vertical tab
        '\u{c}',    // form feed
        '\t', '\n', '\r', ' ',
    ] {
        let padded = format!("{padding}field{padding}");
        assert!(
            !is_handle_field(&padded),
            "U+{:04x} must trim",
            padding as u32
        );
        // Inner occurrences never trim, so they stay valid at the bound.
        let inner = format!("a{padding}b");
        assert!(
            is_handle_field(&inner),
            "inner U+{:04x} stays valid",
            padding as u32
        );
    }
    // A value consisting solely of JS whitespace is empty after trim: invalid.
    assert!(!is_handle_field("\u{feff}"));
    assert!(!is_handle_field(" \t\u{2028}"));
}

#[test]
fn handle_field_trim_set_is_exact_ecmascript_allowlist() {
    // `is_js_trim_whitespace` is an explicit allow-list, NOT
    // `char::is_whitespace`. Every positive and negative below was verified
    // against the pinned Node 24 runtime by
    // node-vectors/trim-vectors.mjs (capture: trim-vectors.out.json).
    //
    // The complete ECMAScript WhiteSpace + LineTerminator set must trim:
    const TRIMMED: [char; 25] = [
        '\u{0009}', '\u{000B}', '\u{000C}', '\u{0020}', '\u{00A0}', '\u{1680}', '\u{2000}',
        '\u{2001}', '\u{2002}', '\u{2003}', '\u{2004}', '\u{2005}', '\u{2006}', '\u{2007}',
        '\u{2008}', '\u{2009}', '\u{200A}', '\u{202F}', '\u{205F}', '\u{3000}', '\u{FEFF}',
        '\u{000A}', '\u{000D}', '\u{2028}', '\u{2029}',
    ];
    for &padding in &TRIMMED {
        let padded = format!("{padding}field{padding}");
        assert!(
            !is_handle_field(&padded),
            "U+{:04X} must be trimmed by the ECMAScript set",
            padding as u32
        );
        assert!(
            is_handle_field(&format!("a{padding}b")),
            "inner U+{:04X} stays valid",
            padding as u32
        );
    }
    // Rust `char::is_whitespace` reports these as whitespace but ECMAScript
    // `trim` does NOT remove them — a field padded with them stays valid.
    // U+0085 NEL is the case that made `is_whitespace` unusable directly.
    for non_trimmed in ['\u{0085}', '\u{180E}', '\u{200B}', '\u{2060}'] {
        let padded = format!("{non_trimmed}field{non_trimmed}");
        assert!(
            is_handle_field(&padded),
            "U+{:04X} must NOT be trimmed by ECMAScript trim",
            non_trimmed as u32
        );
    }
    // Control characters that are in neither set must not trim either.
    for non_trimmed in ['\u{0000}', '\u{0001}', '\u{0008}', '\u{001F}', '\u{007F}'] {
        let padded = format!("{non_trimmed}field{non_trimmed}");
        assert!(
            is_handle_field(&padded),
            "U+{:04X} must NOT be trimmed",
            non_trimmed as u32
        );
    }
}

#[test]
fn agent_session_id_pattern_matches_source() {
    assert!(is_agent_session_id("session-alpha-1"));
    assert!(is_agent_session_id("abcd1234"));
    assert!(is_agent_session_id(&"a".repeat(128)));
    assert!(!is_agent_session_id("short-1"));
    assert!(!is_agent_session_id(&"a".repeat(129)));
    assert!(!is_agent_session_id("with space!"));
    assert!(!is_agent_session_id("with.dot"));
    assert!(!is_agent_session_id("with#hash"));
}

// ---------------------------------------------------------------------------
// Record model: location, scope key, process identity, options, launch env,
// launch args — port of the validators in src/shared/agent-session-record.ts.
// ---------------------------------------------------------------------------

fn location_json(overrides: Value) -> Value {
    let mut location = json!({
        "executionHostId": "local",
        "wslDistro": null,
        "workspaceId": "workspace-1",
        "workspaceKind": "git-worktree"
    });
    merge_json(&mut location, overrides);
    location
}

#[test]
fn scope_key_joins_host_distro_workspace_with_nul_separator() {
    let scope = |overrides: Value| {
        let location = location_json(overrides);
        agent_session_scope_key(&ExecutionLocation {
            execution_host_id: location["executionHostId"].as_str().unwrap().to_string(),
            wsl_distro: location["wslDistro"].as_str().map(str::to_string),
            workspace_id: location["workspaceId"].as_str().unwrap().to_string(),
            workspace_kind: WorkspaceKind::from_str_opt(
                location["workspaceKind"].as_str().unwrap(),
            )
            .unwrap(),
        })
    };
    assert_eq!(scope(json!({})), "local\u{0}\u{0}workspace-1");
    assert_eq!(
        scope(json!({"wslDistro": "Ubuntu"})),
        "local\u{0}Ubuntu\u{0}workspace-1"
    );
    // NUL cannot occur in a component, so no component can forge a join.
    assert_ne!(
        scope(json!({"executionHostId": "lo", "workspaceId": "cal"})),
        scope(json!({"executionHostId": "local"}))
    );
}

#[test]
fn execution_location_equality_includes_workspace_kind() {
    let location = |kind: &str| ExecutionLocation {
        execution_host_id: "local".to_string(),
        wsl_distro: None,
        workspace_id: "workspace-1".to_string(),
        workspace_kind: WorkspaceKind::from_str_opt(kind).unwrap(),
    };
    assert!(agent_session_execution_locations_equal(
        &location("git-worktree"),
        &location("git-worktree")
    ));
    assert!(!agent_session_execution_locations_equal(
        &location("git-worktree"),
        &location("folder")
    ));
}

#[test]
fn execution_location_validator_enforces_shape() {
    assert!(is_agent_session_execution_location(&location_json(json!(
        {}
    ))));
    assert!(!is_agent_session_execution_location(&location_json(
        json!({"executionHostId": ""})
    )));
    assert!(!is_agent_session_execution_location(&location_json(
        json!({"wslDistro": 42})
    )));
    assert!(!is_agent_session_execution_location(&location_json(
        json!({"workspaceKind": "repo"})
    )));
    assert!(!is_agent_session_execution_location(&json!(null)));
}

#[test]
fn process_identity_validator_enforces_pid_and_spawn_token() {
    assert!(is_agent_session_process_identity(&owner_process_json()));
    assert!(!is_agent_session_process_identity(
        &json!({"hostId": "local", "pid": 0, "processStartTimeMs": null, "spawnToken": "t"})
    ));
    assert!(!is_agent_session_process_identity(
        &json!({"hostId": "local", "pid": -1, "processStartTimeMs": null, "spawnToken": "t"})
    ));
    assert!(!is_agent_session_process_identity(
        &json!({"hostId": "local", "pid": 1.5, "processStartTimeMs": null, "spawnToken": "t"})
    ));
    assert!(!is_agent_session_process_identity(
        &json!({"hostId": "local", "pid": 42, "processStartTimeMs": -1, "spawnToken": "t"})
    ));
    // processStartTimeMs may be null; spawnToken must be a nonempty bounded string.
    assert!(is_agent_session_process_identity(
        &json!({"hostId": "local", "pid": 42, "processStartTimeMs": null, "spawnToken": "t"})
    ));
    assert!(!is_agent_session_process_identity(
        &json!({"hostId": "local", "pid": 42, "processStartTimeMs": 1, "spawnToken": ""})
    ));
}

#[test]
fn launch_env_bounds_match_source() {
    let env = |entries: usize, value: &str| -> Value {
        let mut map = serde_json::Map::new();
        for index in 0..entries {
            map.insert(format!("KEY_{index}"), json!(value));
        }
        Value::Object(map)
    };
    assert!(is_agent_session_launch_env(&env(256, "v")));
    assert!(!is_agent_session_launch_env(&env(257, "v")));
    assert!(is_agent_session_launch_env(&env(1, "")));
    assert!(is_agent_session_launch_env(&env(1, &"x".repeat(65_536))));
    assert!(!is_agent_session_launch_env(&env(1, &"x".repeat(65_537))));
    assert!(!is_agent_session_launch_env(&json!([])));
    assert!(!is_agent_session_launch_env(&json!({"": "v"})));
}

#[test]
fn launch_args_bounds_match_source_json_byte_length() {
    let args = |values: Vec<String>| -> Value { json!(values) };
    assert!(is_agent_session_launch_args(&args(vec![])));
    assert!(is_agent_session_launch_args(&args(vec![
        "a".to_string();
        256
    ])));
    assert!(!is_agent_session_launch_args(&args(vec![
        "a".to_string();
        257
    ])));
    // Byte length of JSON.stringify(value) <= 16 KiB: one 16380-char argument is
    // exactly 16384 bytes; one more overflows.
    assert!(is_agent_session_launch_args(&args(vec![
        "x".repeat(16_380)
    ])));
    assert!(!is_agent_session_launch_args(&args(vec![
        "x".repeat(16_381)
    ])));
    assert!(!is_agent_session_launch_args(&args(vec![
        "bad\0arg".to_string()
    ])));
    // Multibyte characters count as UTF-8 bytes, exactly like Buffer.byteLength.
    assert!(is_agent_session_launch_args(&args(vec!["é".repeat(8_190)])));
    assert!(!is_agent_session_launch_args(&args(vec![
        "é".repeat(8_191)
    ])));
}

#[test]
fn lease_validator_enforces_null_vs_absent_matrix() {
    assert!(is_agent_session_lease(&lease_json(json!({}))));
    // handoffStage must be present (null or a known stage); absent is invalid.
    let mut absent_stage = lease_json(json!({}));
    absent_stage.as_object_mut().unwrap().remove("handoffStage");
    assert!(!is_agent_session_lease(&absent_stage));
    // settlementRetryRequired accepts absent or boolean — null is invalid.
    assert!(is_agent_session_lease(&lease_json(
        json!({"settlementRetryRequired": true})
    )));
    assert!(!is_agent_session_lease(&lease_json(
        json!({"settlementRetryRequired": null})
    )));
    // processlessAt accepts null and absent.
    assert!(is_agent_session_lease(&lease_json(
        json!({"processlessAt": null})
    )));
    assert!(is_agent_session_lease(&lease_json(
        json!({"processlessAt": 42})
    )));
    assert!(!is_agent_session_lease(&lease_json(
        json!({"processlessAt": -1})
    )));
    // minimumNextFence is not validated by the source lease validator at all.
    assert!(is_agent_session_lease(&lease_json(
        json!({"minimumNextFence": "garbage"})
    )));
    assert!(is_agent_session_lease(&lease_json(
        json!({"minimumNextFence": 12})
    )));
    // claimStatus / runtimeKind discriminants.
    assert!(!is_agent_session_lease(&lease_json(
        json!({"claimStatus": "dead"})
    )));
    assert!(!is_agent_session_lease(&lease_json(
        json!({"runtimeKind": "daemon"})
    )));
    // provenHandleLinkId null or bounded string.
    assert!(!is_agent_session_lease(&lease_json(
        json!({"provenHandleLinkId": ""})
    )));
    assert!(is_agent_session_lease(&lease_json(
        json!({"provenHandleLinkId": "link-1"})
    )));
    // sessionId pattern applies to the lease too.
    assert!(!is_agent_session_lease(&lease_json(
        json!({"sessionId": "short"})
    )));
}

#[test]
fn record_validator_enforces_live_invariants_and_field_matrix() {
    assert!(is_agent_session_record(&record_json(lease_json(json!({})))));
    // lease.sessionId must equal record.sessionId.
    assert!(!is_agent_session_record(&record_json(lease_json(
        json!({"sessionId": "session-other"})
    ))));
    // Every chain link must match the record provider.
    let mut codex_link_record = record_json(lease_json(json!({})));
    codex_link_record["providerHandleChain"][0]["handle"] =
        json!({"provider": "codex", "threadId": "thread-1"});
    assert!(!is_agent_session_record(&codex_link_record));
    // launchEnv has no place on a schema-v2 record — its presence is refused.
    let mut with_env = record_json(lease_json(json!({})));
    with_env["launchEnv"] = json!({"A": "B"});
    assert!(!is_agent_session_record(&with_env));
    // options: absent ok, valid ok, invalid refused.
    let mut with_options = record_json(lease_json(json!({})));
    with_options["options"] = json!({"model": "opus"});
    assert!(is_agent_session_record(&with_options));
    let mut bad_options = record_json(lease_json(json!({})));
    bad_options["options"] = json!({"": "x"});
    assert!(!is_agent_session_record(&bad_options));
    let mut many_options = record_json(lease_json(json!({})));
    let options_map: serde_json::Map<String, Value> = (0..33)
        .map(|index| (format!("k{index}"), json!("v")))
        .collect();
    many_options["options"] = Value::Object(options_map);
    assert!(!is_agent_session_record(&many_options));
    // launchArgs: absent ok, invalid refused.
    let mut with_args = record_json(lease_json(json!({})));
    with_args["launchArgs"] = json!(["--resume"]);
    assert!(is_agent_session_record(&with_args));
    let mut bad_args = record_json(lease_json(json!({})));
    bad_args["launchArgs"] = json!(["ok", 7]);
    assert!(!is_agent_session_record(&bad_args));
}

#[test]
fn record_validator_live_claim_requires_owner_proof_at_current_fence() {
    // live without ownerProcess is invalid.
    let no_owner = record_json(lease_json(json!({"ownerProcess": null})));
    assert!(!is_agent_session_record(&no_owner));
    // live with a proven link that is not the head is invalid.
    let wrong_proof = record_json(lease_json(json!({"provenHandleLinkId": "link-zzz"})));
    assert!(!is_agent_session_record(&wrong_proof));
    // live whose head was minted under another fence is invalid.
    let mut stale_head = record_json(lease_json(json!({})));
    stale_head["providerHandleChain"][0]["mintedAtFence"] = json!(3);
    assert!(!is_agent_session_record(&stale_head));
    // reserved is not held to the live invariants.
    let reserved = record_json(lease_json(json!({
        "claimStatus": "reserved",
        "handoffStage": "new-owner-proving",
        "provenHandleLinkId": null,
        "ownerProcess": null
    })));
    assert!(is_agent_session_record(&reserved));
}

#[test]
fn account_home_variable_discriminant_is_exact() {
    let mut bad_variable = record_json(lease_json(json!({})));
    bad_variable["accountHome"] = json!({"variable": "HOME", "path": "/home/user"});
    assert!(!is_agent_session_record(&bad_variable));
    let codex_home = record_json(lease_json(json!({})));
    // The account home must still match nothing else — variable is the only
    // enum there; path bounds: 4096 UTF-16 units max.
    let mut long_path = record_json(lease_json(json!({})));
    long_path["accountHome"]["path"] = json!("x".repeat(4097));
    assert!(!is_agent_session_record(&long_path));
    let mut max_path = record_json(lease_json(json!({})));
    max_path["accountHome"]["path"] = json!("x".repeat(4096));
    assert!(is_agent_session_record(&max_path));
    assert!(is_agent_session_record(&codex_home));
}

// ---------------------------------------------------------------------------
// Persisted admission: unknown versions quarantined, never rewritten.
// ---------------------------------------------------------------------------

#[test]
fn admit_persisted_record_rejects_unknown_version_without_rewriting() {
    let unsupported = {
        let mut record = record_json(lease_json(json!({})));
        record["schemaVersion"] = json!(1);
        record
    };
    let error = admit_persisted_record(&unsupported).expect_err("schema v1 must be quarantined");
    match &error {
        RecordReadError::UnsupportedSchema { raw } => {
            assert_eq!(raw["schemaVersion"], json!(1));
            // The quarantine keeps the raw bytes it was given.
            assert_eq!(raw, &unsupported);
        }
        RecordReadError::Invalid { .. } => panic!("expected UnsupportedSchema, got {error:?}"),
    }
    assert_eq!(error.reason(), "unsupported_schema");
}

#[test]
fn admit_persisted_record_rejects_invalid_v2_without_rewriting() {
    let invalid = record_json(lease_json(json!({"claimStatus": "nonsense"})));
    let error = admit_persisted_record(&invalid).expect_err("invalid v2 must be quarantined");
    match &error {
        RecordReadError::Invalid { raw } => assert_eq!(raw, &invalid),
        RecordReadError::UnsupportedSchema { .. } => panic!("expected Invalid, got {error:?}"),
    }
    assert_eq!(error.reason(), "invalid_record");
}

#[test]
fn admit_persisted_record_non_record_values_are_invalid_not_unsupported() {
    assert!(matches!(
        admit_persisted_record(&json!(42)),
        Err(RecordReadError::Invalid { .. })
    ));
    // A JSON null has no version; it is corrupt data, not an upgradeable record.
    assert!(matches!(
        admit_persisted_record(&json!(null)),
        Err(RecordReadError::Invalid { .. })
    ));
}

#[test]
fn admitted_record_round_trips_to_equal_json() {
    let fixture = record_json(lease_json(json!({})));
    let record = admit_persisted_record(&fixture).expect("fixture admits");
    assert_eq!(record.to_json(), fixture);
    // The source fixture values survive admission exactly.
    assert_eq!(record.session_id, "session-alpha-1");
    assert_eq!(record.provider, HandleProvider::Claude);
    assert_eq!(record.provider_handle_chain.len(), 1);
    assert_eq!(record.lease.runtime_fence, 7);
    assert_eq!(record.lease.claim_status, ClaimStatus::Live);
    assert_eq!(record.lease.owner_process.as_ref().unwrap().pid, 4242);
}

#[test]
fn minimum_next_fence_raw_value_is_preserved_verbatim() {
    // The source lease validator does not check minimumNextFence at all; the
    // port must accept the record and carry the raw persisted JSON value —
    // never rejecting on it and never dropping non-integer data. Later-slice
    // fence policy interprets it separately.
    for raw in [
        json!(21),
        json!("garbage"),
        json!(null),
        json!([1, 2]),
        json!(1.5),
    ] {
        let mut fixture = record_json(lease_json(json!({
            "claimStatus": "released",
            "ownerProcess": null,
            "provenHandleLinkId": null,
            "handoffStage": null,
            "reservedSpawnToken": null,
            "minimumNextFence": raw
        })));
        fixture["updatedAt"] = json!(5_000);
        let record = admit_persisted_record(&fixture).expect("minimumNextFence is not validated");
        assert_eq!(record.lease.minimum_next_fence, Some(raw));
        assert_eq!(record.to_json(), fixture, "raw value round-trips verbatim");
    }
    // Absent stays absent.
    let fixture = record_json(lease_json(json!({})));
    let record = admit_persisted_record(&fixture).expect("fixture admits");
    assert_eq!(record.lease.minimum_next_fence, None);
    assert_eq!(record.to_json(), fixture);
}

#[test]
fn admitted_record_preserves_optional_recovery_and_settlement_fields() {
    let lease = lease_json(json!({
        "claimStatus": "released",
        "ownerProcess": null,
        "provenHandleLinkId": null,
        "handoffStage": null,
        "reservedSpawnToken": null,
        "processlessAt": 12,
        "minimumNextFence": 21,
        "deathEvidence": {"kind": "exit-observed", "detail": "observed process exit", "observedAt": 9_000},
        "settlementRetryRequired": true,
        "settlementRetryId": "settle-1",
        "journalCheckpoint": {"epoch": 4, "sequence": 9}
    }));
    let mut fixture = record_json(lease);
    fixture["options"] = json!({"model": "opus", "effort": "high"});
    fixture["launchArgs"] = json!(["--model", "opus"]);
    fixture["updatedAt"] = json!(5_000);
    let record = admit_persisted_record(&fixture).expect("full-featured record admits");
    assert_eq!(record.to_json(), fixture);
    assert_eq!(record.lease.minimum_next_fence, Some(json!(21)));
    assert_eq!(
        record.lease.death_evidence.as_ref().unwrap().kind,
        DeathEvidenceKind::ExitObserved
    );
    assert_eq!(record.lease.settlement_retry_required, Some(true));
    assert_eq!(
        record.lease.settlement_retry_id.as_deref(),
        Some("settle-1")
    );
    assert_eq!(
        record.lease.journal_checkpoint,
        Some(JournalCheckpoint {
            epoch: 4,
            sequence: 9
        })
    );
    // Options order: serde_json's Map sorts keys, so the port canonicalizes
    // option order rather than preserving JS insertion order (semantically
    // equal per the source's toEqual; recorded in the leaf report).
    let mut options = record.options.clone().unwrap();
    options.sort();
    assert_eq!(
        options.as_slice(),
        [
            ("effort".to_string(), "high".to_string()),
            ("model".to_string(), "opus".to_string())
        ]
    );
    assert_eq!(
        record.launch_args.as_deref(),
        Some(["--model".to_string(), "opus".to_string()].as_slice())
    );
    assert_eq!(record.lease.processless_at, Some(12));
}

// ---------------------------------------------------------------------------
// record_agent_session_provider_handle: fence, provider, and ownership
// precedence around the two admitted cases.
// ---------------------------------------------------------------------------

#[test]
fn record_handle_stale_fence_uses_distinct_transition_code() {
    let record = live_fixture_record();
    assert_eq!(
        record_agent_session_provider_handle(&record, 6, &resumed_link(6), 4_000)
            .expect_err("stale fence")
            .code(),
        SessionAuthorityError::StaleFence.code()
    );
}

#[test]
fn record_handle_rejects_provider_and_fence_mismatched_links() {
    let record = live_fixture_record();
    let codex_link = ProviderHandleLink {
        handle: ProviderHandle::Codex {
            thread_id: "thread-1".to_string(),
        },
        ..resumed_link(7)
    };
    assert_eq!(
        record_agent_session_provider_handle(&record, 7, &codex_link, 4_000)
            .expect_err("provider mismatch")
            .code(),
        SessionAuthorityError::ProviderHandleInvalid.code()
    );
    let wrong_fence = ProviderHandleLink {
        minted_at_fence: 8,
        ..resumed_link(7)
    };
    assert_eq!(
        record_agent_session_provider_handle(&record, 7, &wrong_fence, 4_000)
            .expect_err("minted fence mismatch")
            .code(),
        SessionAuthorityError::ProviderHandleInvalid.code()
    );
}

/// A fixture record whose lease names no live owner and no proving stage:
/// neither `live` nor `new-owner-proving`, so the transition must refuse
/// with unknown ownership.
fn released_ownership_record() -> AgentSessionRecord {
    let lease = lease_json(json!({
        "claimStatus": "released",
        "ownerProcess": null,
        "provenHandleLinkId": null,
        "handoffStage": null,
        "reservedSpawnToken": null
    }));
    admit_persisted_record(&record_json(lease)).expect("released record admits")
}

#[test]
fn record_handle_unknown_ownership_is_distinct_from_stale_fence() {
    let released = released_ownership_record();
    assert_eq!(
        record_agent_session_provider_handle(&released, 7, &resumed_link(7), 4_000)
            .expect_err("released lease owns nobody")
            .code(),
        SessionAuthorityError::OwnershipUnknown.code()
    );
}

#[test]
fn record_handle_retry_updates_renewal_without_duplicating_chain() {
    let record = live_fixture_record();
    // Re-proving the same handle at the same fence is a retry: the chain does
    // not grow, but the renewal stamp still moves.
    let retry_link = ProviderHandleLink {
        link_id: "link-retry".to_string(),
        handle: ProviderHandle::Claude {
            session_id: "provider-session-alpha-1".to_string(),
            leaf_uuid: None,
        },
        origin: HandleOrigin::Resumed,
        minted_at_fence: 7,
        observed_at: 4_000,
        forked_from_key: None,
    };
    let next = record_agent_session_provider_handle(&record, 7, &retry_link, 4_500)
        .expect("same-handle same-fence retry");
    assert_eq!(next.provider_handle_chain.len(), 1);
    assert_eq!(next.lease.last_renewed_at, 4_500);
    assert_eq!(next.lease.proven_handle_link_id.as_deref(), Some("link-1"));
    assert_eq!(next.updated_at, 4_500);
}
