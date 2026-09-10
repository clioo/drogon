//! C05 Bot conversation + durable delivery integration proof.
//!
//! Binds only to real public paths (`drogon_core::bots::{conversation,
//! delivery, input}`) plus `rusqlite`/`tempfile` for the crash-injection
//! storage. No `Engine`, no session/daemon/CLI/server/native child, no
//! model inference: every body below is literal in-process computation or
//! a controlled temp-file SQLite database.

use drogon_core::bots::conversation::{
    ActiveTurn, ContextRef, Conversation, EffectiveRuntime, EffectiveSource, FrozenContextView,
    FrozenMemoryView, NativeLiveness, NativeRef, conversation_id, parse_conversation_id,
    resolve_conversation,
};
use drogon_core::bots::delivery::{
    Delivery, DeliveryRecovery, DeliveryState, DeliveryTarget, EnqueueResultRequest,
    TargetSendOutcome, begin_attempt_in_tx, commit_delivered_in_tx, commit_failed_in_tx,
    enqueue_in_tx, ensure_schema, get_in_tx, list_for_conversation_in_tx,
    next_state_for_target_outcome, payload_hash_for, reconcile_in_tx,
};
use drogon_core::bots::input::{is_fifo_append, parse_queue_input, parse_steer_input};
use drogon_core::bots::records::{Bot, DisplayIdentity, HarnessModelPolicy};
use rusqlite::Connection;
use serde_json::json;

fn bot_fixture(id: &str) -> Bot {
    Bot {
        id: id.to_string(),
        character_preset: "none".to_string(),
        display_identity: DisplayIdentity {
            display_name: "Watcher".to_string(),
            handle: None,
            title: None,
        },
        harness_policy: HarnessModelPolicy {
            default_harness: "pi".to_string(),
            explicit_model: Some("dgx-spark/qwen".to_string()),
        },
        instructions: "Guard the realm.".to_string(),
        memories: vec!["first memory".to_string()],
        responsibilities: Vec::new(),
        current_session: None,
        created_at: 1.0,
        updated_at: 1.0,
    }
}

/// A C04 frozen-context projection: in production this exact shape arrives
/// from C04's `build_scoped_operating_prompt` (`FrozenPromptContext`);
/// C05 adopts it verbatim and never recomputes the hash.
fn frozen_fixture(bot_id: &str) -> FrozenContextView {
    FrozenContextView {
        bot_id: bot_id.to_string(),
        identity_version: 1,
        frozen_at: 1.0,
        memories: vec![FrozenMemoryView {
            id: "m-1".to_string(),
            version: 2,
        }],
        context_hash: "c04-frozen-hash-fixture".to_string(),
    }
}

fn context_fixture(bot_id: &str) -> ContextRef {
    ContextRef::adopt(bot_id, &frozen_fixture(bot_id)).expect("valid context")
}

fn open_conversation(bot_id: &str, project: &str) -> Conversation {
    let bot = bot_fixture(bot_id);
    Conversation::open_from_bot(
        &bot,
        project,
        "host-1",
        "req-1",
        context_fixture(bot_id),
        1.0,
    )
    .expect("valid open")
}

/// The authoritative conversation id for delivery fixtures — always minted
/// by native, never hand-joined.
fn conv_id(bot: &str, project: &str) -> String {
    resolve_conversation(bot, project, "host-1")
        .expect("resolve")
        .1
}

fn temp_db() -> (tempfile::TempDir, Connection) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("c05-test.sqlite");
    let conn = Connection::open(&path).expect("open temp db");
    ensure_schema(&conn).expect("ensure schema");
    (dir, conn)
}

