use drogon_orchestration::{runs, schema, tasks};
use drogon_protocol::orchestration_common::OpaqueCursor;
use drogon_protocol::orchestration_run::*;
use drogon_protocol::orchestration_scope::{CoordinatorScope, HostScope};
use drogon_protocol::orchestration_task::*;
use rusqlite::Connection;
use serde_json::json;

fn host() -> HostScope {
    HostScope { contract_version: 1, host_id: "host-a".into() }
}

fn scope(run_id: &str) -> CoordinatorScope {
    CoordinatorScope { host: host(), run_id: run_id.into(), coordinator_id: "owner-a".into(), consumer_generation: 1 }
}

fn database() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    let tx = conn.transaction().unwrap();
    schema::migrate_in_tx(&tx).unwrap();
    tx.commit().unwrap();
    conn
}

fn create_run(tx: &rusqlite::Transaction<'_>, id: &str) {
    runs::create(tx, &RunCreateParams { host: host(), objective: "objective".into(), coordinator_id: "owner-a".into() }, id, 42).unwrap();
}

fn task_params(id: &str, instructions: &str, depends_on: Vec<String>) -> TaskCreateParams {
    TaskCreateParams { scope: scope(id), spec: TaskSpec { title: Some("title".into()), instructions: instructions.into(), depends_on, parent: None, display_name: Some("display".into()), metadata: Some(json!({"preserved":true})) } }
}

fn task_list(run_id: &str, cursor: Option<OpaqueCursor>) -> TaskListParams {
    serde_json::from_value(json!({"contractVersion":1,"hostId":"host-a","runId":run_id,"coordinatorId":"owner-a","consumerGeneration":1,"limit":1,"brief":true,"cursor":cursor})).unwrap()
}

#[test]
fn explicit_takeover_installs_a_different_coordinator_and_fences_prior_owner() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    create_run(&tx, "run-a");
    let mut takeover = RunUseParams { host:host(),run_id:"run-a".into(),coordinator_id:"owner-b".into(),consumer_generation:1,takeover:true };
    let result = runs::use_run(&tx, &takeover).unwrap();
    assert_eq!(result.run.coordinator_id, "owner-b");
    assert_eq!(result.run.consumer_generation, 2);
    assert_eq!(runs::require_coordinator(&tx, &scope("run-a")).unwrap_err().code, "consumer_fenced");
    assert_eq!(runs::use_run(&tx, &takeover).unwrap_err().code, "consumer_fenced");
    takeover.consumer_generation = 2;
    takeover.takeover = false;
    assert_eq!(runs::use_run(&tx, &takeover).unwrap().run, result.run);
}

#[test]
fn run_cursor_advances_same_timestamp_rows_without_repeating_or_skipping() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    for id in ["run-a", "run-b", "run-c"] { create_run(&tx, id); }
    let first = runs::list(&tx, &RunListParams { host:host(),limit:Some(1),cursor:None }).unwrap();
    assert_eq!(first.runs[0].run_id, "run-a");
    let second = runs::list(&tx, &RunListParams { host:host(),limit:Some(1),cursor:first.next_cursor }).unwrap();
    assert_eq!(second.runs[0].run_id, "run-b");
    let third = runs::list(&tx, &RunListParams { host:host(),limit:Some(1),cursor:second.next_cursor }).unwrap();
    assert_eq!(third.runs[0].run_id, "run-c");
    assert!(third.next_cursor.is_none());
}

#[test]
fn task_cursor_advances_while_brief_and_full_specs_preserve_unicode() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    create_run(&tx, "run-a");
    let text = format!("  hello\n\t{}", "界".repeat(180));
    for id in ["task-a", "task-b"] { tasks::create(&tx, &task_params("run-a", &text, vec![]), id, 42).unwrap(); }
    let first = tasks::list(&tx, &task_list("run-a", None)).unwrap();
    assert_eq!(first.tasks[0].spec.chars().count(), 160);
    assert!(first.tasks[0].spec_truncated);
    assert!(first.tasks[0].spec.starts_with("hello "));
    let second = tasks::list(&tx, &task_list("run-a", first.next_cursor)).unwrap();
    assert_eq!(second.tasks[0].task_id, "task-b");
    let shown = tasks::show(&tx, &TaskShowParams { scope:scope("run-a"), task_id:"task-a".into() }).unwrap();
    assert_eq!(shown.spec.instructions, text);
    assert_eq!(shown.spec.metadata, Some(json!({"preserved":true})));
}

#[test]
fn any_future_schema_version_refuses_startup_without_partial_tables() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE orchestration_domain_meta(version INTEGER NOT NULL); INSERT INTO orchestration_domain_meta VALUES (1),(2);").unwrap();
    let tx = conn.transaction().unwrap();
    assert!(schema::migrate_in_tx(&tx).is_err());
    let count:i64 = tx.query_row("SELECT COUNT(*) FROM sqlite_master WHERE name='orchestration_runs'", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 0);
}

#[test]
fn corrupt_negative_run_generation_is_not_silently_rendered_as_zero() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    create_run(&tx, "run-a");
    tx.execute("UPDATE orchestration_runs SET consumer_generation=-1", []).unwrap();
    assert!(runs::show(&tx, &RunShowParams { host:host(),run_id:"run-a".into() }).is_err());
}

#[test]
fn storage_error_does_not_echo_trigger_payload() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    tx.execute_batch("CREATE TRIGGER refuse_run BEFORE INSERT ON orchestration_runs BEGIN SELECT RAISE(FAIL, 'private-sentinel-123'); END;").unwrap();
    let failure = runs::create(&tx, &RunCreateParams { host:host(), objective:"objective".into(),coordinator_id:"owner-a".into() }, "run-a", 0).unwrap_err();
    assert_eq!(failure.code, "storage_error");
    assert!(!failure.message.contains("private-sentinel-123"));
}

#[test]
fn dependencies_are_deduplicated_and_cross_run_rejection_allocates_nothing() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    create_run(&tx, "run-a"); create_run(&tx, "run-b");
    tasks::create(&tx, &task_params("run-a", "first", vec![]), "parent", 0).unwrap();
    let child = tasks::create(&tx, &task_params("run-a", "second", vec!["parent".into(),"parent".into()]), "child", 1).unwrap();
    assert_eq!(child.task.depends_on, vec!["parent"]);
    assert_eq!(child.task.status, TaskStatus::Pending);
    assert!(tasks::create(&tx, &task_params("run-b", "cross", vec!["parent".into()]), "cross", 2).is_err());
    let count:i64 = tx.query_row("SELECT COUNT(*) FROM orchestration_tasks", [], |r|r.get(0)).unwrap();
    assert_eq!(count, 2);
}

#[test]
fn migration_and_mutations_obey_caller_rollback() {
    let mut conn = Connection::open_in_memory().unwrap();
    let tx = conn.transaction().unwrap();
    schema::migrate_in_tx(&tx).unwrap();
    create_run(&tx, "run-a");
    tasks::create(&tx, &task_params("run-a", "first", vec![]), "task-a", 0).unwrap();
    tx.rollback().unwrap();
    assert_eq!(schema::schema_version(&conn).unwrap(), None);
    let count:i64 = conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE name='orchestration_runs'", [], |r|r.get(0)).unwrap();
    assert_eq!(count, 0);
}
