use drogon_orchestration::{runs, schema, tasks};
use drogon_protocol::orchestration_common::OpaqueCursor;
use drogon_protocol::orchestration_run::*;
use drogon_protocol::orchestration_scope::{CoordinatorScope, HostScope};
use drogon_protocol::orchestration_task::*;
use rusqlite::Connection;
use serde_json::json;

fn host() -> HostScope {
    HostScope {
        contract_version: 1,
        host_id: "host-a".into(),
    }
}

fn scope(run_id: &str) -> CoordinatorScope {
    CoordinatorScope {
        host: host(),
        run_id: run_id.into(),
        coordinator_id: "owner-a".into(),
        consumer_generation: 1,
    }
}

fn database() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    let tx = conn.transaction().unwrap();
    schema::migrate_in_tx(&tx).unwrap();
    tx.commit().unwrap();
    conn
}

fn create_run(tx: &rusqlite::Transaction<'_>, id: &str) {
    runs::create(
        tx,
        &RunCreateParams {
            host: host(),
            objective: "objective".into(),
            coordinator_id: "owner-a".into(),
            caller: None,
        },
        id,
        42,
    )
    .unwrap();
}

fn task_params(id: &str, instructions: &str, depends_on: Vec<String>) -> TaskCreateParams {
    TaskCreateParams {
        scope: scope(id),
        spec: TaskSpec {
            title: Some("title".into()),
            instructions: instructions.into(),
            depends_on,
            parent: None,
            display_name: Some("display".into()),
            metadata: Some(json!({"preserved":true})),
        },
    }
}

fn task_list(run_id: &str, cursor: Option<OpaqueCursor>) -> TaskListParams {
    serde_json::from_value(json!({"contractVersion":1,"hostId":"host-a","runId":run_id,"coordinatorId":"owner-a","consumerGeneration":1,"limit":1,"brief":true,"cursor":cursor})).unwrap()
}

#[test]
fn explicit_takeover_installs_a_different_coordinator_and_fences_prior_owner() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    create_run(&tx, "run-a");
    let mut takeover = RunUseParams {
        caller: None,
        host: host(),
        run_id: "run-a".into(),
        coordinator_id: "owner-b".into(),
        consumer_generation: 1,
        takeover: true,
    };
    let result = runs::use_run(&tx, &takeover).unwrap();
    assert_eq!(result.run.coordinator_id, "owner-b");
    assert_eq!(result.run.consumer_generation, 2);
    assert_eq!(
        runs::require_coordinator(&tx, &scope("run-a"))
            .unwrap_err()
            .code,
        "consumer_fenced"
    );
    assert_eq!(
        runs::use_run(&tx, &takeover).unwrap_err().code,
        "consumer_fenced"
    );
    takeover.consumer_generation = 2;
    takeover.takeover = false;
    assert_eq!(runs::use_run(&tx, &takeover).unwrap().run, result.run);
}

#[test]
fn run_cursor_advances_same_timestamp_rows_without_repeating_or_skipping() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    for id in ["run-a", "run-b", "run-c"] {
        create_run(&tx, id);
    }
    let first = runs::list(
        &tx,
        &RunListParams {
            host: host(),
            limit: Some(1),
            cursor: None,
        },
    )
    .unwrap();
    // Source order is newest-first; identical timestamps walk ids descending.
    assert_eq!(first.runs[0].run_id, "run-c");
    let second = runs::list(
        &tx,
        &RunListParams {
            host: host(),
            limit: Some(1),
            cursor: first.next_cursor,
        },
    )
    .unwrap();
    assert_eq!(second.runs[0].run_id, "run-b");
    let third = runs::list(
        &tx,
        &RunListParams {
            host: host(),
            limit: Some(1),
            cursor: second.next_cursor,
        },
    )
    .unwrap();
    assert_eq!(third.runs[0].run_id, "run-a");
    assert!(third.next_cursor.is_none());
}

