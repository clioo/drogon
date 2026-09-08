-- Recorded past schema: bots component at v1 (before the `rev` CAS column
-- and the bot_responsibility_runs dedupe index). Shape mirrors
-- `bots::storage::create_v1_tables` at the time v1 was current.
CREATE TABLE schema_versions (
    component TEXT PRIMARY KEY,
    version INTEGER NOT NULL
);
INSERT INTO schema_versions(component, version) VALUES ('bots', 1);
CREATE TABLE bots (
    id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    folder TEXT NOT NULL,
    updated_at REAL NOT NULL,
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
INSERT INTO bots(id, host_id, folder, updated_at, payload_json)
VALUES ('bot-seed', 'host-seed', '/tmp/seed-folder', 1788866209.0,
        '{"id":"bot-seed","name":"Seed Bot","folder":"/tmp/seed-folder"}');
INSERT INTO bot_responsibility_runs(id, bot_id, automation_run_id, started_at, payload_json)
VALUES ('run-seed', 'bot-seed', NULL, 1788866210.0, '{"seed":true}');
