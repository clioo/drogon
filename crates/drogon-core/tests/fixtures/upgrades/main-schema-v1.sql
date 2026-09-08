-- Recorded past schema: main schema before the additive sessions columns
-- (`harness_id`, `needs_input_at`). Shape mirrors db.rs `create_tables`
-- before those migrations existed.
CREATE TABLE schema_versions (
    component TEXT PRIMARY KEY,
    version INTEGER NOT NULL
);
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    host_id TEXT NOT NULL,
    incarnation TEXT NOT NULL,
    command TEXT NOT NULL,
    args_json TEXT NOT NULL,
    cols INTEGER NOT NULL,
    rows INTEGER NOT NULL,
    verdict TEXT NOT NULL,
    exit_code INTEGER,
    created_at TEXT NOT NULL
);
INSERT INTO sessions(id, workspace_id, host_id, incarnation, command, args_json,
                     cols, rows, verdict, exit_code, created_at)
VALUES ('sess-seed', 'ws-seed', 'host-seed', 'inc-1', '/bin/sh', '["-l"]',
        80, 24, 'exited', 0, '2026-09-08T00:00:00Z');