#[test]
fn task_cursor_advances_while_brief_and_full_specs_preserve_unicode() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    create_run(&tx, "run-a");
    let text = format!("  hello\n\t{}", "界".repeat(180));
    for id in ["task-a", "task-b"] {
        tasks::create(&tx, &task_params("run-a", &text, vec![]), id, 42).unwrap();
    }
    let first = tasks::list(&tx, &task_list("run-a", None)).unwrap();
    assert_eq!(first.tasks[0].spec.chars().count(), 160);
    assert!(first.tasks[0].spec_truncated);
    assert!(first.tasks[0].spec.starts_with("hello "));
    let second = tasks::list(&tx, &task_list("run-a", first.next_cursor)).unwrap();
    assert_eq!(second.tasks[0].task_id, "task-b");
    let shown = tasks::show(
        &tx,
        &TaskShowParams {
            scope: scope("run-a"),
            task_id: "task-a".into(),
        },
    )
    .unwrap();
    assert_eq!(shown.spec.instructions, text);
    assert_eq!(shown.spec.metadata, Some(json!({"preserved":true})));
}

#[test]
fn any_future_schema_version_refuses_startup_without_partial_tables() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(&format!("CREATE TABLE orchestration_domain_meta(version INTEGER NOT NULL); INSERT INTO orchestration_domain_meta VALUES (1),({});", schema::SCHEMA_VERSION + 1)).unwrap();
    let tx = conn.transaction().unwrap();
    assert!(schema::migrate_in_tx(&tx).is_err());
    let count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='orchestration_runs'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn corrupt_negative_run_generation_is_not_silently_rendered_as_zero() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    create_run(&tx, "run-a");
    tx.execute("UPDATE orchestration_runs SET consumer_generation=-1", [])
        .unwrap();
    assert!(
        runs::show(
            &tx,
            &RunShowParams {
                host: host(),
                run_id: "run-a".into()
            }
        )
        .is_err()
    );
}

#[test]
fn storage_error_does_not_echo_trigger_payload() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    tx.execute_batch("CREATE TRIGGER refuse_run BEFORE INSERT ON orchestration_runs BEGIN SELECT RAISE(FAIL, 'private-sentinel-123'); END;").unwrap();
    let failure = runs::create(
        &tx,
        &RunCreateParams {
            host: host(),
            objective: "objective".into(),
            coordinator_id: "owner-a".into(),
            caller: None,
        },
        "run-a",
        0,
    )
    .unwrap_err();
    assert_eq!(failure.code, "storage_error");
    assert!(!failure.message.contains("private-sentinel-123"));
}

#[test]
fn dependencies_are_deduplicated_and_cross_run_rejection_allocates_nothing() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    create_run(&tx, "run-a");
    create_run(&tx, "run-b");
    tasks::create(&tx, &task_params("run-a", "first", vec![]), "parent", 0).unwrap();
    let child = tasks::create(
        &tx,
        &task_params("run-a", "second", vec!["parent".into(), "parent".into()]),
        "child",
        1,
    )
    .unwrap();
    assert_eq!(child.task.depends_on, vec!["parent"]);
    assert_eq!(child.task.status, TaskStatus::Pending);
    assert!(
        tasks::create(
            &tx,
            &task_params("run-b", "cross", vec!["parent".into()]),
            "cross",
            2
        )
        .is_err()
    );
    let count: i64 = tx
        .query_row("SELECT COUNT(*) FROM orchestration_tasks", [], |r| r.get(0))
        .unwrap();
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
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='orchestration_runs'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn task_cursor_rejects_cross_run_filter_and_family() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    for id in ["run-a", "run-b"] {
        create_run(&tx, id);
    }
    for id in ["task-a", "task-b"] {
        tasks::create(&tx, &task_params("run-a", "text", vec![]), id, 0).unwrap();
    }
    let cursor = tasks::list(&tx, &task_list("run-a", None))
        .unwrap()
        .next_cursor;
    assert_eq!(
        tasks::list(&tx, &task_list("run-b", cursor.clone()))
            .unwrap_err()
            .code,
        "invalid_argument"
    );
    let mut filtered = task_list("run-a", cursor.clone());
    filtered.ready = true;
    assert_eq!(
        tasks::list(&tx, &filtered).unwrap_err().code,
        "invalid_argument"
    );
    assert_eq!(
        runs::list(
            &tx,
            &RunListParams {
                host: host(),
                limit: Some(1),
                cursor
            }
        )
        .unwrap_err()
        .code,
        "invalid_argument"
    );
}

