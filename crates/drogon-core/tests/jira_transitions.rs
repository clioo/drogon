//! C09 workflow-transition validation and board pending/reconciliation
//! behavior, tested against the exact `src/jira/transitions.rs` source.
//!
//! The module registers into `jira/mod.rs` at the coordinator's
//! reconciliation (that file is held); until then this test compiles the
//! file directly via `#[path]`, so every assertion below runs the real
//! production bodies — no re-implemented logic, no missing-API mocks.
//! Pure in-process computation only: no HTTP, no daemon, no filesystem.
//!
//! MIT Copyright (c) 2026 Lovecast Inc.

#[path = "../src/jira/transitions.rs"]
mod transitions;

use transitions::{
    AvailableTransition, BeginError, IssueRef, MoveTarget, PendingState, PlanOutcome,
    Reconciliation, Rejection, Settlement, StatusRef, TransitionBoard, TransitionHttpFailure,
    TransitionHttpResponse, TransitionVerdict, build_transition_payload,
    classify_transition_response, compose_issue_identity, compose_lane_identity,
    parse_available_transitions, parse_issue_identity, parse_lane_identity, plan_move,
};

fn status(id: &str, name: &str, category: &str) -> StatusRef {
    StatusRef {
        id: id.to_string(),
        name: name.to_string(),
        category_key: category.to_string(),
    }
}

fn transition(id: &str, name: &str, to: StatusRef) -> AvailableTransition {
    AvailableTransition {
        id: id.to_string(),
        name: name.to_string(),
        to,
        required_fields: Vec::new(),
    }
}

fn issue(site: &str, id: &str, key: &str, current: &StatusRef) -> IssueRef {
    IssueRef {
        site_id: site.to_string(),
        issue_id: id.to_string(),
        issue_key: key.to_string(),
        status: current.clone(),
    }
}

// --- identity ---------------------------------------------------------------

#[test]
fn issue_identity_round_trips_and_separates_sites() {
    let identity = compose_issue_identity("site-a", "10001");
    assert_eq!(
        parse_issue_identity(&identity),
        Some(("site-a".into(), "10001".into()))
    );
    // Same numeric issue id on a second instance: a different identity.
    let twin = compose_issue_identity("site-b", "10001");
    assert_ne!(identity, twin);
    assert_eq!(
        parse_issue_identity(&twin),
        Some(("site-b".into(), "10001".into()))
    );
}

#[test]
fn identity_encodes_separators_inside_site_ids() {
    // A site id containing the separator cannot collide with a composed
    // identity of a literal pipe-bearing site: the site part is encoded.
    let identity = compose_issue_identity("a|b", "7");
    assert_ne!(identity, compose_issue_identity("a", "b|7"));
    assert_eq!(
        parse_issue_identity(&identity),
        Some(("a|b".into(), "7".into()))
    );
}

#[test]
fn identity_rejects_malformed_input() {
    assert_eq!(parse_issue_identity("no-separator"), None);
    assert_eq!(parse_issue_identity("site|"), None);
    // Not produced by the composer (site was not percent-encoded): reject.
    assert_eq!(parse_issue_identity("a b|7"), None);
    assert_eq!(parse_lane_identity("%zz|7"), None);
}

#[test]
fn lane_identity_keeps_same_named_statuses_distinct() {
    let lane_a = compose_lane_identity("site-a", "10001");
    let lane_b = compose_lane_identity("site-b", "10001");
    assert_ne!(lane_a, lane_b);
    assert_eq!(
        parse_lane_identity(&lane_a),
        Some(("site-a".into(), "10001".into()))
    );
}

// --- wire parsing ------------------------------------------------------------

