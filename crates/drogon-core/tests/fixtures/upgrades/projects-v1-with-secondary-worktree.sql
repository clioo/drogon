-- Regression fixture: a v1-schema project with a SECOND (non-primary)
-- worktree, each worktree owning its own `workspaces` row. The secondary
-- worktree's workspace path never matches `projects.path` (only the
-- primary checkout's does), so the pre-Projects-orphan backfill must NOT
-- mistake it for an orphan -- it is already correctly wired via the
-- `worktrees` table (worktrees existed even at v1). Reproduces a real
-- regression: without excluding `workspaces.id` already referenced by
-- `worktrees.workspace_id`, the backfill inserted a colliding second
-- project+worktree for this exact path (UNIQUE constraint on
-- worktrees.path).
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
CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    host_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);
INSERT INTO projects(id, host_id, path, name, kind, default_base_ref, created_at)
VALUES ('proj-seed', 'host-seed', '/tmp/seed-repo', 'seed-repo', 'git', NULL,
        '2026-09-08T00:00:00Z');
INSERT INTO workspaces(id, path, name, kind, host_id, created_at)
VALUES ('ws-secondary', '/tmp/seed-repo-secondary-wt', 'secondary-wt', 'git',
        'host-seed', '2026-09-08T00:01:00Z');
INSERT INTO worktrees(id, project_id, workspace_id, path, branch, head, base_ref, created_at)
VALUES ('wt-secondary', 'proj-seed', 'ws-secondary', '/tmp/seed-repo-secondary-wt',
        'feature', 'def456', NULL, '2026-09-08T00:01:00Z');