#[test]
fn repeated_resolve_finds_one_conversation_and_projects_stay_separate() {
    let first = conversation_id("bot-1", "proj-a", "host-1").expect("id");
    let again = conversation_id("bot-1", "proj-a", "host-1").expect("id");
    assert_eq!(first, again);
    let other_project = conversation_id("bot-1", "proj-b", "host-1").expect("id");
    assert_ne!(first, other_project);
    let other_bot = conversation_id("bot-2", "proj-a", "host-1").expect("id");
    assert_ne!(first, other_bot);
    // The host is part of the identity: one Bot/project on two hosts.
    let other_host = conversation_id("bot-1", "proj-a", "host-2").expect("id");
    assert_ne!(first, other_host);

    let (scope, id) = resolve_conversation("bot-1", "proj-a", "host-1").expect("resolve");
    assert_eq!(id, first);
    assert_eq!(scope.bot_id, "bot-1");

    let a = open_conversation("bot-1", "proj-a");
    let b = open_conversation("bot-1", "proj-a");
    assert_eq!(a.id, b.id);
    let c = open_conversation("bot-1", "proj-b");
    assert_ne!(a.id, c.id);
}

#[test]
fn conversation_ids_survive_delimiter_collisions_and_round_trip() {
    // Validators admit arbitrary text: these pairs would collide under a
    // naive `bot:project` join but must stay distinct here.
    let tricky_a = conversation_id("a:b", "c", "h").expect("id");
    let tricky_b = conversation_id("a", "b:c", "h").expect("id");
    assert_ne!(tricky_a, tricky_b);
    let pct = conversation_id("100%", "uni-☃", "h:1").expect("id");
    for (id, bot, project, host) in [
        (tricky_a.clone(), "a:b", "c", "h"),
        (tricky_b.clone(), "a", "b:c", "h"),
        (pct.clone(), "100%", "uni-☃", "h:1"),
    ] {
        let scope = parse_conversation_id(&id).expect("round-trips");
        assert_eq!(scope.bot_id, bot);
        assert_eq!(scope.project_id, project);
        assert_eq!(scope.host_id, host);
    }
    // Nothing not minted here parses: legacy joins, versions, escapes.
    for bad in [
        "bot-1:proj-a",
        "v2:bot-1:proj-a:host-1",
        "v1:bot-1:proj-a",
        "v1:bot-1:proj-a:host-1:extra",
        "v1:%:proj-a:host-1",
        "v1:%2:proj-a:host-1",
        "",
    ] {
        assert!(parse_conversation_id(bad).is_err(), "must refuse {bad:?}");
    }
}

#[test]
fn wrong_scope_targets_are_rejected() {
    let mut conv = open_conversation("bot-1", "proj-a");
    assert!(conv.check_target("bot-1", "proj-a", "host-1").is_ok());
    assert!(conv.check_target("bot-2", "proj-a", "host-1").is_err());
    assert!(conv.check_target("bot-1", "proj-b", "host-1").is_err());
    assert!(conv.check_target("bot-1", "proj-a", "host-2").is_err());

    // Delivery target check mirrors the same rule.
    let (_dir, conn) = temp_db();
    let tx = conn.unchecked_transaction().expect("tx");
    let delivery = Delivery::new(
        "del-1",
        &conv.id,
        "bot-1",
        "proj-a",
        "host-1",
        "req-1",
        &payload_hash_for(b"result bytes"),
        1.0,
    )
    .expect("new");
    let stored = enqueue_in_tx(&tx, &delivery).expect("enqueue");
    assert!(stored.check_target(&conv.id).is_ok());
    assert!(stored.check_target(&conv_id("bot-1", "proj-b")).is_err());
    tx.rollback().expect("rollback");
    let _ = &mut conv;
}

