-- Recorded past schema: projects component at v1 (worktrees without the
-- display-title column added by `worktree.rename`). Shape mirrors
-- `project::create_v1_tables`.
CREATE TABLE schema_versions (
    component TEXT PRIMARY KEY,
    version INTEGER NOT NULL
);
INSERT INTO schema_versions(component, version) VALUES ('projects', 1);
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    default_base_ref TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE worktrees (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL UNIQUE,
    path TEXT NOT NULL UNIQUE,
    branch TEXT NOT NULL,
    head TEXT NOT NULL,
    base_ref TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX worktrees_project ON worktrees(project_id);
INSERT INTO projects(id, host_id, path, name, kind, default_base_ref, created_at)
VALUES ('proj-seed', 'host-seed', '/tmp/seed-repo', 'seed-repo', 'git', NULL,
        '2026-09-08T00:00:00Z');
INSERT INTO worktrees(id, project_id, workspace_id, path, branch, head, base_ref, created_at)
VALUES ('wt-seed', 'proj-seed', 'ws-seed', '/tmp/seed-wt', 'main', 'abc123', NULL,
        '2026-09-08T00:01:00Z');
