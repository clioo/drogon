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

#[test]
fn snapshot_budget_counts_linked_payload_for_each_materialized_history_entry() {
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
    // Invalid domain payload distinguishes early budgeting from materialization.
    let linked_payload = json!("x".repeat(200_000)).to_string();
    conn.execute(
        "INSERT INTO automations (id, bot_id, payload_json) VALUES ('linked', NULL, ?1)",
        [&linked_payload],
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
    assert!(linked_payload.len() < drogon_protocol::MAX_FRAME_BYTES / 2);
    assert!(linked_payload.len() * 4 > drogon_protocol::MAX_FRAME_BYTES / 2);
    let response = call(
        "bot.snapshot",
        json!({"hostId":workspace["hostId"], "workspaceId":workspace["id"], "locale":"en-US"}),
    );
    assert_eq!(
        response.error.as_ref().map(|error| error.code.as_str()),
        Some("snapshot_too_large"),
        "Budget each reference before loading malformed linked records: {response:?}",
    );
}