#[test]
fn parses_real_transitions_envelope_with_required_fields() {
    let response = serde_json::json!({
        "transitions": [
            {
                "id": "31",
                "name": "Done",
                "to": {
                    "id": "10002",
                    "name": "Done",
                    "statusCategory": { "key": "done", "name": "Done" }
                },
                "fields": [
                    { "key": "resolution", "required": true, "name": "Resolution" },
                    { "key": "comment", "required": false, "name": "Comment" }
                ]
            },
            {
                "id": "11",
                "name": "GO TO IN PROGRESS",
                "to": {
                    "id": "3",
                    "name": "In Progress",
                    "statusCategory": { "key": "indeterminate", "name": "In Progress" }
                }
            }
        ],
        "expand": "transitions"
    });
    let available = parse_available_transitions(&response);
    assert_eq!(available.len(), 2);
    assert_eq!(available[0].id, "31");
    assert_eq!(available[0].to, status("10002", "Done", "done"));
    assert_eq!(available[0].required_fields, vec!["resolution".to_string()]);
    assert_eq!(available[1].id, "11");
    assert_eq!(available[1].to, status("3", "In Progress", "indeterminate"));
    assert!(available[1].required_fields.is_empty());
}

#[test]
fn parsing_tolerates_absent_and_malformed_envelopes() {
    assert!(parse_available_transitions(&serde_json::json!({})).is_empty());
    assert!(parse_available_transitions(&serde_json::json!({ "transitions": [{}] })).is_empty());
    assert!(parse_available_transitions(&serde_json::Value::Null).is_empty());
}

// --- move planning -----------------------------------------------------------

fn workflow() -> Vec<AvailableTransition> {
    // Two instances of the same workflow shape; note the two statuses that
    // share the display name "In Progress" with different ids, and two
    // transitions that share the display name "Done".
    vec![
        transition(
            "11",
            "Go to In Progress",
            status("3", "In Progress", "indeterminate"),
        ),
        transition(
            "21",
            "Start Hack",
            status("30001", "In Progress", "indeterminate"),
        ),
        transition("31", "Done", status("10002", "Done", "done")),
        transition("41", "Done", status("10002", "Done", "done")),
    ]
}

#[test]
fn status_drop_resolves_the_unique_real_transition() {
    let card = issue("site-a", "10001", "DROG-1", &status("1", "Open", "new"));
    let plan = match plan_move(
        &card,
        &workflow(),
        &MoveTarget::Status {
            status_id: "3".into(),
        },
        &serde_json::Value::Null,
    ) {
        PlanOutcome::Ready(plan) => plan,
        other => panic!("expected a ready plan, got {other:?}"),
    };
    assert_eq!(plan.transition_id, "11");
    assert_eq!(plan.target_status.id, "3");
}

#[test]
fn status_drop_with_two_reaching_transitions_is_ambiguous_never_guessed() {
    let card = issue("site-a", "10001", "DROG-1", &status("1", "Open", "new"));
    let outcome = plan_move(
        &card,
        &workflow(),
        &MoveTarget::Status {
            status_id: "10002".into(),
        },
        &serde_json::Value::Null,
    );
    assert_eq!(
        outcome,
        PlanOutcome::Blocked(transitions::BlockedReason::AmbiguousStatus {
            status_id: "10002".into(),
            transition_ids: vec!["31".into(), "41".into()],
        })
    );
}

#[test]
fn unreachable_status_is_blocked_not_posted() {
    let card = issue("site-a", "10001", "DROG-1", &status("1", "Open", "new"));
    let outcome = plan_move(
        &card,
        &workflow(),
        &MoveTarget::Status {
            status_id: "99999".into(),
        },
        &serde_json::Value::Null,
    );
    assert_eq!(
        outcome,
        PlanOutcome::Blocked(transitions::BlockedReason::StatusNotReachable {
            status_id: "99999".into(),
        })
    );
}

#[test]
fn transition_id_must_be_actually_offered() {
    let card = issue("site-a", "10001", "DROG-1", &status("1", "Open", "new"));
    // A valid id from the OTHER site's copy of the workflow is not offered
    // to this card when the available set is the card's own site's.
    assert_eq!(
        plan_move(
            &card,
            &[workflow()[0].clone(), workflow()[1].clone()],
            &MoveTarget::Transition {
                transition_id: "31".into()
            },
            &serde_json::Value::Null,
        ),
        PlanOutcome::Blocked(transitions::BlockedReason::TransitionNotOffered {
            transition_id: "31".into(),
        })
    );
    // Display names are never handles: "Done" names two transitions.
    let by_exact_id = plan_move(
        &card,
        &workflow(),
        &MoveTarget::Transition {
            transition_id: "41".into(),
        },
        &serde_json::Value::Null,
    );
    assert!(matches!(by_exact_id, PlanOutcome::Ready(_)));
}