#[test]
fn full_pages_are_bounded_and_resume_every_large_task() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    create_run(&tx, "run-a");
    let instructions = "x".repeat(32_000);
    for index in 0..40 {
        tasks::create(
            &tx,
            &task_params("run-a", &instructions, vec![]),
            &format!("task-{index:03}"),
            42,
        )
        .unwrap();
    }
    let mut params = task_list("run-a", None);
    params.limit = Some(100);
    params.brief = false;
    let mut ids = Vec::new();
    let mut pages = 0;
    loop {
        let result = tasks::list(&tx, &params).unwrap();
        assert!(serde_json::to_vec(&result).unwrap().len() <= 512 * 1024);
        assert!(!result.tasks.is_empty());
        ids.extend(result.tasks.into_iter().map(|task| task.task_id));
        params.cursor = result.next_cursor;
        pages += 1;
        assert!(pages <= 40);
        if params.cursor.is_none() {
            break;
        }
    }
    assert!(pages > 1);
    assert_eq!(
        ids,
        (0..40).map(|i| format!("task-{i:03}")).collect::<Vec<_>>()
    );
}

#[test]
fn corrupt_oversized_first_row_is_refused_instead_of_exceeding_wire_budget() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    create_run(&tx, "run-a");
    tx.execute(
        "UPDATE orchestration_runs SET objective=?1",
        ["x".repeat(600_000)],
    )
    .unwrap();
    assert_eq!(
        runs::list(
            &tx,
            &RunListParams {
                host: host(),
                limit: None,
                cursor: None
            }
        )
        .unwrap_err()
        .code,
        "storage_error"
    );
}

#[test]
fn failed_dependency_does_not_unlock_a_new_child() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    create_run(&tx, "run-a");
    tasks::create(&tx, &task_params("run-a", "parent", vec![]), "parent", 0).unwrap();
    tx.execute(
        "UPDATE orchestration_tasks SET status='failed' WHERE task_id='parent'",
        [],
    )
    .unwrap();
    let child = tasks::create(
        &tx,
        &task_params("run-a", "child", vec!["parent".into()]),
        "child",
        1,
    )
    .unwrap();
    assert_eq!(child.task.status, TaskStatus::Pending);
}

#[test]
fn ignored_takeover_update_cannot_report_success() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    create_run(&tx, "run-a");
    tx.execute_batch("CREATE TRIGGER ignore_takeover BEFORE UPDATE ON orchestration_runs BEGIN SELECT RAISE(IGNORE); END;").unwrap();
    let params = RunUseParams {
        caller: None,
        host: host(),
        run_id: "run-a".into(),
        coordinator_id: "owner-b".into(),
        consumer_generation: 1,
        takeover: true,
    };
    assert_eq!(
        runs::use_run(&tx, &params).unwrap_err().code,
        "consumer_fenced"
    );
    runs::require_coordinator(&tx, &scope("run-a")).unwrap();
}

#[test]
fn completion_unlocks_only_children_with_all_successful_prerequisites() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    create_run(&tx, "run-a");
    for id in ["one", "two"] {
        tasks::create(&tx, &task_params("run-a", id, vec![]), id, 0).unwrap();
    }
    tasks::create(
        &tx,
        &task_params("run-a", "child", vec!["one".into(), "two".into()]),
        "child",
        1,
    )
    .unwrap();
    tasks::set_status_in_tx(&tx, "host-a", "run-a", "one", TaskStatus::Completed).unwrap();
    tasks::set_status_in_tx(&tx, "host-a", "run-a", "two", TaskStatus::Failed).unwrap();
    assert!(tasks::require_completed_dependencies(&tx, "host-a", "run-a", "child").is_err());
    let params = TaskShowParams {
        scope: scope("run-a"),
        task_id: "child".into(),
    };
    assert_eq!(
        tasks::show(&tx, &params).unwrap().task.status,
        TaskStatus::Pending
    );
    tasks::set_status_in_tx(&tx, "host-a", "run-a", "two", TaskStatus::Completed).unwrap();
    tasks::require_completed_dependencies(&tx, "host-a", "run-a", "child").unwrap();
    assert_eq!(
        tasks::show(&tx, &params).unwrap().task.status,
        TaskStatus::Ready
    );
}

