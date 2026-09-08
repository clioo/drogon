-- Recorded past schema: bots component at v2 (after `rev`, before the
-- bot_messages table). Shape mirrors `bots::storage::create_v2_tables`.
CREATE TABLE schema_versions (
    component TEXT PRIMARY KEY,
    version INTEGER NOT NULL
);
INSERT INTO schema_versions(component, version) VALUES ('bots', 2);
CREATE TABLE bots (
    id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    folder TEXT NOT NULL,
    updated_at REAL NOT NULL,
    rev INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL
);
CREATE INDEX bots_scope ON bots(host_id, folder);
CREATE TABLE bot_responsibility_runs (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL,
    automation_run_id TEXT,
    started_at REAL NOT NULL,
    payload_json TEXT NOT NULL
);
CREATE INDEX bot_responsibility_runs_bot_id ON bot_responsibility_runs(bot_id);
CREATE UNIQUE INDEX bot_responsibility_runs_dedupe
    ON bot_responsibility_runs(bot_id, automation_run_id)
    WHERE automation_run_id IS NOT NULL;
INSERT INTO bots(id, host_id, folder, updated_at, rev, payload_json)
VALUES ('bot-seed', 'host-seed', '/tmp/seed-folder', 1788866209.0, 7,
        '{"id":"bot-seed","name":"Seed Bot","folder":"/tmp/seed-folder"}');
