# Data-dir upgrade safety: every persisted store, its versioning, and what an upgrade does

Reference for R16-BP. Carlos installs a new sealed Drogon build over his live
data dir several times a day; this document inventories every store that
survives such an install, how each is versioned, and the guarantees the
daemon and desktop make around upgrade and downgrade. The Rust gates live in
`crates/drogon-core/tests/upgrade_safety.rs` (fixtures under
`crates/drogon-core/tests/fixtures/upgrades/`) and
`crates/drogond/tests/downgrade_refusal.rs`.

## 1. The two directories

| Directory | Who writes it | Contents |
|---|---|---|
| **Daemon data dir** — `~/Library/Application Support/Drogon` (macOS), `%APPDATA%\Drogon`, `$XDG_DATA_HOME/drogon`; overridden by `DROGON_DATA_DIR` | `drogond` | SQLite state, shims, hook overlays, Mentu runtime, pre-migration backups |
| **Electron userData** — the app's `userData` (overridden by `DROGON_ELECTRON_PROFILE`) | desktop main + renderer | Window state, notification toggle, renderer localStorage (settings, browser keys) |

Both survive an app install; only the daemon ever mutates the first and only
the app mutates the second.

## 2. SQLite store: `<data-dir>/drogon.sqlite3` (+ `-wal`/`-shm`)

One host-owned database, WAL mode, opened by `Engine::open`
(`crates/drogon-core/src/lib.rs`). Schema changes run inside
`db::migrate_and_recover`'s single rollback-safe startup transaction: either
every component's migration commits together, or nothing changes.

Per-component versioning lives in the shared `schema_versions` table
`(component TEXT PRIMARY KEY, version INTEGER NOT NULL)`. A build refuses —
without creating or altering any table — any recorded version **newer** than
the one it supports (downgrade guard), and steps recorded versions
**forward** one step at a time (upgrade path). Current components:

| `schema_versions` component | Current version | Tables | Past versions |
|---|---|---|---|
| `automations` | 2 | `automations`, `automation_runs` | v1 (fixture `automations-v1.sql`): v2 adds the composite runs index |
| `bots` | 3 | `bots`, `bot_responsibility_runs`, `bot_messages` | v1 (`bots-v1.sql`): v2 adds `rev` + dedupe index, v3 adds `bot_messages` |
| `projects` | 2 | `projects`, `worktrees` | v1 (`projects-v1.sql`): v2 adds the nullable `worktrees.title` |
| `mentu` | 1 | `mentu_approvals`, `mentu_runs` | released at v1 |
| `coordination_access` | 1 | dispatch/access tables | released at v1 |
| `orchestration_mail` | 1 | `orchestration_mail_messages`, read pointers, deliveries, questions | released at v1 |
| `orchestration_attempts` | 1 | `orchestration_attempts` | released at v1 |

Main-schema tables (`meta`, `workspaces`, `sessions`, `requests`) have no
`schema_versions` row; their additive column migrations (`sessions.harness_id`,
`sessions.needs_input_at`) are detected structurally
(`pragma_table_info`), migrate idempotently, and are covered by
`main-schema-v1.sql`. Orchestration runs/tasks/dispatches live under
`drogon_orchestration::schema` (v1).

## 3. Pre-migration backup (`<data-dir>/backups/pre-migration-<unix-ms>/`)

The first time a newer build opens an older data dir — `db::migrate_and_recover`
detects any pending forward migration before its transaction opens — the
daemon snapshots the whole database with `VACUUM INTO` (consistent single
file, WAL included, legal outside a transaction) into
`backups/pre-migration-<unix-ms>/drogon.sqlite3` plus a `manifest.json`
(kind, created_at, data dir, build version, and the exact pending
component → version steps). The three newest backups are retained; older
ones are pruned. Backup failure never blocks startup (migrations are
additive and rollback-safe); it degrades to a loud stderr line. Reopening an
already-current dir never creates a backup; a *refused* (downgrade) open
never creates one either.

## 4. Downgrade refusal (old build over new data dir)

Every versioned component refuses a future version before touching tables;
refusals carry the uniform marker `… schema version N is newer than the M
this build supports; refusing to modify it`, and `drogond`'s bootstrap
(`open_engine_naming_data_dir`) appends `(data dir: <path>)`. The desktop
bootstrap (`native-runtime-bootstrap.ts`) captures the spawned daemon's
stderr, classifies the marker, and reports `spawned-then-refused`; the
renderer renders the full-window downgrade dialog
(`features/shell/DataDirRefusalOverlay.tsx`) naming the data dir and the
recovery paths: reopen the previous build (the installer preserves it at
`/Applications/Drogon.app.previous`) or restore the newest
`backups/pre-migration-*`. The refused build exits before migrating
anything — the directory is untouched.

## 5. Non-SQLite stores under the daemon data dir

| Store | Path | Versioned? | Upgrade behavior |
|---|---|---|---|
| `drogon-cli` / `drogon` shims | `<data-dir>/bin/` | no | reinstalled by every `Engine::open` (idempotent) |
| Harness hook overlays | `<data-dir>/harness-hooks/<harness>/<nonce>/` | no | per-session, nonce-scoped, cleaned up with the session; a newer build simply writes new nonces |
| Mentu runtime | `<data-dir>/mentu/runtime/` | sha-verified on install | `mentu.runtime_install` verifies the pinned sha before swapping; a newer build provisions only if the hash differs |
| Pre-migration backups | `<data-dir>/backups/pre-migration-*/` | n/a (manifest) | see §3 |
| Session scrollback | in-memory only (`ring.rs`, 1 MiB/session) | n/a | daemon-owned PTYs die with the daemon by design; session *records* (sqlite) restore verdict/state across restart |

## 6. Electron userData stores

| Store | Path | Versioning | Upgrade behavior |
|---|---|---|---|
| Renderer settings | localStorage `drogon:settings:<namespace>` | layered defaults < persisted < migration stamps (`settings-store.ts`) | keys are additive; unknown persisted keys are ignored, new defaults fill gaps |
| Browser keys (open-links-in-app, recent URLs per workspace) | localStorage | no | self-healing reads |
| Window bounds | `userData/window-state.json` | guarded parser | unreadable → first-launch defaults |
| Notifications toggle | `userData/notifications.json` | fail-open parser | corrupt → default on |
| Build info | `userData/build-info.json` | informational | rewritten per launch |
| Git/usage credential *reads* (`~/.claude/.credentials.json` etc.) | outside the data dir | n/a | never written by Drogon |

Settings key renames are migrations in the renderer store's own sense
(migration stamps), not daemon schema changes; the daemon never reads
localStorage.

## 7. What an install does and does not touch

An app install replaces binaries only. The data dir is opened on next
launch; forward migrations + backup run then. Nothing in the upgrade path
deletes rows: every migration so far is `ADD COLUMN` / `CREATE TABLE|INDEX`
/ backfill-default, and the aggregate transaction cannot leave a half-built
schema behind.