#[test]
fn status_updates_are_host_scoped_and_rollback_with_the_report_transaction() {
    let mut conn = database();
    {
        let tx = conn.transaction().unwrap();
        create_run(&tx, "run-a");
        tasks::create(&tx, &task_params("run-a", "task", vec![]), "task", 0).unwrap();
        tx.commit().unwrap();
    }
    {
        let tx = conn.transaction().unwrap();
        assert_eq!(
            tasks::set_status_in_tx(&tx, "foreign", "run-a", "task", TaskStatus::Completed)
                .unwrap_err()
                .code,
            "task_not_found"
        );
        tasks::set_status_in_tx(&tx, "host-a", "run-a", "task", TaskStatus::Completed).unwrap();
        tx.rollback().unwrap();
    }
    let tx = conn.transaction().unwrap();
    assert_eq!(
        tasks::show(
            &tx,
            &TaskShowParams {
                scope: scope("run-a"),
                task_id: "task".into()
            }
        )
        .unwrap()
        .task
        .status,
        TaskStatus::Ready
    );
}

#[test]
fn task_list_reports_label_fields_and_current_attempt_assignee() {
    use drogon_protocol::orchestration_task::TaskStatus;
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    create_run(&tx, "run-a");
    let created = tasks::create(
        &tx,
        &task_params("run-a", "do the work", vec![]),
        "task-a",
        42,
    )
    .unwrap();
    assert_eq!(created.task.title.as_deref(), Some("title"));
    assert_eq!(created.task.display_name.as_deref(), Some("display"));
    let shown = tasks::show(
        &tx,
        &TaskShowParams {
            scope: scope("run-a"),
            task_id: "task-a".into(),
        },
    )
    .unwrap();
    assert_eq!(shown.task.title.as_deref(), Some("title"));
    assert_eq!(shown.task.display_name.as_deref(), Some("display"));

    let params = TaskListParams {
        scope: scope("run-a"),
        brief: false,
        ready: false,
        status: None,
        limit: None,
        cursor: None,
    };
    // No attempts table in a domain-only store: listing still works, with no
    // assignee reported.
    let plain = tasks::list(&tx, &params).unwrap();
    assert_eq!(plain.tasks.len(), 1);
    assert_eq!(plain.tasks[0].title.as_deref(), Some("title"));
    assert_eq!(plain.tasks[0].display_name.as_deref(), Some("display"));
    assert_eq!(plain.tasks[0].assignee_handle, None);
    assert_eq!(plain.tasks[0].dispatch_id, None);

    // A current attempt row exposes its session identity as the assignee.
    tx.execute_batch(
        "CREATE TABLE orchestration_attempts (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            dispatch_id TEXT NOT NULL UNIQUE,
            host_id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            is_current INTEGER NOT NULL,
            fenced INTEGER NOT NULL,
            retry_of TEXT,
            state_json TEXT NOT NULL
        );",
    )
    .unwrap();
    let state = serde_json::json!({
        "result": {"runId": "run-a", "taskId": "task-a", "dispatchId": "dispatch-1",
            "consumerGeneration": 1, "workspaceId": "folder",
            "assignmentState": "ready", "readiness": "notObserved",
            "processVerdict": "live",
            "sessionIdentity": {"sessionId": "sess-9", "incarnation": "1"},
            "effects": [], "residualResources": []},
        "launch": {"harnessId": "claude", "permissionMode": "inherit"},
        "outcome": null, "cleanup_owned": true,
    });
    tx.execute(
        "INSERT INTO orchestration_attempts
         (dispatch_id, host_id, run_id, task_id, is_current, fenced, retry_of, state_json)
         VALUES (?1, ?2, ?3, ?4, 1, 0, NULL, ?5)",
        rusqlite::params!["dispatch-1", "host-a", "run-a", "task-a", state.to_string()],
    )
    .unwrap();
    tasks::set_status_in_tx(&tx, "host-a", "run-a", "task-a", TaskStatus::Dispatched).unwrap();
    let dispatched = tasks::list(&tx, &params).unwrap();
    assert_eq!(dispatched.tasks[0].status, TaskStatus::Dispatched);
    assert_eq!(
        dispatched.tasks[0].assignee_handle.as_deref(),
        Some("sess-9")
    );
    assert_eq!(
        dispatched.tasks[0].dispatch_id.as_deref(),
        Some("dispatch-1")
    );
}
