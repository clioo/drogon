-- Recorded past shape: a store that
-- was already opened by some intermediate build after Projects landed
-- (c2deb28) but before the pre-Projects recovery existed -- schema_versions
-- already records "projects" at v3, with a real v3-shaped project already
-- registered, PLUS a `workspaces` row left over from before ANY of that
-- build's Projects existed (the original dc12c7a-era registration), which
-- that intermediate build never recovered. Proves the recovery must run on
-- the `Some(3)` arm too, not only the fresh "no recorded version" branch.
CREATE TABLE schema_versions (
    component TEXT PRIMARY KEY,
    version INTEGER NOT NULL
);
INSERT INTO schema_versions(component, version) VALUES ('projects', 3);
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    default_base_ref TEXT,
    created_at TEXT NOT NULL,
    setup_script TEXT,
    quick_session INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE worktrees (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL UNIQUE,
    path TEXT NOT NULL UNIQUE,
    branch TEXT NOT NULL,
    head TEXT NOT NULL,
    base_ref TEXT,
    created_at TEXT NOT NULL,
    title TEXT,
    note TEXT,
    parent_worktree_id TEXT
);
CREATE INDEX worktrees_project ON worktrees(project_id);
CREATE TABLE sparse_presets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    directories_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(project_id, name)
);
CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    host_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);
-- The store's own, already-v3, real project + its implicit workspace.
INSERT INTO projects(id, host_id, path, name, kind, default_base_ref, created_at, setup_script, quick_session)
VALUES ('proj-v3-seed', 'host-v3', '/tmp/seed-v3-repo', 'seed-v3-repo', 'git', NULL,
        '2026-06-01T00:00:00Z', NULL, 0);
INSERT INTO worktrees(id, project_id, workspace_id, path, branch, head, base_ref, created_at, title, note, parent_worktree_id)
VALUES ('wt-v3-seed', 'proj-v3-seed', 'ws-v3-seed', '/tmp/seed-v3-repo', 'main', 'abc123', NULL,
        '2026-06-01T00:01:00Z', NULL, NULL, NULL);
INSERT INTO workspaces(id, path, name, kind, host_id, created_at)
VALUES ('ws-v3-seed', '/tmp/seed-v3-repo', 'seed-v3-repo', 'git', 'host-v3', '2026-06-01T00:01:00Z');
-- The orphan: registered by the ORIGINAL pre-Projects daemon, long before
-- this store's own Projects launch, and never recovered by the
-- intermediate build that first wrote the v3 rows above.
INSERT INTO workspaces(id, path, name, kind, host_id, created_at)
VALUES ('ws-orphan', '/tmp/seed-orphan-in-v3-store', 'orphan-in-v3-store', 'folder', 'host-v3',
        '2026-01-01T00:00:00Z');
