use drogon_core::bots::records::ResponsibilityTrigger;
use drogon_core::{DB_FILE_NAME, Engine, bots};
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::json;

#[test]
fn scheduled_snapshot_uses_the_admitted_camel_case_desktop_contract() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("data");
    let engine = Engine::open(&data).unwrap();
    let call = |method: &str, params| {
        engine.dispatch(Request {
            protocol: PROTOCOL_VERSION,
            request_id: uuid::Uuid::new_v4().to_string(),
            auth: None,
            method: method.into(),
            params,
        })
    };
    let workspace = call("workspace.register", json!({"path":dir.path()}))
        .result
        .unwrap();
    let mut bot = bots::records::normalize_bot(
        &json!({"id":"bot", "displayIdentity":{"displayName":"Bot"}}),
        |_| true,
        1.0,
    )
    .unwrap();
    bot.responsibilities.push(bots::records::Responsibility {
        id: "duty".into(),
        name: "Review".into(),
        instructions: "Review fixture".into(),
        kind: bots::records::ResponsibilityKind::Scheduled,
        trigger: ResponsibilityTrigger::Scheduled {
            automation_id: "automation-1".into(),
        },
        enabled: true,
        recipe: None,
        created_at: 1.0,
        updated_at: 1.0,
    });
    let conn = rusqlite::Connection::open(data.join(DB_FILE_NAME)).unwrap();
    bots::storage::create_bot(
        &conn,
        workspace["hostId"].as_str().unwrap(),
        workspace["path"].as_str().unwrap(),
        &bot,
    )
    .unwrap();
    let response = call(
        "bot.snapshot",
        json!({
            "hostId":workspace["hostId"], "workspaceId":workspace["id"], "locale":"en-US",
        }),
    );
    assert!(response.ok, "{response:?}");
    let result = response.result.unwrap();
    assert_eq!(
        result["bots"][0]["responsibilities"][0]["trigger"]["automationId"],
        "automation-1",
    );
    let raw: String = conn
        .query_row("SELECT payload_json FROM bots WHERE id='bot'", [], |r| {
            r.get(0)
        })
        .unwrap();
    let stored: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        stored["responsibilities"][0]["trigger"]["automation_id"], "automation-1",
        "Snapshot projection must not rewrite the persisted record contract",
    );
}

#[test]
fn scheduled_storage_writer_remains_compatible_with_existing_readers() {
    let trigger = ResponsibilityTrigger::Scheduled {
        automation_id: "automation-1".into(),
    };
    assert_eq!(
        serde_json::to_value(trigger).unwrap(),
        json!({"kind":"scheduled", "automation_id":"automation-1"}),
    );
}

#[test]
fn scheduled_trigger_preserves_existing_snake_case_storage_reads() {
    let trigger: ResponsibilityTrigger =
        serde_json::from_value(json!({"kind":"scheduled", "automation_id":"automation-1"}))
            .unwrap();
    assert_eq!(
        trigger,
        ResponsibilityTrigger::Scheduled {
            automation_id: "automation-1".into(),
        },
    );
}

/// Regression for the estimator bug a real host tripped: a recurring automation's
/// history rows all link the SAME `automations` record, but `history_for_bot` fetches
/// and parses that record once per *distinct* id (memoized in `history_for_bot`), never
/// once per referencing row. The preflight budget must charge it the same way -- a small
/// linked automation referenced by many runs must never be rejected as if its payload were
/// duplicated once per reference. `linked_payload` alone sits comfortably under budget, but
/// naive per-reference charging (the pre-fix behavior) would multiply it past budget at 4
/// references; this asserts the snapshot still succeeds and returns every entry.
#[test]
fn snapshot_budget_charges_linked_automation_once_per_distinct_reference_not_per_row() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("data");
    let engine = Engine::open(&data).unwrap();
    let call = |method: &str, params| {
        engine.dispatch(Request {
            protocol: PROTOCOL_VERSION,
            request_id: uuid::Uuid::new_v4().to_string(),
            auth: None,
            method: method.into(),
            params,
        })
    };
    let workspace = call("workspace.register", json!({"path":dir.path()}))
        .result
        .unwrap();
    let conn = rusqlite::Connection::open(data.join(DB_FILE_NAME)).unwrap();
    let bot = bots::records::normalize_bot(
        &json!({"id":"bot", "displayIdentity":{"displayName":"Bot"}}),
        |_| true,
        1.0,
    )
    .unwrap();
    bots::storage::create_bot(
        &conn,
        workspace["hostId"].as_str().unwrap(),
        workspace["path"].as_str().unwrap(),
        &bot,
    )
    .unwrap();
    // A real, materializable Automation (not the deliberately-malformed payload the old
    // per-reference test used): the fix lets this reach real materialization, so the
    // fixture must survive it end to end, not just dodge the early budget check.
    let padding = "x".repeat(200_000);
    let automation = json!({
        "id":"linked", "name":"sweep", "prompt":padding, "agentId":"codex",
        "projectId":"proj", "executionTargetType":"local", "executionTargetId":"local",
        "schedulerOwner":"local_host_service", "workspaceMode":"existing",
        "reuseSession":false, "timezone":"UTC", "rrule":"FREQ=DAILY", "dtstart":0.0,
        "enabled":true, "nextRunAt":100.0, "missedRunPolicy":"run_once_within_grace",
        "missedRunGraceMinutes":30.0, "createdAt":0.0, "updatedAt":0.0,
    })
    .to_string();
    assert!(automation.len() < drogon_protocol::MAX_FRAME_BYTES / 2);
    conn.execute(
        "INSERT INTO automations (id, bot_id, payload_json) VALUES ('linked', NULL, ?1)",
        [&automation],
    )
    .unwrap();
    for index in 0..4 {
        let id = format!("run-{index}");
        let run = json!({
            "id":id, "botId":"bot", "responsibilityId":"duty",
            "automationId":"linked", "automationRunId":null,
            "startedAt":1.0, "endedAt":null, "recipe":null, "hostObservation":null,
        });
        conn.execute(
            "INSERT INTO bot_responsibility_runs
             (id, bot_id, automation_run_id, started_at, payload_json)
             VALUES (?1, 'bot', NULL, 1.0, ?2)",
            rusqlite::params![id, run.to_string()],
        )
        .unwrap();
    }
    // Naive per-reference charging would have summed this 4x -- comfortably over budget.
    assert!(automation.len() * 4 > drogon_protocol::MAX_FRAME_BYTES / 2);
    let response = call(
        "bot.snapshot",
        json!({"hostId":workspace["hostId"], "workspaceId":workspace["id"], "locale":"en-US"}),
    );
    assert!(response.ok, "{response:?}");
    let history = response.result.unwrap()["history"]
        .as_array()
        .unwrap()
        .len();
    assert_eq!(
        history, 4,
        "every referencing history row must still materialize"
    );
}
