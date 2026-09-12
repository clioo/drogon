-- Recorded past schema: bot_delegation component at v2 (the outbox +
-- firing-evidence checkpoint, before the additive v3 `resource` column
-- on the firing evidence). Shape mirrors the v2
-- `bots::delegation::create_tables`; it carries one settled firing row
-- whose resource must read NULL after the 2→3 bump — never a fabricated
-- case for evidence written before the column existed.
CREATE TABLE schema_versions (
    component TEXT PRIMARY KEY,
    version INTEGER NOT NULL
);
INSERT INTO schema_versions(component, version) VALUES ('bot_delegation', 2);
CREATE TABLE bot_delegation_daily (
    bot_id TEXT NOT NULL,
    day_utc INTEGER NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (bot_id, day_utc)
);
CREATE TABLE bot_monitor_firings (
    event_id TEXT PRIMARY KEY,
    monitor_id TEXT NOT NULL,
    bot_id TEXT,
    responsibility_id TEXT,
    outcome TEXT NOT NULL,
    run_id TEXT,
    detail TEXT,
    at_ms REAL NOT NULL
);
INSERT INTO bot_monitor_firings
    (event_id, monitor_id, bot_id, responsibility_id, outcome, run_id, detail, at_ms)
VALUES (
    'mev_legacy',
    'mon-legacy',
    'bot-seed',
    'resp-1',
    'dispatched',
    'run-legacy',
    NULL,
    1.0
);