#[test]
fn replay_same_delivery_id_is_idempotent_and_changed_payload_conflicts() {
    let (_dir, conn) = temp_db();
    let conv = conv_id("bot-1", "proj-a");
    let hash = payload_hash_for(b"same bytes");
    let first = Delivery::new(
        "del-dup", &conv, "bot-1", "proj-a", "host-1", "req-1", &hash, 1.0,
    )
    .expect("new");
    let tx = conn.unchecked_transaction().expect("tx");
    let stored = enqueue_in_tx(&tx, &first).expect("first enqueue");
    assert_eq!(stored.state, DeliveryState::Pending);
    // Same id + same hash: no second locally committed result.
    let replay = Delivery::new(
        "del-dup", &conv, "bot-1", "proj-a", "host-1", "req-1", &hash, 2.0,
    )
    .expect("new");
    let again = enqueue_in_tx(&tx, &replay).expect("replay");
    assert_eq!(again.id, stored.id);
    assert_eq!(again.created_at, stored.created_at);
    assert_eq!(
        list_for_conversation_in_tx(&tx, &conv).expect("list").len(),
        1
    );
    // Changed payload with the same id is rejected and writes nothing.
    let changed = Delivery::new(
        "del-dup",
        &conv,
        "bot-1",
        "proj-a",
        "host-1",
        "req-1",
        &payload_hash_for(b"different bytes"),
        3.0,
    )
    .expect("new");
    assert!(enqueue_in_tx(&tx, &changed).is_err());
    assert_eq!(
        list_for_conversation_in_tx(&tx, &conv).expect("list").len(),
        1
    );
    tx.commit().expect("commit");
}

#[test]
fn crash_before_send_recovers_as_pending() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("crash-before.sqlite");
    let conv = conv_id("bot-1", "proj-a");
    {
        let conn = Connection::open(&path).expect("open");
        ensure_schema(&conn).expect("schema");
        let delivery = Delivery::new(
            "del-before",
            &conv,
            "bot-1",
            "proj-a",
            "host-1",
            "req-1",
            &payload_hash_for(b"bytes"),
            1.0,
        )
        .expect("new");
        // Simulate a crash BEFORE the send effect: the enqueue commit lands,
        // the send never runs. Recovery must see pending (safe to send).
        let tx = conn.unchecked_transaction().expect("tx");
        enqueue_in_tx(&tx, &delivery).expect("enqueue");
        tx.commit().expect("commit enqueue");
        // No begin_attempt ever ran: the process "crashes" here (drop).
    }
    // "Restart": reopen the same file and verify recoverable state.
    {
        let conn = Connection::open(&path).expect("reopen");
        ensure_schema(&conn).expect("schema reopen");
        let tx = conn.unchecked_transaction().expect("tx");
        let stored = get_in_tx(&tx, "del-before").expect("get").expect("row");
        assert_eq!(stored.state, DeliveryState::Pending);
        assert_eq!(stored.recovery(), DeliveryRecovery::ResendPending);
        tx.rollback().expect("rollback");
    }
}

#[test]
fn crash_after_send_before_ack_recovers_as_uncertain_and_needs_reconciliation() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("crash-mid.sqlite");
    let conv = conv_id("bot-1", "proj-a");
    {
        let conn = Connection::open(&path).expect("open");
        ensure_schema(&conn).expect("schema");
        let delivery = Delivery::new(
            "del-mid",
            &conv,
            "bot-1",
            "proj-a",
            "host-1",
            "req-1",
            &payload_hash_for(b"bytes"),
            1.0,
        )
        .expect("new");
        let tx = conn.unchecked_transaction().expect("tx");
        enqueue_in_tx(&tx, &delivery).expect("enqueue");
        tx.commit().expect("commit");
        // Persist uncertain BEFORE the effect (the crash protocol).
        let tx = conn.unchecked_transaction().expect("tx");
        let mid = begin_attempt_in_tx(&tx, "del-mid", false, 2.0).expect("begin");
        assert_eq!(mid.state, DeliveryState::Uncertain);
        tx.commit().expect("commit begin");
        // Crash: the send may have happened, the ack commit never runs.
    }
    {
        let conn = Connection::open(&path).expect("reopen");
        ensure_schema(&conn).expect("schema");
        let tx = conn.unchecked_transaction().expect("tx");
        let stored = get_in_tx(&tx, "del-mid").expect("get").expect("row");
        assert_eq!(stored.state, DeliveryState::Uncertain);
        assert_eq!(stored.recovery(), DeliveryRecovery::ReconcileUncertain);
        // Uncertain never auto-resends: begin_attempt again is refused.
        assert!(begin_attempt_in_tx(&tx, "del-mid", false, 3.0).is_err());
        // Explicit reconciliation resolves it (accepted side).
        let done = reconcile_in_tx(&tx, "del-mid", true, None, 4.0).expect("reconcile");
        assert_eq!(done.state, DeliveryState::Delivered);
        tx.commit().expect("commit");
    }
}