#[test]
fn move_onto_the_current_status_is_refused() {
    let card = issue(
        "site-a",
        "10001",
        "DROG-1",
        &status("3", "In Progress", "indeterminate"),
    );
    assert_eq!(
        plan_move(
            &card,
            &workflow(),
            &MoveTarget::Status {
                status_id: "3".into()
            },
            &serde_json::Value::Null,
        ),
        PlanOutcome::Blocked(transitions::BlockedReason::AlreadyInStatus {
            status_id: "3".into(),
        })
    );
}

#[test]
fn empty_offered_set_blocks_without_a_post() {
    let card = issue("site-a", "10001", "DROG-1", &status("1", "Open", "new"));
    assert_eq!(
        plan_move(
            &card,
            &[],
            &MoveTarget::Transition {
                transition_id: "11".into()
            },
            &serde_json::Value::Null,
        ),
        PlanOutcome::Blocked(transitions::BlockedReason::NoTransitionsOffered)
    );
}

#[test]
fn required_fields_block_until_supplied_and_ride_the_payload() {
    let card = issue("site-a", "10001", "DROG-1", &status("1", "Open", "new"));
    let mut available = workflow();
    available[0].required_fields = vec!["resolution".to_string(), "customfield_100".to_string()];
    // Nothing supplied: blocked with the exact missing keys.
    assert_eq!(
        plan_move(
            &card,
            &available,
            &MoveTarget::Status {
                status_id: "3".into()
            },
            &serde_json::Value::Null,
        ),
        PlanOutcome::Blocked(transitions::BlockedReason::RequiredFieldsMissing {
            transition_id: "11".into(),
            fields: vec!["resolution".into(), "customfield_100".into()],
        })
    );
    // Empty-string answers are not answers.
    let half = serde_json::json!({ "resolution": "" });
    assert!(matches!(
        plan_move(
            &card,
            &available,
            &MoveTarget::Status {
                status_id: "3".into()
            },
            &half
        ),
        PlanOutcome::Blocked(transitions::BlockedReason::RequiredFieldsMissing { .. })
    ));
    // Supplied: the plan carries exactly the required fields' values.
    let supplied = serde_json::json!({
        "resolution": { "id": "10000" },
        "customfield_100": "ready",
        "extra": true
    });
    let plan = match plan_move(
        &card,
        &available,
        &MoveTarget::Status {
            status_id: "3".into(),
        },
        &supplied,
    ) {
        PlanOutcome::Ready(plan) => plan,
        other => panic!("expected ready, got {other:?}"),
    };
    assert_eq!(
        plan.fields,
        serde_json::json!({ "resolution": { "id": "10000" }, "customfield_100": "ready" })
    );
}

#[test]
fn transition_payload_is_the_exact_post_body() {
    let plan = transitions::TransitionPlan {
        transition_id: "31".into(),
        transition_name: "Done".into(),
        target_status: status("10002", "Done", "done"),
        fields: serde_json::json!({ "resolution": { "id": "10000" } }),
    };
    assert_eq!(
        build_transition_payload(&plan),
        serde_json::json!({
            "transition": { "id": "31" },
            "fields": { "resolution": { "id": "10000" } },
        })
    );
}

// --- response classification ---------------------------------------------------

#[test]
fn two_xx_answers_are_applied() {
    for status in [200u32, 201, 204] {
        assert_eq!(
            classify_transition_response(Ok(TransitionHttpResponse {
                status,
                body: String::new(),
            })),
            TransitionVerdict::Applied,
            "status {status} must classify as applied"
        );
    }
}

