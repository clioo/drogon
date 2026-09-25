-- Recorded past schema: work component at v4 (auto-import on boards,
-- before the additive v5 collapsed column on work_columns). Carries an
-- imported board with auto-import on, its columns and a ticket, so the
-- v4->v5 step's "add a column, touch nothing else" claim is proven against
-- real prior data.
CREATE TABLE schema_versions (
    component TEXT PRIMARY KEY,
    version INTEGER NOT NULL
);
INSERT INTO schema_versions(component, version) VALUES ('work', 4);
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
    updated_at INTEGER NOT NULL,
    board_id TEXT,
    statuses TEXT NOT NULL DEFAULT '[]'
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
    updated_at INTEGER NOT NULL,
    board_id TEXT, ext_id TEXT, ext_key TEXT, ext_url TEXT, issue_type TEXT, priority TEXT,
    assignee TEXT, ext_status_id TEXT, ext_status_name TEXT, ext_status_category TEXT,
    pending_status_id TEXT, status_conflict INTEGER NOT NULL DEFAULT 0, sprint_id TEXT,
    ext_sprint_id TEXT, push_error TEXT, removed_at INTEGER
);
CREATE INDEX work_tickets_column ON work_tickets(column_id, position);
CREATE TABLE work_ticket_sessions (
    ticket_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    linked_at INTEGER NOT NULL,
    label TEXT,
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
CREATE TABLE work_boards (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    site_id TEXT NOT NULL,
    site_url TEXT NOT NULL DEFAULT '',
    external_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    project_key TEXT,
    project_name TEXT,
    project_id TEXT,
    statuses TEXT NOT NULL DEFAULT '[]',
    last_synced_at INTEGER,
    last_sync_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    auto_import_mine INTEGER NOT NULL DEFAULT 0,
    UNIQUE(provider, site_id, external_id)
);
CREATE TABLE work_sprints (
    board_id TEXT NOT NULL,
    ext_id TEXT NOT NULL,
    name TEXT NOT NULL,
    state TEXT NOT NULL,
    start_at TEXT,
    end_at TEXT,
    position INTEGER NOT NULL,
    PRIMARY KEY(board_id, ext_id)
);
CREATE TABLE work_ticket_sprints (
    ticket_id TEXT NOT NULL,
    sprint_id TEXT NOT NULL,
    status_name TEXT,
    first_seen_at INTEGER NOT NULL,
    PRIMARY KEY(ticket_id, sprint_id)
);
CREATE TABLE work_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    at INTEGER NOT NULL
);
CREATE INDEX work_activity_ticket ON work_activity(ticket_id, at);
CREATE INDEX work_tickets_board ON work_tickets(board_id, sprint_id);
CREATE INDEX work_columns_board ON work_columns(board_id, position);
INSERT INTO work_columns (id, name, icon, position, send_on_enter, message, created_at, updated_at)
VALUES ('col-review', 'Review', 'review', 0, 1, 'Review {ticket.id}', 1, 1);
INSERT INTO work_tickets (id, key, column_id, position, title, pr_number, created_at, updated_at)
VALUES ('tkt-seed', 'DRG-41', 'col-review', 0, 'Improve Jira resume', 648, 1, 1);
INSERT INTO work_ticket_sessions (ticket_id, session_id, linked_at) VALUES ('tkt-seed', 'sess-seed', 1);
INSERT INTO work_key_counters (prefix, next) VALUES ('DRG', 42);
INSERT INTO work_sends (column_id, ticket_id, trigger, message, results, at)
VALUES ('col-review', 'tkt-seed', 'enter', 'Review DRG-41', '[]', 2);
INSERT INTO work_boards (id, provider, site_id, site_url, external_id, name, kind, statuses, created_at, updated_at)
VALUES ('board-seed', 'jira', 'site-1', 'https://example.atlassian.net', '7', 'Platform Delivery', 'scrum',
  '[{"id":"10100","name":"In Review","category":"indeterminate"}]', 1, 1);
INSERT INTO work_columns (id, name, icon, position, board_id, statuses, created_at, updated_at)
VALUES ('col-jira-review', 'Review', 'review', 0, 'board-seed', '[{"id":"10100","name":"In Review","category":"indeterminate"}]', 1, 1);
INSERT INTO work_tickets (id, key, column_id, position, title, created_at, updated_at, board_id, ext_key, ext_status_id, ext_status_name)
VALUES ('tkt-jira', 'DRG-42', 'col-jira-review', 0, 'Handle session resume', 1, 1, 'board-seed', 'APP-128', '10100', 'In Review');
INSERT INTO work_activity (ticket_id, kind, text, at) VALUES ('tkt-jira', 'imported', 'Imported APP-128 from Jira (In Review)', 1);
CREATE TABLE work_sources (
    provider TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    api_url TEXT,
    site_url TEXT,
    account TEXT,
    updated_at INTEGER NOT NULL
);
INSERT INTO work_sources (provider, enabled, account, updated_at) VALUES ('github', 0, 'octo', 1);
UPDATE work_boards SET auto_import_mine = 1 WHERE id = 'board-seed';
