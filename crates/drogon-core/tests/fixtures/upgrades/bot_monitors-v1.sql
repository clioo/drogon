-- Recorded past schema: bot_monitors component at v1 (the frozen
-- `local_file_digest.v1` checkpoint, before the additive v2 rule kinds).
-- Shape mirrors the v1 `bots::monitors::storage::create_tables`; it carries
-- one already-approved local-file monitor row whose canonical rule bytes
-- must still hash to the stored `approvedRuleHash` after the 1→2 bump.
CREATE TABLE schema_versions (
    component TEXT PRIMARY KEY,
    version INTEGER NOT NULL
);
INSERT INTO schema_versions(component, version) VALUES ('bot_monitors', 1);
CREATE TABLE bot_monitors (
    id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    bot_id TEXT,
    updated_at REAL NOT NULL,
    rev INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL
);
CREATE INDEX bot_monitors_scope ON bot_monitors(host_id, project_id);
CREATE TABLE bot_monitor_checks (
    id TEXT PRIMARY KEY,
    monitor_id TEXT NOT NULL,
    started_at REAL NOT NULL,
    payload_json TEXT NOT NULL
);
CREATE INDEX bot_monitor_checks_monitor_id ON bot_monitor_checks(monitor_id);
INSERT INTO bot_monitors(id, host_id, project_id, bot_id, updated_at, rev, payload_json)
VALUES (
    'mon-legacy',
    'host-1',
    'proj-1',
    'bot-seed',
    1.0,
    0,
    '{"id":"mon-legacy","botId":"bot-seed","version":1,"rule":{"kind":"local_file_digest.v1","hostId":"host-1","projectId":"proj-1","resource":"notes/status.md","maxBytes":65536},"interpreter":null,"argv":[],"secretRefs":[],"trigger":{"kind":"manual"},"cursor":null,"enabled":true,"approvedRuleHash":"553e84cd57b5281aa064c2a2857f82153ce4b11c660fb70600a831f6de1cbf8f","createdAtMs":1.0,"updatedAtMs":1.0,"consecutiveErrors":0,"nextEligibleAtMs":null,"lastEventId":null,"lastSuccessAtMs":null,"lastError":null}'
);
