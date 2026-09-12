-- Recorded past schema: graph component at v1 (the node-run launch
-- ledger, before the additive v2 Subagent-policy failover-attempt table).
-- Carries one recorded launch so the v1->v2 step's "add a table, touch
-- nothing else" claim is proven against real prior data, not only a
-- fresh install.
CREATE TABLE schema_versions (
    component TEXT PRIMARY KEY,
    version INTEGER NOT NULL
);
INSERT INTO schema_versions(component, version) VALUES ('graph', 1);
CREATE TABLE graph_node_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_label TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX graph_node_runs_lookup
    ON graph_node_runs(workspace_id, node_id, id);
INSERT INTO graph_node_runs (workspace_id, node_id, run_id, step_label, created_at)
VALUES ('ws-legacy', 'n1', 'run-legacy', 'n1', '2026-01-01T00:00:00Z');
