-- Recorded past schema: automations component at v1 (before the composite
-- runs index). Shape mirrors `automations::storage::create_v1_tables`.
CREATE TABLE schema_versions (
    component TEXT PRIMARY KEY,
    version INTEGER NOT NULL
);
INSERT INTO schema_versions(component, version) VALUES ('automations', 1);
CREATE TABLE automations (
    id TEXT PRIMARY KEY,
    bot_id TEXT,
    payload_json TEXT NOT NULL
);
CREATE INDEX automations_bot_id ON automations(bot_id);
CREATE TABLE automation_runs (
    id TEXT PRIMARY KEY,
    automation_id TEXT NOT NULL,
    payload_json TEXT NOT NULL
);
CREATE INDEX automation_runs_automation_id ON automation_runs(automation_id);
INSERT INTO automations(id, bot_id, payload_json)
VALUES ('auto-seed', NULL, '{"id":"auto-seed","name":"Seed Automation"}');
INSERT INTO automation_runs(id, automation_id, payload_json)
VALUES ('aurec-seed', 'auto-seed', '{"id":"aurec-seed"}');