#[test]
fn crash_after_ack_recovers_as_delivered_noop() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("crash-after.sqlite");
    let conv = conv_id("bot-1", "proj-a");
    {
        let conn = Connection::open(&path).expect("open");
        ensure_schema(&conn).expect("schema");
        let delivery = Delivery::new(
            "del-after",
            &conv,
            "bot-1",
            "proj-a",
            "host-1",
            "req-1",
            &payload_hash_for(b"bytes"),
            1.0,
        )
        .expect("new");
        let tx = conn.unchecked_transaction().expect("tx");
        enqueue_in_tx(&tx, &delivery).expect("enqueue");
        tx.commit().expect("commit");
        let tx = conn.unchecked_transaction().expect("tx");
        begin_attempt_in_tx(&tx, "del-after", false, 2.0).expect("begin");
        tx.commit().expect("commit begin");
        let tx = conn.unchecked_transaction().expect("tx");
        commit_delivered_in_tx(&tx, "del-after", 3.0).expect("delivered");
        tx.commit().expect("commit delivered");
        // Crash after the ack commit.
    }
    {
        let conn = Connection::open(&path).expect("reopen");
        ensure_schema(&conn).expect("schema");
        let tx = conn.unchecked_transaction().expect("tx");
        let stored = get_in_tx(&tx, "del-after").expect("get").expect("row");
        assert_eq!(stored.state, DeliveryState::Delivered);
        assert_eq!(stored.recovery(), DeliveryRecovery::NoopDelivered);
        tx.rollback().expect("rollback");
    }
}

struct ScriptedTarget(TargetSendOutcome);

impl DeliveryTarget for ScriptedTarget {
    fn send(&self, _delivery: &Delivery) -> TargetSendOutcome {
        self.0.clone()
    }
}

#[test]
fn timeout_after_possible_acceptance_is_uncertain_never_delivered() {
    // Deterministic target fixture: no session, no child, just a script.
    // The fixture is called with a detached clone, never under a DB lock.
    let delivery = Delivery::new(
        "del-timeout",
        &conv_id("bot-1", "proj-a"),
        "bot-1",
        "proj-a",
        "host-1",
        "req-1",
        &payload_hash_for(b"bytes"),
        1.0,
    )
    .expect("new");
    let target = ScriptedTarget(TargetSendOutcome::Timeout);
    let outcome = target.send(&delivery);
    assert_eq!(
        next_state_for_target_outcome(&outcome),
        DeliveryState::Uncertain
    );
    let accepted = ScriptedTarget(TargetSendOutcome::Accepted);
    assert_eq!(
        next_state_for_target_outcome(&accepted.send(&delivery)),
        DeliveryState::Delivered
    );
    let rejected = ScriptedTarget(TargetSendOutcome::Rejected("no".to_string()));
    assert_eq!(
        next_state_for_target_outcome(&rejected.send(&delivery)),
        DeliveryState::Failed
    );

    // The transactional path keeps a timeout as uncertain (not failed).
    let (_dir, conn) = temp_db();
    let tx = conn.unchecked_transaction().expect("tx");
    enqueue_in_tx(&tx, &delivery).expect("enqueue");
    begin_attempt_in_tx(&tx, "del-timeout", false, 2.0).expect("begin");
    // Timeout: no commit to delivered/failed — the row stays uncertain.
    let stored = get_in_tx(&tx, "del-timeout").expect("get").expect("row");
    assert_eq!(stored.state, DeliveryState::Uncertain);
    assert!(!matches!(stored.state, DeliveryState::Delivered));
    tx.rollback().expect("rollback");
}

