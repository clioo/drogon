-- Recorded past schema: a data dir written by a daemon from before the
-- Projects feature existed (dc12c7a and earlier -- project.rs was added
-- later, in c2deb28). Only `workspaces` (db.rs's `create_tables`, always
-- created directly, never through schema_versions) is populated; no
-- `projects`/`worktrees` tables and no "projects" schema_versions row.
-- Shape mirrors what `workspace::register` alone ever wrote.
CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    host_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);
INSERT INTO workspaces(id, path, name, kind, host_id, created_at)
VALUES ('ws-old-folder', '/tmp/seed-old-folder', 'old-folder', 'folder',
        'host-old', '2026-01-01T00:00:00Z');
-- A pre-existing git-kind workspace must NOT be backfilled into `projects`:
-- only folder projects ever registered their own path as a Workspace
-- (`project::add`'s doc comment); a git Workspace row without an owning
-- Project would be an invented project the user never registered.
INSERT INTO workspaces(id, path, name, kind, host_id, created_at)
VALUES ('ws-old-git-worktree', '/tmp/seed-old-git-worktree', 'old-git-worktree',
        'git', 'host-old', '2026-01-01T00:02:00Z');