#[test]
fn answered_refusals_are_definite_rejections() {
    assert_eq!(
        classify_transition_response(Ok(TransitionHttpResponse {
            status: 403,
            body: "nope".into(),
        })),
        TransitionVerdict::Rejected(Rejection::Forbidden)
    );
    assert_eq!(
        classify_transition_response(Ok(TransitionHttpResponse {
            status: 400,
            body: r#"{"errorMessages":["The transition is invalid"],"errors":{}}"#.into(),
        })),
        TransitionVerdict::Rejected(Rejection::InvalidTransition {
            message: "The transition is invalid".into(),
        })
    );
    assert_eq!(
        classify_transition_response(Ok(TransitionHttpResponse {
            status: 400,
            body: r#"{"errors":{"resolution":"Resolution is required."}}"#.into(),
        })),
        TransitionVerdict::Rejected(Rejection::RequiredFields {
            fields: vec!["resolution".into()],
        })
    );
    assert!(matches!(
        classify_transition_response(Ok(TransitionHttpResponse {
            status: 404,
            body: "gone".into(),
        })),
        TransitionVerdict::Rejected(Rejection::Other { status: 404, .. })
    ));
}

#[test]
fn timeouts_network_and_5xx_are_uncertain_never_applied_or_rejected() {
    for failure in [
        TransitionHttpFailure::Timeout,
        TransitionHttpFailure::Network("connection reset".into()),
        TransitionHttpFailure::Cancelled,
        TransitionHttpFailure::Api {
            status: 502,
            message: "bad gateway".into(),
        },
    ] {
        assert_eq!(
            classify_transition_response(Err(failure)),
            TransitionVerdict::Uncertain,
            "an unknown-outcome failure must be uncertain"
        );
    }
}

// --- board pending overlay + reconciliation ------------------------------------

#[test]
fn applied_settle_confirms_and_clears_the_overlay() {
    let card = issue("site-a", "10001", "DROG-1", &status("1", "Open", "new"));
    let plan = match plan_move(
        &card,
        &workflow(),
        &MoveTarget::Status {
            status_id: "3".into(),
        },
        &serde_json::Value::Null,
    ) {
        PlanOutcome::Ready(plan) => plan,
        other => panic!("expected ready, got {other:?}"),
    };
    let mut board = TransitionBoard::new();
    let pending = board.begin(&card, &plan).unwrap();
    assert_eq!(pending.state, PendingState::InFlight);
    assert_eq!(pending.origin_status_id, "1");
    assert_eq!(pending.target_status_id, "3");
    assert_eq!(
        board.settle(&pending.identity, &TransitionVerdict::Applied),
        Settlement::Confirmed
    );
    assert!(board.pending(&pending.identity).is_none());
}

#[test]
fn rejected_settle_restores_the_origin_and_reports_the_reason() {
    let card = issue("site-a", "10001", "DROG-1", &status("1", "Open", "new"));
    let plan = match plan_move(
        &card,
        &workflow(),
        &MoveTarget::Status {
            status_id: "3".into(),
        },
        &serde_json::Value::Null,
    ) {
        PlanOutcome::Ready(plan) => plan,
        other => panic!("expected ready, got {other:?}"),
    };
    let mut board = TransitionBoard::new();
    let pending = board.begin(&card, &plan).unwrap();
    assert_eq!(
        board.settle(
            &pending.identity,
            &TransitionVerdict::Rejected(Rejection::Forbidden),
        ),
        Settlement::Restored {
            reason: "Jira denied this transition (403). Check your permissions.".into(),
        }
    );
    assert!(board.pending(&pending.identity).is_none());
}

#[test]
fn uncertain_settle_demands_reconciliation_and_blocks_duplicate_posts() {
    let card = issue("site-a", "10001", "DROG-1", &status("1", "Open", "new"));
    let plan = match plan_move(
        &card,
        &workflow(),
        &MoveTarget::Status {
            status_id: "3".into(),
        },
        &serde_json::Value::Null,
    ) {
        PlanOutcome::Ready(plan) => plan,
        other => panic!("expected ready, got {other:?}"),
    };
    let mut board = TransitionBoard::new();
    let pending = board.begin(&card, &plan).unwrap();
    assert_eq!(
        board.settle(&pending.identity, &TransitionVerdict::Uncertain),
        Settlement::ReconcileNeeded
    );
    let overlay = board.pending(&pending.identity).unwrap();
    assert_eq!(
        overlay.state,
        PendingState::AwaitingReconciliation { attempts: 1 }
    );
    // A second move behind the unresolved pending is structurally refused:
    // no blind duplicate POST is reachable.
    assert_eq!(
        board.begin(&card, &plan),
        Err(BeginError::MoveAlreadyPending {
            identity: pending.identity.clone(),
        })
    );
}