#[test]
fn failed_delivery_retries_only_with_explicit_approval() {
    let (_dir, conn) = temp_db();
    let delivery = Delivery::new(
        "del-fail",
        &conv_id("bot-1", "proj-a"),
        "bot-1",
        "proj-a",
        "host-1",
        "req-1",
        &payload_hash_for(b"bytes"),
        1.0,
    )
    .expect("new");
    let tx = conn.unchecked_transaction().expect("tx");
    enqueue_in_tx(&tx, &delivery).expect("enqueue");
    begin_attempt_in_tx(&tx, "del-fail", false, 2.0).expect("begin");
    commit_failed_in_tx(&tx, "del-fail", "refused", 3.0).expect("failed");
    let stored = get_in_tx(&tx, "del-fail").expect("get").expect("row");
    assert_eq!(stored.state, DeliveryState::Failed);
    assert_eq!(
        stored.recovery(),
        DeliveryRecovery::RetryFailedRequiresApproval
    );
    // Blind retry without approval is refused.
    assert!(begin_attempt_in_tx(&tx, "del-fail", false, 4.0).is_err());
    // Explicit user-approved retry re-enters uncertain.
    let again = begin_attempt_in_tx(&tx, "del-fail", true, 5.0).expect("approved");
    assert_eq!(again.state, DeliveryState::Uncertain);
    tx.rollback().expect("rollback");
}

#[test]
fn queue_ordering_and_steer_survive_with_active_turn() {
    let mut conv = open_conversation("bot-1", "proj-a");
    conv.begin_turn("req-active", 2.0).expect("begin");
    conv.enqueue_input("q1", "first follow-up", 3.0)
        .expect("q1");
    conv.enqueue_input("q2", "second follow-up", 4.0)
        .expect("q2");
    assert_eq!(conv.queue.len(), 2);
    assert_eq!(conv.queue[0].prompt, "first follow-up");
    assert_eq!(conv.queue[1].prompt, "second follow-up");
    // Steer works while active and leaves the queue untouched.
    let directive = conv.steer_active("pivot now", 5.0).expect("steer");
    assert!(directive.starts_with("req-active:"));
    assert_eq!(conv.queue.len(), 2);
    // Queued inputs wait: no overtaking while the turn is active.
    assert!(conv.take_next_queued(6.0).is_none());
    conv.end_turn(7.0);
    let next = conv.take_next_queued(8.0).expect("next");
    assert_eq!(next.id, "q1");
    assert_eq!(conv.queue.len(), 1);
    // FIFO predicate documents the same invariant for producers.
    assert!(is_fifo_append(
        &["q1".to_string()],
        &["q1".to_string(), "q2".to_string()],
        &["q2".to_string()]
    ));
}

#[test]
fn steer_without_active_turn_is_rejected_and_inputs_parse_strictly() {
    let mut conv = open_conversation("bot-1", "proj-a");
    assert!(conv.steer_active("pivot", 2.0).is_err());

    let queued = parse_queue_input(&json!({
        "botId": "bot-1", "projectId": "proj-a", "hostId": "host-1", "prompt": "hello"
    }))
    .expect("valid queue");
    assert_eq!(queued.bot_id, "bot-1");
    assert!(
        parse_queue_input(&json!({
            "botId": "bot-1", "projectId": "proj-a", "hostId": "host-1", "prompt": "   "
        }))
        .is_err()
    );
    assert!(
        parse_queue_input(&json!({
            "botId": "bot-1", "projectId": "proj-a", "hostId": "host-1", "prompt": "hi", "extra": 1
        }))
        .is_err()
    );

    let steer = parse_steer_input(&json!({
        "botId": "bot-1", "projectId": "proj-a", "hostId": "host-1",
        "activeRequestId": "req-active", "prompt": "pivot"
    }))
    .expect("valid steer");
    assert_eq!(steer.active_request_id, "req-active");
    assert!(
        parse_steer_input(&json!({
            "botId": "bot-1", "projectId": "proj-a", "hostId": "host-1", "prompt": "pivot"
        }))
        .is_err()
    );
}

