CREATE TABLE schema_versions (component TEXT PRIMARY KEY, version INTEGER NOT NULL);
INSERT INTO schema_versions(component, version) VALUES ('orchestration_mail', 1);
CREATE TABLE orchestration_mail_messages (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE,
    host_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    from_kind TEXT NOT NULL,
    from_coordinator_id TEXT,
    from_dispatch_id TEXT,
    to_dispatch_id TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL,
    body TEXT,
    payload_json TEXT,
    thread_id TEXT NOT NULL,
    origin_request_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);
INSERT INTO orchestration_mail_messages
    (message_id, host_id, run_id, kind, from_kind, to_dispatch_id, subject, body, thread_id, origin_request_id, created_at)
    VALUES ('msg-v1', 'host-fixture', 'run-fixture', 'status', 'coordinator', '', 'v1 message', 'survives the upgrade', 'thread-1', 'req-1', '2026-01-01T00:00:00Z');
CREATE TABLE orchestration_mail_read_pointers (
    host_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    to_dispatch_id TEXT NOT NULL DEFAULT '',
    read_through_sequence INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (host_id, run_id, to_dispatch_id)
);
CREATE TABLE orchestration_mail_deliveries (
    delivery_id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    to_dispatch_id TEXT NOT NULL DEFAULT '',
    consumer_coordinator_id TEXT,
    consumer_generation INTEGER,
    message_ids_json TEXT NOT NULL,
    max_sequence INTEGER NOT NULL,
    acknowledged INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE orchestration_mail_questions (
    question_message_id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    closed INTEGER NOT NULL DEFAULT 0,
    closed_reason TEXT,
    answer_message_id TEXT,
    answer_body TEXT,
    answer_origin_request_id TEXT
);