#[test]
fn reconciliation_adopts_only_server_truth() {
    let card = issue("site-a", "10001", "DROG-1", &status("1", "Open", "new"));
    let plan = match plan_move(
        &card,
        &workflow(),
        &MoveTarget::Status {
            status_id: "3".into(),
        },
        &serde_json::Value::Null,
    ) {
        PlanOutcome::Ready(plan) => plan,
        other => panic!("expected ready, got {other:?}"),
    };
    // Applied after all: the fresh GET shows the target status.
    let mut board = TransitionBoard::new();
    let pending = board.begin(&card, &plan).unwrap();
    let _ = board.settle(&pending.identity, &TransitionVerdict::Uncertain);
    assert_eq!(
        board.reconcile(
            &pending.identity,
            &status("3", "In Progress", "indeterminate")
        ),
        Reconciliation::Applied
    );
    assert!(board.pending(&pending.identity).is_none());

    // Not applied: the server still shows the origin; overlay releases and
    // only an explicit user action may retry the same plan.
    let mut board = TransitionBoard::new();
    let pending = board.begin(&card, &plan).unwrap();
    let _ = board.settle(&pending.identity, &TransitionVerdict::Uncertain);
    assert_eq!(
        board.reconcile(&pending.identity, &status("1", "Open", "new")),
        Reconciliation::NotApplied {
            status: status("1", "Open", "new"),
        }
    );
    assert!(board.pending(&pending.identity).is_none());

    // Superseded: a concurrent remote mutation moved the issue elsewhere;
    // the board adopts the server's actual status.
    let mut board = TransitionBoard::new();
    let pending = board.begin(&card, &plan).unwrap();
    let _ = board.settle(&pending.identity, &TransitionVerdict::Uncertain);
    assert_eq!(
        board.reconcile(&pending.identity, &status("10002", "Done", "done")),
        Reconciliation::Superseded {
            status: status("10002", "Done", "done"),
        }
    );
    assert!(board.pending(&pending.identity).is_none());
}

#[test]
fn colliding_issues_on_two_instances_get_independent_pendings() {
    let card_a = issue("site-a", "10001", "DROG-1", &status("1", "Open", "new"));
    let card_b = issue("site-b", "10001", "DROG-1", &status("1", "Open", "new"));
    let plan = match plan_move(
        &card_a,
        &workflow(),
        &MoveTarget::Status {
            status_id: "3".into(),
        },
        &serde_json::Value::Null,
    ) {
        PlanOutcome::Ready(plan) => plan,
        other => panic!("expected ready, got {other:?}"),
    };
    let mut board = TransitionBoard::new();
    let pending_a = board.begin(&card_a, &plan).unwrap();
    // The second instance's same-numbered issue moves independently.
    assert!(board.begin(&card_b, &plan).is_ok());
    assert_eq!(
        board.settle(&pending_a.identity, &TransitionVerdict::Uncertain),
        Settlement::ReconcileNeeded
    );
    // site-b's move is untouched by site-a's settlement.
    assert_eq!(
        board
            .pending(&compose_issue_identity("site-b", "10001"))
            .unwrap()
            .state,
        PendingState::InFlight
    );
}

#[test]
fn stale_settles_and_reconciles_are_noops() {
    let mut board = TransitionBoard::new();
    assert_eq!(
        board.settle("site-a|10001", &TransitionVerdict::Applied),
        Settlement::NoPending
    );
    assert_eq!(
        board.reconcile("site-a|10001", &status("3", "In Progress", "indeterminate")),
        Reconciliation::NoPending
    );
}