#[test]
fn stale_native_sessions_report_honest_liveness() {
    let mut conv = open_conversation("bot-1", "proj-a");
    // No native link: no claim at all.
    assert_eq!(conv.native_liveness(Some("live")), None);
    conv.attach_native(NativeRef::new("sess-1", "inc-1").expect("ref"), 2.0);
    assert_eq!(
        conv.native_liveness(Some("live")),
        Some(NativeLiveness::Live)
    );
    assert_eq!(
        conv.native_liveness(Some("exited")),
        Some(NativeLiveness::Exited)
    );
    // Lost contact (or a stale incarnation with no fresh read) is
    // unverifiable — never live, never silently exited.
    assert_eq!(
        conv.native_liveness(None),
        Some(NativeLiveness::Unverifiable)
    );
    assert_eq!(
        conv.native_liveness(Some("bogus-future-verdict")),
        Some(NativeLiveness::Unverifiable)
    );
    // Rotation keeps the previous link for truthful recovery.
    conv.rotate_native(NativeRef::new("sess-2", "inc-2").expect("ref"), 3.0);
    assert_eq!(conv.native.as_ref().expect("native").session_id, "sess-2");
    assert_eq!(
        conv.previous_native.as_ref().expect("prev").session_id,
        "sess-1"
    );
}

#[test]
fn runtime_starts_proposed_and_only_dispatch_makes_it_effective() {
    let bot = bot_fixture("bot-1");
    let proposed = EffectiveRuntime::proposed_from_bot(&bot);
    assert_eq!(proposed.harness, "pi");
    assert_eq!(proposed.provider.as_deref(), Some("dgx-spark"));
    assert_eq!(proposed.model.as_deref(), Some("qwen"));
    assert_eq!(proposed.source, EffectiveSource::ProposedFromPolicy);

    // Opening from a Bot carries the proposal, never dispatched truth.
    let mut conv = open_conversation("bot-1", "proj-a");
    assert_eq!(conv.effective.source, EffectiveSource::ProposedFromPolicy);
    // The owner records the exact harness.start params after dispatch.
    conv.record_effective_runtime(
        EffectiveRuntime::dispatched("pi", Some("dgx-spark"), Some("qwen")).expect("dispatched"),
        2.0,
    );
    assert_eq!(conv.effective.source, EffectiveSource::ActualDispatch);

    // Context adoption refuses foreign-bot views and zero versions.
    let frozen = frozen_fixture("bot-1");
    let ctx = ContextRef::adopt("bot-1", &frozen).expect("adopts");
    assert_eq!(ctx.identity_version, 1);
    assert_eq!(ctx.memories.len(), 1);
    assert_eq!(ctx.memories[0].version, 2);
    assert!(ContextRef::adopt("bot-2", &frozen).is_err());
    let mut zero = frozen_fixture("bot-1");
    zero.identity_version = 0;
    assert!(ContextRef::adopt("bot-1", &zero).is_err());

    // The enqueue-result DTO carries every field recovery needs.
    let dto = drogon_core::bots::conversation::ContextReferenceDto::from_conversation(&conv);
    assert_eq!(dto.conversation_id, conv.id);
    assert_eq!(dto.identity_version, conv.identity_version);
    assert_eq!(dto.effective_source, EffectiveSource::ActualDispatch);
    assert_eq!(dto.memories.len(), 1);
    let req = EnqueueResultRequest {
        delivery_id: "del-ctx".to_string(),
        conversation_id: dto.conversation_id.clone(),
        bot_id: dto.bot_id.clone(),
        project_id: dto.project_id.clone(),
        host_id: dto.host_id.clone(),
        run_id: dto.originating_run_id.clone(),
        payload_hash: payload_hash_for(b"result"),
    };
    let delivery = req.into_delivery(9.0).expect("delivery");
    assert_eq!(delivery.conversation_id, conv.id);
    let _ = ActiveTurn {
        request_id: "req-1".to_string(),
        started_at: 1.0,
    };
}
