-- Recorded past schema: work component at v1 (the local board only, before
-- the additive v2 imported-board tables and columns). Carries a column with
-- a prompt, a ticket with a linked session and a recorded send, so the
-- v1->v2 step's "add tables and nullable columns, touch nothing else" claim
-- is proven against real prior data.
CREATE TABLE schema_versions (
    component TEXT PRIMARY KEY,
    version INTEGER NOT NULL
);
INSERT INTO schema_versions(component, version) VALUES ('work', 1);
CREATE TABLE work_columns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    position INTEGER NOT NULL,
    send_on_enter INTEGER NOT NULL DEFAULT 0,
    cron TEXT,
    pr_watch INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    recipients TEXT NOT NULL DEFAULT 'all',
    harness_id TEXT,
    next_run_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE work_tickets (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    project_id TEXT,
    workspace_id TEXT,
    column_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    pr_url TEXT,
    pr_number INTEGER,
    source_url TEXT,
    next_step TEXT NOT NULL DEFAULT '',
    pr_fingerprint TEXT,
    pr_checked_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX work_tickets_column ON work_tickets(column_id, position);
CREATE TABLE work_ticket_sessions (
    ticket_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    linked_at INTEGER NOT NULL,
    PRIMARY KEY(ticket_id, session_id)
);
CREATE INDEX work_ticket_sessions_session ON work_ticket_sessions(session_id);
CREATE TABLE work_key_counters (
    prefix TEXT PRIMARY KEY,
    next INTEGER NOT NULL
);
CREATE TABLE work_sends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    column_id TEXT,
    ticket_id TEXT NOT NULL,
    trigger TEXT NOT NULL,
    message TEXT NOT NULL,
    results TEXT NOT NULL,
    at INTEGER NOT NULL
);
CREATE INDEX work_sends_column ON work_sends(column_id, at);
CREATE INDEX work_sends_ticket ON work_sends(ticket_id, at);
INSERT INTO work_columns (id, name, icon, position, send_on_enter, message, created_at, updated_at)
VALUES ('col-review', 'Review', 'review', 0, 1, 'Review {ticket.id}', 1, 1);
INSERT INTO work_tickets (id, key, column_id, position, title, pr_number, created_at, updated_at)
VALUES ('tkt-seed', 'DRG-41', 'col-review', 0, 'Improve Jira resume', 648, 1, 1);
INSERT INTO work_ticket_sessions (ticket_id, session_id, linked_at) VALUES ('tkt-seed', 'sess-seed', 1);
INSERT INTO work_key_counters (prefix, next) VALUES ('DRG', 42);
INSERT INTO work_sends (column_id, ticket_id, trigger, message, results, at)
VALUES ('col-review', 'tkt-seed', 'enter', 'Review DRG-41', '[]', 2);
