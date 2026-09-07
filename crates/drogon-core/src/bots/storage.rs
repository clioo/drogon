//! SQLite storage for native `Bot` records, their responsibilities and
//! responsibility-run history, joining the same connection/transaction as
//! `automations::storage` -- never a second database authority or a
//! Bot-only shadow of the global automation records. The standalone
//! [`migrate`] keeps its per-step-committing behavior, while the aggregate
//! `Engine::open` startup applies these same steps through
//! `db::migrate_and_recover`'s single rollback-safe transaction (see
//! `docs/migration/bot-state-admission.md`).
//!
//! ## Host/folder scope
//!
//! Every Bot is scoped to a `(host_id, folder)` pair; every **user-facing**
//! read/write function (`get_bot`, `list_bots`, `update_bot`,
//! `rotate_session`, `create_bot`, `delete_bot`,
//! `create_scheduled_responsibility`, `record_responsibility_run`,
//! `history_for_bot`, `migrate_ownership`) takes that scope explicitly and
//! never reads or mutates across it -- "no cross-host reads" from the
//! contract. [`delete_automation_everywhere`] is the one deliberate
//! exception: see its doc for why a *global* entity's cleanup cannot stay
//! scoped without leaving dangling projections behind in other scopes.
//!
//! ## Locale-aware display-name ordering
//!
//! [`list_bots`] takes an explicit `host_locale` BCP-47 tag and sorts with
//! [`crate::locale_ordering::sort_by_display_name_stable`] (real ICU4X
//! collation, ported from the source's
//! `displayName.localeCompare()` at
//! `src/main/persistence/loading-store/bot-persistence.ts:47` -- see
//! `docs/migration/native-locale-ordering.md`). This module never chooses
//! a default locale itself: an invalid/unsupported tag is a returned
//! [`StorageError::LocaleOrdering`], never a silent binary-sort fallback.
//! Root owns discovering/binding the actual per-host default locale value
//! before integrated (production) list callers exist; this function only
//! accepts whatever locale it is given.
//!
//! ## Cross-connection contention (bounded correction, see native-state
//! evidence)
//!
//! [`update_bot`]/[`rotate_session`]/[`create_scheduled_responsibility`]/
//! [`delete_automation_everywhere`]/[`migrate_ownership`] use optimistic
//! concurrency via a dedicated `rev` column -- **not** `updated_at`.
//! `updated_at` stays a purely source-visible domain timestamp (preserved
//! byte-for-byte, never read back for concurrency control); `rev` is an
//! internal `INTEGER` that this module increments by exactly 1 on every
//! successful write (`rev = rev + 1 WHERE ... AND rev = <snapshot>`). A
//! second connection racing the same row observes zero affected rows and
//! gets [`StorageError::StaleUpdate`].
//!
//! An earlier revision of this fence used `updated_at` itself as the CAS
//! discriminant. That is a real bug, not just a style choice: if two
//! connections compute the *same* new `updated_at` value (a deterministic
//! clock in tests, or two writes landing in the same clock tick in
//! production), the first write leaves the guard column's *value*
//! unchanged (new == old == that timestamp), so a second connection still
//! holding that same stale snapshot passes the `WHERE updated_at =
//! <snapshot>` check and silently clobbers the first write instead of
//! being rejected. `rev` cannot collide this way: it is unconditionally
//! `+1` on every write regardless of what timestamp value is supplied, so
//! two writes can never share a "new == old" blind spot. See
//! `cas_write_detects_a_same_timestamp_two_connection_clobber_race` in the
//! tests for the exact scenario this replaces.
//!
//! ## Run history scope fence (P2-1)
//!
//! [`history_for_bot`] fences returned rows to the resolved `(host_id,
//! folder)` scope of its `bot_id` lookup, on top of the plain `WHERE bot_id
//! = ?` query: `bots.id` is a global PRIMARY KEY, and [`delete_bot`]
//! deliberately preserves a deleted Bot's prior runs as orphaned evidence
//! rather than deleting them, so a freed id later reused by [`create_bot`]
//! in a *different* folder must not silently reattach the earlier folder's
//! runs to the new Bot (see P2-1,
//! `docs/migration/verticals/V5/bot-snapshot-review.md`). The fence is an
//! additive JSON stamp inside the existing `payload_json` blob (the
//! storage-internal `StoredRun` envelope below, never a schema/migration
//! change): every row [`record_responsibility_run`] writes after this
//! fence carries its writing `(host_id, folder)`; a row whose stamp does
//! not match the caller's resolved scope is excluded from the returned
//! history but left untouched on disk -- still visible to a caller who
//! queries with its actual original scope, still present for direct
//! row-count evidence. A row written before this fence existed carries no
//! stamp (`scope_host`/`scope_folder` both `None` via `#[serde(default)]`)
//! and stays visible under any bot_id match, exactly like the pre-fence
//! behavior -- its true original scope was never recorded and cannot be
//! reconstructed, so this fence only closes the exposure for rows written
//! after it exists. [`create_bot`]'s create-deny fence below closes the
//! *write* side of this same exposure going forward: it stops a freed id
//! from ever being reused at all, in any scope.
//!
//! ## Create-deny fence (W1)
//!
//! [`create_bot`] refuses to INSERT a new Bot whose `id` already names any
//! row in `bot_responsibility_runs` -- stamped or not, same scope as the
//! create attempt or a different one -- with [`StorageError::BotIdCollision`].
//! A retained run's true origin (whether it predates the scope stamp,
//! whether it was written under the exact scope now attempting the
//! recreate, or under a different one entirely) is not reliably
//! distinguishable from this check's vantage point, so this is
//! deliberately coarse: even a same-scope recreate of a just-deleted Bot is
//! denied, not only a cross-scope one. Callers must mint a new id for the
//! recreated Bot; this is what actually prevents the id-reuse reattachment
//! risk the read-side fence above only excludes at query time, never
//! deletes.
//!
//! ## Partial scope stamp (W2)
//!
//! [`upsert_run_row`] (via [`record_responsibility_run`]) always writes
//! `scope_host`/`scope_folder` together, never just one -- so a
//! [`StoredRun`] envelope carrying exactly one of the two cannot be a
//! genuine row from this module's own write path. Both [`history_for_bot`]
//! and [`record_responsibility_run`]'s dedup merge (see below) fail closed
//! with [`StorageError::PartialScopeStamp`] on this shape rather than
//! guessing whether it means "legacy" (both `None`) or "scoped" (both
//! `Some`).
//!
//! ## Dedup restamp guard (W3)
//!
//! [`record_responsibility_run`]'s merge-on-`(bot_id, automation_run_id)`
//! path never blindly re-stamps the row it merges onto with the calling
//! scope:
//!
//! - an existing **fully-stamped** row whose `(scope_host, scope_folder)`
//!   does not match this call's `(host_id, folder)` refuses the whole
//!   write with [`StorageError::OwnershipViolation`] -- the merge never
//!   happens and the existing row is left completely untouched;
//! - an existing **unstamped** (legacy) row stays unstamped after a merge,
//!   even though the calling scope is always concretely known --
//!   attaching a stamp here would launder a legacy row into a scope it was
//!   never actually proven to belong to, merely because some caller later
//!   replayed its `automation_run_id`.
//!
//! Residual limitation, stated honestly rather than silently narrowed: a
//! database that, before this guard (and the create-deny fence above)
//! existed, already accumulated two *separate* unstamped rows for the same
//! reused bot id -- one written while that id lived in scope A with its
//! own runs, one after an (also pre-fence) recreate of that same id in
//! scope B -- still shows scope A's legacy rows under scope B's
//! `history_for_bot` queries. Nothing in W1/W2/W3 detects or corrects that
//! already-collided history; closing it needs a real backfill pass over
//! existing data, which is explicitly out of scope here (no DDL, no
//! backfill).

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};

use super::records::{Bot, BotMessage, HistoryEntry, ResponsibilityRun, ResponsibilityTrigger};
use crate::automations::records::Automation;
use crate::automations::storage::{self as automations_storage, AutomationOwnerPrecondition};
use crate::locale_ordering::{self, LocaleOrderingError};

pub const BOTS_SCHEMA_COMPONENT: &str = "bots";
/// v1: the original `bots`/`bot_responsibility_runs` tables (CAS keyed off
/// `updated_at`, no run-dedupe fence). v2: adds the `bots.rev` monotonic
/// revision column (see the module doc's "Cross-connection contention")
/// and a partial `UNIQUE(bot_id, automation_run_id) WHERE automation_run_id
/// IS NOT NULL` index on `bot_responsibility_runs` (see
/// [`record_responsibility_run`]'s atomic dedupe fence). v3: adds the
/// `bot_messages` table (one append-only row per chat turn; see
/// [`record_bot_message_in_tx`]) -- no dedupe/CAS needed, since each row is
/// independently written exactly once by the delegated `bot.run` ledger.
pub const BOTS_SCHEMA_VERSION: i64 = 3;

#[derive(Debug)]
pub enum StorageError {
    Sqlite(rusqlite::Error),
    Json(serde_json::Error),
    NotFound(&'static str),
    /// A concurrent writer (a second connection to the same database
    /// file) already changed this row since it was read; the caller must
    /// re-read and retry, it must not blindly overwrite.
    StaleUpdate,
    /// A scheduled responsibility's `automationId` does not name an
    /// automation owned by this Bot (missing entirely, or owned by a
    /// different Bot).
    OwnershipViolation(&'static str),
    /// `create_scheduled_responsibility` was asked to create an automation
    /// whose `id` already names an existing row (foreign-owned or not --
    /// never silently overwritten/hijacked; see
    /// `automations::storage::insert_new_automation`).
    AutomationIdCollision,
    /// [`create_bot`] refuses to insert a new Bot whose `id` already names
    /// any retained row in `bot_responsibility_runs`, regardless of scope
    /// or stamp state (see the module doc's "Create-deny fence"). Mint a
    /// new id instead of recreating this one.
    BotIdCollision,
    /// The caller's expected automation owner (see
    /// `automations::storage::AutomationOwnerPrecondition`) does not match
    /// its actual current owner.
    AutomationOwnerConflict,
    UnsupportedSchemaVersion {
        component: &'static str,
        found: i64,
        supported: i64,
    },
    /// The caller-supplied host locale tag (see [`list_bots`]) is invalid or
    /// has no ICU4X collation data. Root owns resolving/binding the actual
    /// host-default-locale value; this error surfaces that unresolved input
    /// rather than silently falling back to a different order.
    LocaleOrdering(LocaleOrderingError),
    /// A stored run's JSON envelope carries exactly one of
    /// `scope_host`/`scope_folder` -- never both, never neither -- which
    /// this module's own writer never produces (see the module doc's
    /// "Partial scope stamp"). Refused rather than guessed at as legacy or
    /// fully scoped.
    PartialScopeStamp,
}

impl From<rusqlite::Error> for StorageError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}
impl From<serde_json::Error> for StorageError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}
impl From<LocaleOrderingError> for StorageError {
    fn from(value: LocaleOrderingError) -> Self {
        Self::LocaleOrdering(value)
    }
}
impl From<automations_storage::StorageError> for StorageError {
    fn from(value: automations_storage::StorageError) -> Self {
        match value {
            automations_storage::StorageError::Sqlite(e) => Self::Sqlite(e),
            automations_storage::StorageError::Json(e) => Self::Json(e),
            automations_storage::StorageError::NotFound(w) => Self::NotFound(w),
            automations_storage::StorageError::IdCollision => Self::AutomationIdCollision,
            automations_storage::StorageError::OwnerConflict => Self::AutomationOwnerConflict,
            automations_storage::StorageError::UnsupportedSchemaVersion {
                component,
                found,
                supported,
            } => Self::UnsupportedSchemaVersion {
                component,
                found,
                supported,
            },
        }
    }
}

impl std::fmt::Display for StorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sqlite(e) => write!(f, "sqlite error: {e}"),
            Self::Json(e) => write!(f, "json error: {e}"),
            Self::NotFound(what) => write!(f, "{what} not found"),
            Self::StaleUpdate => write!(f, "stale update: row changed since it was read"),
            Self::OwnershipViolation(what) => write!(f, "{what}"),
            Self::AutomationIdCollision => write!(f, "an automation with this id already exists"),
            Self::BotIdCollision => write!(
                f,
                "a bot with this id already has retained responsibility-run history; use a new id"
            ),
            Self::AutomationOwnerConflict => {
                write!(
                    f,
                    "expected automation owner does not match its actual current owner"
                )
            }
            Self::UnsupportedSchemaVersion {
                component,
                found,
                supported,
            } => write!(
                f,
                "{component} schema version {found} is newer than the {supported} this build supports; refusing to modify it"
            ),
            Self::LocaleOrdering(e) => write!(f, "{e}"),
            Self::PartialScopeStamp => write!(
                f,
                "stored responsibility run carries a partial scope stamp (exactly one of scope_host/scope_folder)"
            ),
        }
    }
}
impl std::error::Error for StorageError {}

type Result<T> = std::result::Result<T, StorageError>;

fn create_v1_tables(tx: &rusqlite::Transaction) -> Result<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS bots (
            id TEXT PRIMARY KEY,
            host_id TEXT NOT NULL,
            folder TEXT NOT NULL,
            updated_at REAL NOT NULL,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS bots_scope ON bots(host_id, folder);
        CREATE TABLE IF NOT EXISTS bot_responsibility_runs (
            id TEXT PRIMARY KEY,
            bot_id TEXT NOT NULL,
            automation_run_id TEXT,
            started_at REAL NOT NULL,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS bot_responsibility_runs_bot_id ON bot_responsibility_runs(bot_id);",
    )?;
    Ok(())
}

/// Additive step from schema version 1 to 2: see the module doc's
/// "Cross-connection contention". `rev` defaults to `0` for pre-existing
/// rows (their first CAS write after this migration reads that `0` as its
/// expected value, same as any other row). The partial unique index is
/// created `IF NOT EXISTS`; a v1 database that (absent any fence) already
/// accumulated genuine (bot_id, automation_run_id) duplicates would fail
/// this step -- an acceptable, disclosed limitation for a database that
/// has never been in production use.
fn migrate_v1_to_v2(tx: &rusqlite::Transaction) -> Result<()> {
    tx.execute_batch(
        "ALTER TABLE bots ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
        CREATE UNIQUE INDEX IF NOT EXISTS bot_responsibility_runs_dedupe
            ON bot_responsibility_runs(bot_id, automation_run_id)
            WHERE automation_run_id IS NOT NULL;",
    )?;
    Ok(())
}

fn create_v2_tables(tx: &rusqlite::Transaction) -> Result<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS bots (
            id TEXT PRIMARY KEY,
            host_id TEXT NOT NULL,
            folder TEXT NOT NULL,
            updated_at REAL NOT NULL,
            rev INTEGER NOT NULL DEFAULT 0,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS bots_scope ON bots(host_id, folder);
        CREATE TABLE IF NOT EXISTS bot_responsibility_runs (
            id TEXT PRIMARY KEY,
            bot_id TEXT NOT NULL,
            automation_run_id TEXT,
            started_at REAL NOT NULL,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS bot_responsibility_runs_bot_id ON bot_responsibility_runs(bot_id);
        CREATE UNIQUE INDEX IF NOT EXISTS bot_responsibility_runs_dedupe
            ON bot_responsibility_runs(bot_id, automation_run_id)
            WHERE automation_run_id IS NOT NULL;",
    )?;
    Ok(())
}

/// Additive step from schema version 2 to 3: one append-only table for
/// chat-turn history (see [`record_bot_message_in_tx`]). No backfill: a
/// pre-existing database simply starts with no messages recorded.
fn migrate_v2_to_v3(tx: &rusqlite::Transaction) -> Result<()> {
    create_bot_messages_table(tx)
}

fn create_bot_messages_table(tx: &rusqlite::Transaction) -> Result<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS bot_messages (
            id TEXT PRIMARY KEY,
            bot_id TEXT NOT NULL,
            started_at REAL NOT NULL,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS bot_messages_bot_id ON bot_messages(bot_id);",
    )?;
    Ok(())
}

fn create_v3_tables(tx: &rusqlite::Transaction) -> Result<()> {
    create_v2_tables(tx)?;
    create_bot_messages_table(tx)
}

/// Read-only precondition, called by [`migrate`] and by
/// `apply_pending_steps_in_tx` (the single-transaction aggregate startup
/// gate in `Engine::open`): refuses -- without creating or altering any
/// `bots` table -- if this database already recorded a version newer than
/// [`BOTS_SCHEMA_VERSION`]. Within the aggregate gate the components are
/// applied sequentially in one transaction, so the no-partial-state
/// property comes from that transaction's rollback-on-any-failure (a
/// later component's refusal undoes an earlier component's already-applied
/// steps), not from checking every component before any of them runs.
pub fn check_schema_not_ahead(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_versions (
            component TEXT PRIMARY KEY,
            version INTEGER NOT NULL
        );",
    )?;
    let existing: Option<i64> = conn
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![BOTS_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(found) = existing
        && found > BOTS_SCHEMA_VERSION
    {
        return Err(StorageError::UnsupportedSchemaVersion {
            component: BOTS_SCHEMA_COMPONENT,
            found,
            supported: BOTS_SCHEMA_VERSION,
        });
    }
    Ok(())
}

/// Applies every pending `bots` migration step using the caller's
/// already-open transaction; never opens or commits a transaction of its
/// own. See `automations::storage::apply_pending_steps_in_tx` for why this
/// call shape exists separately from [`migrate`] below: it is what
/// `db::migrate_and_recover` (the real single-transaction aggregate
/// startup gate in `Engine::open`) calls, so this component's steps roll
/// back together with everything else in that transaction on any failure,
/// including one only discovered afterward in a sibling component.
pub(crate) fn apply_pending_steps_in_tx(tx: &Transaction) -> Result<()> {
    check_schema_not_ahead(tx)?;
    let existing: Option<i64> = tx
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![BOTS_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    match existing {
        None => {
            // A brand-new database jumps straight to CURRENT via the
            // consolidated create-tables step, rather than replaying every
            // historical step -- both paths produce an identical schema.
            create_v3_tables(tx)?;
            tx.execute(
                "INSERT INTO schema_versions(component, version) VALUES (?1, ?2)",
                params![BOTS_SCHEMA_COMPONENT, BOTS_SCHEMA_VERSION],
            )?;
        }
        Some(found) => {
            let mut from_version = found;
            while from_version < BOTS_SCHEMA_VERSION {
                let next_version = from_version + 1;
                match next_version {
                    1 => create_v1_tables(tx)?,
                    2 => migrate_v1_to_v2(tx)?,
                    3 => migrate_v2_to_v3(tx)?,
                    _ => unreachable!("no migration step defined for version {next_version}"),
                }
                tx.execute(
                    "INSERT INTO schema_versions(component, version) VALUES (?1, ?2)
                     ON CONFLICT(component) DO UPDATE SET version = excluded.version",
                    params![BOTS_SCHEMA_COMPONENT, next_version],
                )?;
                from_version = next_version;
            }
        }
    }
    Ok(())
}

/// Additive, idempotent, reopen-safe, step-wise migration for the `bots`
/// component, as a **standalone** call: opens its own per-step
/// transactions and commits each step immediately (see
/// [`apply_pending_steps_in_tx`] for the single-transaction call shape
/// `Engine::open` actually uses). See `automations::storage::migrate` for
/// the identical step-wise convention (a database recorded at an older
/// *supported* version has every intermediate step from `found + 1` up to
/// [`BOTS_SCHEMA_VERSION`] applied in order, never treated as a no-op
/// merely because `found <= BOTS_SCHEMA_VERSION`); this is namespaced
/// under `"bots"` independently, sharing only the `schema_versions` table.
pub fn migrate(conn: &Connection) -> Result<()> {
    check_schema_not_ahead(conn)?;
    let existing: Option<i64> = conn
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![BOTS_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    let mut from_version = match existing {
        Some(found) => found,
        None => {
            // A brand-new database jumps straight to CURRENT via the
            // consolidated create-tables step, rather than replaying every
            // historical step -- both paths produce an identical schema.
            let tx = conn.unchecked_transaction()?;
            create_v3_tables(&tx)?;
            tx.execute(
                "INSERT INTO schema_versions(component, version) VALUES (?1, ?2)",
                params![BOTS_SCHEMA_COMPONENT, BOTS_SCHEMA_VERSION],
            )?;
            tx.commit()?;
            return Ok(());
        }
    };
    while from_version < BOTS_SCHEMA_VERSION {
        let next_version = from_version + 1;
        let tx = conn.unchecked_transaction()?;
        match next_version {
            1 => create_v1_tables(&tx)?,
            2 => migrate_v1_to_v2(&tx)?,
            3 => migrate_v2_to_v3(&tx)?,
            _ => unreachable!("no migration step defined for version {next_version}"),
        }
        tx.execute(
            "INSERT INTO schema_versions(component, version) VALUES (?1, ?2)
             ON CONFLICT(component) DO UPDATE SET version = excluded.version",
            params![BOTS_SCHEMA_COMPONENT, next_version],
        )?;
        tx.commit()?;
        from_version = next_version;
    }
    Ok(())
}

fn row_to_bot(json: String) -> Result<Bot> {
    Ok(serde_json::from_str(&json)?)
}

/// Inserts a new Bot. `bot.id`/`bot.created_at`/`bot.updated_at` are
/// supplied by the caller (production: real id/timestamp facilities;
/// tests: deterministic injected values) -- this function does not
/// generate them, preserving "creating a Bot keeps its ID and original
/// creation time" as the caller's own invariant to uphold on every
/// subsequent update. `rev` starts at `0`.
///
/// Before inserting, probes `bot_responsibility_runs` for ANY retained row
/// naming this `bot.id` -- regardless of scope stamp -- and refuses with
/// [`StorageError::BotIdCollision`] if one exists (see the module doc's
/// "Create-deny fence (W1)"). This is what actually prevents a freed id
/// from ever being reused, in the same scope or a different one; the
/// [`history_for_bot`] scope fence only ever excluded a reused id's cross-
/// era rows at read time, never deleted them.
pub fn create_bot(conn: &Connection, host_id: &str, folder: &str, bot: &Bot) -> Result<()> {
    let retained_run: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM bot_responsibility_runs WHERE bot_id = ?1 LIMIT 1",
            params![bot.id],
            |r| r.get(0),
        )
        .optional()?;
    if retained_run.is_some() {
        return Err(StorageError::BotIdCollision);
    }
    let retained_message: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM bot_messages WHERE bot_id = ?1 LIMIT 1",
            params![bot.id],
            |r| r.get(0),
        )
        .optional()?;
    if retained_message.is_some() {
        return Err(StorageError::BotIdCollision);
    }
    let payload = serde_json::to_string(bot)?;
    conn.execute(
        "INSERT INTO bots (id, host_id, folder, updated_at, rev, payload_json) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
        params![bot.id, host_id, folder, bot.updated_at, payload],
    )?;
    Ok(())
}

pub fn get_bot(conn: &Connection, host_id: &str, folder: &str, id: &str) -> Result<Option<Bot>> {
    Ok(get_bot_with_rev(conn, host_id, folder, id)?.map(|(bot, _rev)| bot))
}

/// The CAS-guarded primitive `get_bot` is built on: also returns the row's
/// current internal `rev` snapshot, needed as `expected_rev` for a
/// subsequent [`cas_write`]. Not part of any source-visible field --
/// `rev` never appears in the serialized [`Bot`] payload.
fn get_bot_with_rev(
    conn: &Connection,
    host_id: &str,
    folder: &str,
    id: &str,
) -> Result<Option<(Bot, i64)>> {
    conn.query_row(
        "SELECT payload_json, rev FROM bots WHERE id = ?1 AND host_id = ?2 AND folder = ?3",
        params![id, host_id, folder],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
    )
    .optional()?
    .map(|(json, rev)| Ok((row_to_bot(json)?, rev)))
    .transpose()
}

/// Every Bot in scope in insertion (`rowid`) order, with no display-name
/// sort applied. For internal maintenance operations that scan every Bot
/// but do not present an ordered list to a user (ownership repair,
/// cross-Bot automation-deletion cleanup) -- these must not fail merely
/// because no host locale was supplied.
fn list_bots_unordered(conn: &Connection, host_id: &str, folder: &str) -> Result<Vec<(Bot, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT payload_json, rev FROM bots WHERE host_id = ?1 AND folder = ?2 ORDER BY rowid",
    )?;
    let rows = stmt
        .query_map(params![host_id, folder], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(json, rev)| Ok((row_to_bot(json)?, rev)))
        .collect()
}

/// Every Bot across **every** `(host_id, folder)` scope, each tagged with
/// its own scope. Internal-maintenance-only: never exposed as a general
/// "list across hosts" read capability (the module doc's "no cross-host
/// reads" governs every user-facing function; this exists solely so
/// [`delete_automation_everywhere`] -- cleaning up after deleting a
/// genuinely *global* entity -- can find and clear a dangling scheduled
/// responsibility in a scope other than the caller's, which is the actual
/// bug this bounded correction fixes: a global automation delete that
/// only swept the caller's own scope silently left stale projections
/// behind in every other scope forever).
fn all_bots_unordered(conn: &Connection) -> Result<Vec<(String, String, Bot, i64)>> {
    let mut stmt =
        conn.prepare("SELECT host_id, folder, payload_json, rev FROM bots ORDER BY rowid")?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(host_id, folder, json, rev)| Ok((host_id, folder, row_to_bot(json)?, rev)))
        .collect()
}

/// Locale-aware listing (see the module doc): rows are first read in
/// insertion (`rowid`) order -- the stable base order the source's own
/// array held before sorting -- then sorted by `displayIdentity.displayName`
/// under `host_locale` with a real ICU4X collator via a *stable* sort, so
/// names the collator treats as equal keep their insertion-order relative
/// position (mirroring `Array.prototype.sort`'s spec-mandated stability).
pub fn list_bots(
    conn: &Connection,
    host_id: &str,
    folder: &str,
    host_locale: &str,
) -> Result<Vec<Bot>> {
    let mut bots: Vec<Bot> = list_bots_unordered(conn, host_id, folder)?
        .into_iter()
        .map(|(b, _)| b)
        .collect();
    locale_ordering::sort_by_display_name_stable(&mut bots, host_locale, |bot| {
        bot.display_identity.display_name.as_str()
    })?;
    Ok(bots)
}

/// Compare-and-swap write: succeeds only if `expected_rev` still matches
/// the row's current internal `rev` (see the module doc's
/// "Cross-connection contention" -- **not** keyed off `updated_at`, which
/// stays a plain source-visible field). `pub` (rather than an
/// internal-only helper) so tests can drive this exact primitive across
/// two independent `rusqlite::Connection`s to the same database file,
/// proving a real cross-connection fence rather than a process-local
/// mutex.
/// The internal `rev` snapshot for a row, for tests driving [`cas_write`]
/// directly across two real connections (see the module doc's
/// "Cross-connection contention"). Never part of the serialized [`Bot`]
/// payload; production callers should prefer [`update_bot`], which
/// fetches and applies this internally.
pub fn current_rev(
    conn: &Connection,
    host_id: &str,
    folder: &str,
    id: &str,
) -> Result<Option<i64>> {
    Ok(get_bot_with_rev(conn, host_id, folder, id)?.map(|(_, rev)| rev))
}

pub fn cas_write(
    conn: &Connection,
    host_id: &str,
    folder: &str,
    bot: &Bot,
    expected_rev: i64,
) -> Result<()> {
    let payload = serde_json::to_string(bot)?;
    let affected = conn.execute(
        "UPDATE bots SET updated_at = ?1, rev = rev + 1, payload_json = ?2
         WHERE id = ?3 AND host_id = ?4 AND folder = ?5 AND rev = ?6",
        params![
            bot.updated_at,
            payload,
            bot.id,
            host_id,
            folder,
            expected_rev
        ],
    )?;
    if affected == 0 {
        // Distinguish "row is simply gone" from "row changed under us":
        // an absent row is a caller error (NotFound), a present-but-
        // changed row is genuine contention (StaleUpdate).
        let still_exists: Option<i64> = conn
            .query_row(
                "SELECT 1 FROM bots WHERE id = ?1 AND host_id = ?2 AND folder = ?3",
                params![bot.id, host_id, folder],
                |r| r.get(0),
            )
            .optional()?;
        return Err(if still_exists.is_some() {
            StorageError::StaleUpdate
        } else {
            StorageError::NotFound("bot")
        });
    }
    Ok(())
}

/// Loads the Bot at `id`, applies `mutate` (which must only change fields
/// the public partial-update boundary authorizes -- this function does
/// not itself restrict which fields `mutate` touches; see
/// `docs/migration/native-bot-state-contract.md`'s "Internal responsibility
/// updates are not authorized merely because the public parser accepts
/// other Bot updates" for why callers, not this generic primitive, own
/// that authorization boundary), preserves `id`/`created_at`, sets
/// `updated_at` to `new_updated_at` (a plain source-visible field, never
/// the CAS discriminant -- see the module doc), and writes it back with
/// the `rev`-guarded CAS check above.
pub fn update_bot(
    conn: &Connection,
    host_id: &str,
    folder: &str,
    id: &str,
    new_updated_at: f64,
    mutate: impl FnOnce(&mut Bot),
) -> Result<Bot> {
    let (mut bot, expected_rev) =
        get_bot_with_rev(conn, host_id, folder, id)?.ok_or(StorageError::NotFound("bot"))?;
    let original_id = bot.id.clone();
    let original_created_at = bot.created_at;
    mutate(&mut bot);
    bot.id = original_id;
    bot.created_at = original_created_at;
    bot.updated_at = new_updated_at;
    cas_write(conn, host_id, folder, &bot, expected_rev)?;
    Ok(bot)
}

/// Rotates only `current_session`; every other field (instructions,
/// memories, character, responsibilities, history) is untouched.
pub fn rotate_session(
    conn: &Connection,
    host_id: &str,
    folder: &str,
    id: &str,
    new_session: Option<super::records::BotSession>,
    new_updated_at: f64,
) -> Result<Bot> {
    update_bot(conn, host_id, folder, id, new_updated_at, |bot| {
        bot.current_session = new_session;
    })
}

/// Deletes the Bot. Automations it owns keep every field and all their
/// runs; only their `bot_id` ownership is cleared (never cascaded into
/// another Bot, workspace or automation). `bot_responsibility_runs` rows
/// for this Bot are preserved as orphaned evidence, not deleted. Runs the
/// ownership-clearing and the row delete in one transaction.
pub fn delete_bot(conn: &Connection, host_id: &str, folder: &str, id: &str) -> Result<bool> {
    let tx = conn.unchecked_transaction()?;
    let owned = automations_storage::list_automations_owned_by_bot(&tx, id)?;
    for automation in &owned {
        automations_storage::clear_automation_owner(&tx, &automation.id)?;
    }
    let deleted = tx.execute(
        "DELETE FROM bots WHERE id = ?1 AND host_id = ?2 AND folder = ?3",
        params![id, host_id, folder],
    )?;
    tx.commit()?;
    Ok(deleted > 0)
}

/// Creates a scheduled responsibility together with its owning automation
/// in one transaction: if writing the responsibility onto the Bot fails
/// after the automation was inserted, the whole transaction rolls back
/// (no orphan automation) -- replacing the source's application-level
/// try/catch compensation with a real SQLite transaction, including its
/// atomicity surviving a reopen.
///
/// Uses `automations::storage::insert_new_automation` (a plain `INSERT`,
/// never an upsert): if `automation.id` already names an existing row --
/// whether foreign-owned or coincidentally identical -- this fails with
/// [`StorageError::AutomationIdCollision`] and the transaction rolls back,
/// rather than silently overwriting (hijacking) that existing automation.
pub fn create_scheduled_responsibility(
    conn: &Connection,
    host_id: &str,
    folder: &str,
    bot_id: &str,
    responsibility: super::records::Responsibility,
    automation: Automation,
) -> Result<(Bot, Automation)> {
    let ResponsibilityTrigger::Scheduled { automation_id } = &responsibility.trigger else {
        return Err(StorageError::OwnershipViolation(
            "create_scheduled_responsibility requires a Scheduled trigger",
        ));
    };
    if automation_id != &automation.id {
        return Err(StorageError::OwnershipViolation(
            "responsibility trigger.automationId must match the automation being created",
        ));
    }
    if automation.bot_id.as_deref() != Some(bot_id) {
        return Err(StorageError::OwnershipViolation(
            "a scheduled responsibility's automation must be owned by the same Bot",
        ));
    }
    let tx = conn.unchecked_transaction()?;
    automations_storage::insert_new_automation(&tx, &automation)?;
    let (mut bot, expected_rev) =
        get_bot_with_rev(&tx, host_id, folder, bot_id)?.ok_or(StorageError::NotFound("bot"))?;
    bot.responsibilities.push(responsibility);
    bot.updated_at = automation.updated_at.max(bot.updated_at);
    cas_write(&tx, host_id, folder, &bot, expected_rev)?;
    tx.commit()?;
    Ok((bot, automation))
}

/// Validates that `automation_id` names an automation owned by `bot_id`
/// ("A scheduled responsibility must reference an existing automation
/// owned by that Bot. Missing or foreign ownership is rejected before
/// mutation.").
pub fn require_owned_automation(
    conn: &Connection,
    bot_id: &str,
    automation_id: &str,
) -> Result<Automation> {
    let automation = automations_storage::get_automation(conn, automation_id)?.ok_or(
        StorageError::OwnershipViolation(
            "scheduled responsibility references a missing automation",
        ),
    )?;
    if !automation.belongs_to_bot(bot_id) {
        return Err(StorageError::OwnershipViolation(
            "scheduled responsibility references an automation owned by a different Bot",
        ));
    }
    Ok(automation)
}

/// Records a responsibility run. Validates the Bot and responsibility
/// exist, that a scheduled responsibility's automation is owned by the
/// Bot, and (if `run.automation_run_id` is `Some`) that it names a real
/// `AutomationRun` belonging to the same automation. A non-null
/// `automation_run_id` deduplicates against any existing row with the
/// same id (merging: `ended_at`/`recipe`/`host_observation` keep the
/// existing value when the incoming one is `None` -- "null merge
/// semantics", preserving the existing row's own `id`); a `None`
/// `automation_run_id` never deduplicates and always inserts a new row.
///
/// The whole check-then-merge-or-insert sequence runs inside a real
/// `BEGIN IMMEDIATE` transaction (`automations::storage::begin_immediate`),
/// so a second connection racing the same `(bot_id, automation_run_id)`
/// pair blocks (subject to the connection's busy timeout) rather than
/// reading a stale "no existing row yet" snapshot and inserting a second,
/// duplicate row; the partial `UNIQUE(bot_id, automation_run_id)` index
/// added in schema v2 is the hard backstop even if that serialization were
/// ever bypassed. Reopening the database afterwards still shows exactly
/// one row for that pair, at the original (first-inserted) id.
///
/// This wrapper only owns the transaction boundary: the actual sequence is
/// [`record_responsibility_run_in_tx`], also called directly by
/// `automations::runner::record_run_outcome` so that write can share a
/// single `BEGIN IMMEDIATE` with its own linked `AutomationRun` upsert
/// (see V4-A5c) instead of nesting a second transaction.
pub fn record_responsibility_run(
    conn: &Connection,
    host_id: &str,
    folder: &str,
    run: ResponsibilityRun,
) -> Result<ResponsibilityRun> {
    let tx = automations_storage::begin_immediate(conn)?;
    let result = record_responsibility_run_in_tx(&tx, host_id, folder, run)?;
    tx.commit()?;
    Ok(result)
}

/// The check-then-merge-or-insert body of [`record_responsibility_run`],
/// taking an already-open transaction/connection and never beginning or
/// committing one of its own -- see that function's doc for the full
/// behavior contract, which this preserves byte-for-byte. `pub(crate)` so
/// `automations::runner::record_run_outcome` can run it inside its own
/// shared `BEGIN IMMEDIATE` alongside the linked `AutomationRun` upsert.
pub(crate) fn record_responsibility_run_in_tx(
    conn: &Connection,
    host_id: &str,
    folder: &str,
    run: ResponsibilityRun,
) -> Result<ResponsibilityRun> {
    let bot = get_bot(conn, host_id, folder, &run.bot_id)?.ok_or(StorageError::NotFound("bot"))?;
    let responsibility = bot
        .responsibilities
        .iter()
        .find(|r| r.id == run.responsibility_id)
        .ok_or(StorageError::NotFound("responsibility"))?;
    match &responsibility.trigger {
        // Storage-internal shape: `automation_id` stays snake_case on disk;
        // V5's own snapshot boundary is the only place that maps it to wire
        // camelCase `automationId`.
        ResponsibilityTrigger::Scheduled { automation_id } => {
            if run.automation_id.as_deref() != Some(automation_id.as_str()) {
                return Err(StorageError::OwnershipViolation(
                    "responsibility run automationId must match its responsibility's scheduled automation",
                ));
            }
            require_owned_automation(conn, &run.bot_id, automation_id)?;
        }
        ResponsibilityTrigger::Reactive { .. } => {
            if run.automation_id.is_some() {
                return Err(StorageError::OwnershipViolation(
                    "a reactive responsibility's run must not carry an automationId",
                ));
            }
        }
    }
    if let Some(automation_run_id) = &run.automation_run_id {
        let linked = automations_storage::get_automation_run(conn, automation_run_id)?.ok_or(
            StorageError::OwnershipViolation(
                "responsibility run references a missing automation run",
            ),
        )?;
        if run.automation_id.as_deref() != Some(linked.automation_id.as_str()) {
            return Err(StorageError::OwnershipViolation(
                "responsibility run's automationRunId does not belong to its automationId",
            ));
        }
    }

    let result = if let Some(automation_run_id) = &run.automation_run_id {
        if let Some(existing_stored) =
            find_stored_run_by_automation_run_id(conn, &run.bot_id, automation_run_id)?
        {
            // W3 dedup restamp guard (see the module doc): never blindly
            // re-stamp whatever this call merges onto with the calling
            // scope.
            let existing_scope = classify_scope_stamp(&existing_stored)?;
            if let ScopeStamp::Full { host, folder: f } = &existing_scope
                && (host != host_id || f != folder)
            {
                return Err(StorageError::OwnershipViolation(
                    "responsibility run's existing scope stamp does not match this call's scope",
                ));
            }
            let existing = existing_stored.run;
            let merged = ResponsibilityRun {
                ended_at: run.ended_at.or(existing.ended_at),
                recipe: run.recipe.clone().or(existing.recipe.clone()),
                host_observation: run.host_observation.or(existing.host_observation),
                ..existing
            };
            match existing_scope {
                ScopeStamp::Full { .. } => upsert_run_row(conn, host_id, folder, &merged)?,
                // Keep an unstamped (legacy) row unstamped: attaching this
                // call's scope here would launder it into a scope it was
                // never actually proven to belong to.
                ScopeStamp::Legacy => upsert_run_row_with_stamp(conn, &merged, None)?,
            }
            merged
        } else {
            upsert_run_row(conn, host_id, folder, &run)?;
            run
        }
    } else {
        upsert_run_row(conn, host_id, folder, &run)?;
        run
    };
    Ok(result)
}

fn find_stored_run_by_automation_run_id(
    conn: &Connection,
    bot_id: &str,
    automation_run_id: &str,
) -> Result<Option<StoredRun>> {
    conn.query_row(
        "SELECT payload_json FROM bot_responsibility_runs WHERE bot_id = ?1 AND automation_run_id = ?2",
        params![bot_id, automation_run_id],
        |r| r.get::<_, String>(0),
    )
    .optional()?
    .map(|json| Ok(serde_json::from_str(&json)?))
    .transpose()
}

/// A [`StoredRun`]'s scope stamp, classified once so every reader (the
/// dedup merge below, [`history_for_bot`]) applies the exact same
/// three-way rule instead of re-deriving it ad hoc: see the module doc's
/// "Partial scope stamp (W2)" for why the third shape -- exactly one of
/// `scope_host`/`scope_folder` present -- is refused rather than treated
/// as either of the other two.
enum ScopeStamp {
    Full { host: String, folder: String },
    Legacy,
}

fn classify_scope_stamp(stored: &StoredRun) -> Result<ScopeStamp> {
    match (&stored.scope_host, &stored.scope_folder) {
        (Some(h), Some(f)) => Ok(ScopeStamp::Full {
            host: h.clone(),
            folder: f.clone(),
        }),
        (None, None) => Ok(ScopeStamp::Legacy),
        _ => Err(StorageError::PartialScopeStamp),
    }
}

/// Storage-internal envelope written into
/// `bot_responsibility_runs.payload_json`: wraps the source-visible
/// [`ResponsibilityRun`] (`#[serde(flatten)]`, so its own fields are
/// unchanged on disk) with an additive `(host_id, folder)` scope stamp used
/// only by [`history_for_bot`]'s scope fence (see the module doc's "Run
/// history scope fence"). `#[serde(default)]` on both stamp fields is what
/// keeps this backwards compatible: rows written before this envelope
/// existed deserialize with `scope_host`/`scope_folder` both `None` rather
/// than failing, and other readers of this JSON that still deserialize
/// straight into a plain [`ResponsibilityRun`] (e.g.
/// [`find_run_by_automation_run_id`]) keep working unchanged since
/// `ResponsibilityRun` has no `deny_unknown_fields`.
#[derive(Serialize, Deserialize)]
struct StoredRun {
    #[serde(flatten)]
    run: ResponsibilityRun,
    #[serde(default)]
    scope_host: Option<String>,
    #[serde(default)]
    scope_folder: Option<String>,
}

fn upsert_run_row(
    conn: &Connection,
    host_id: &str,
    folder: &str,
    run: &ResponsibilityRun,
) -> Result<()> {
    upsert_run_row_with_stamp(conn, run, Some((host_id, folder)))
}

/// `stamp = None` writes the row with no scope stamp at all (both
/// `scope_host`/`scope_folder` `None`) -- used only by
/// [`record_responsibility_run`]'s dedup merge path when the existing row
/// being merged onto is itself unstamped (legacy), so a merge never
/// "launders" a legacy row into a newly-stamped scope merely because the
/// calling scope happens to be known (see the module doc's "Dedup restamp
/// guard (W3)"). Every other caller goes through [`upsert_run_row`], which
/// always stamps with the caller's own scope.
fn upsert_run_row_with_stamp(
    conn: &Connection,
    run: &ResponsibilityRun,
    stamp: Option<(&str, &str)>,
) -> Result<()> {
    let stored = StoredRun {
        run: run.clone(),
        scope_host: stamp.map(|(h, _)| h.to_string()),
        scope_folder: stamp.map(|(_, f)| f.to_string()),
    };
    let payload = serde_json::to_string(&stored)?;
    conn.execute(
        "INSERT INTO bot_responsibility_runs (id, bot_id, automation_run_id, started_at, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET automation_run_id = excluded.automation_run_id,
                                        started_at = excluded.started_at,
                                        payload_json = excluded.payload_json",
        params![run.id, run.bot_id, run.automation_run_id, run.started_at, payload],
    )?;
    Ok(())
}

/// Newest-first history for `bot_id`, fenced to the resolved `(host_id,
/// folder)` scope (see the module doc's "Run history scope fence" --
/// P2-1): a row whose `StoredRun` scope stamp does not match this call's
/// `(host_id, folder)` is excluded here, but never deleted -- it stays on
/// disk, still reachable by a caller who queries with its actual original
/// scope. A row with no stamp at all (written before this fence existed)
/// is included under any bot_id match, exactly like the pre-fence
/// behavior. Orphaned responsibility/automation/automation-run links
/// resolve to `None`, never synthesized.
pub fn history_for_bot(
    conn: &Connection,
    host_id: &str,
    folder: &str,
    bot_id: &str,
) -> Result<Vec<HistoryEntry>> {
    let bot = get_bot(conn, host_id, folder, bot_id)?;
    let mut stmt = conn.prepare(
        "SELECT payload_json FROM bot_responsibility_runs WHERE bot_id = ?1 ORDER BY started_at DESC",
    )?;
    let rows: Vec<String> = stmt
        .query_map(params![bot_id], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|json| -> Result<Option<HistoryEntry>> {
            let stored: StoredRun = serde_json::from_str(&json)?;
            let in_scope = match classify_scope_stamp(&stored)? {
                ScopeStamp::Full { host, folder: f } => host == host_id && f == folder,
                // Legacy unstamped row: original scope was never recorded,
                // so it stays visible under any bot_id match.
                ScopeStamp::Legacy => true,
            };
            if !in_scope {
                return Ok(None);
            }
            let run = stored.run;
            let responsibility = bot.as_ref().and_then(|b| {
                b.responsibilities
                    .iter()
                    .find(|r| r.id == run.responsibility_id)
                    .cloned()
            });
            let automation = match &run.automation_id {
                Some(id) => automations_storage::get_automation(conn, id)?,
                None => None,
            };
            let automation_run = match &run.automation_run_id {
                Some(id) => automations_storage::get_automation_run(conn, id)?,
                None => None,
            };
            Ok(Some(HistoryEntry {
                responsibility_run: run,
                responsibility,
                automation,
                automation_run,
            }))
        })
        .filter_map(|r| r.transpose())
        .collect()
}

/// Inserts one chat-turn record. Connection-bound (opens no transaction of
/// its own) so `bot.run`'s delegated ledger can call this inside its own
/// `finalize` transaction, committing the message row and the receipt
/// atomically -- same shape as [`record_responsibility_run_in_tx`], minus
/// any dedupe/merge logic: each row is written exactly once, since the
/// ledger only ever runs `finalize` once per outer `bot.run` request id.
pub(crate) fn record_bot_message_in_tx(conn: &Connection, message: &BotMessage) -> Result<()> {
    let payload = serde_json::to_string(message)?;
    conn.execute(
        "INSERT INTO bot_messages (id, bot_id, started_at, payload_json) VALUES (?1, ?2, ?3, ?4)",
        params![message.id, message.bot_id, message.started_at, payload],
    )?;
    Ok(())
}

/// Newest-first chat history for `bot_id`, bounded by `limit`. Scope is
/// enforced by requiring the bot itself to resolve in `(host_id, folder)`
/// first -- a message row names no scope of its own (chat turns are never
/// re-owned across hosts the way a scheduled automation can be).
pub fn history_for_bot_messages(
    conn: &Connection,
    host_id: &str,
    folder: &str,
    bot_id: &str,
    limit: i64,
) -> Result<Vec<BotMessage>> {
    get_bot(conn, host_id, folder, bot_id)?.ok_or(StorageError::NotFound("bot"))?;
    let mut stmt = conn.prepare(
        "SELECT payload_json FROM bot_messages WHERE bot_id = ?1 ORDER BY started_at DESC LIMIT ?2",
    )?;
    let rows: Vec<String> = stmt
        .query_map(params![bot_id, limit], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|json| Ok(serde_json::from_str(&json)?))
        .collect()
}

/// Deletes a global automation **everywhere it is referenced, across every
/// `(host_id, folder)` scope** -- not just `host_id`/`folder`'s own Bots.
///
/// This is the one function in this module that must *not* stay scoped:
/// `Automation` is the global record authority (no host/folder column
/// exists on it at all; `automations::storage::delete_automation` already
/// never took a scope). An earlier revision of this function accepted
/// `host_id`/`folder` and only swept that one scope's Bots for a dangling
/// scheduled-responsibility projection -- which meant deleting a global
/// automation from scope A silently left a stale, never-cleaned
/// projection on any Bot in scope B forever, since nothing else ever
/// revisits scope B for this automation again. Scanning every scope here
/// (via the internal-maintenance-only [`all_bots_unordered`], never a
/// general "list across hosts" read capability) is what actually
/// prevents that; it does not weaken the "no cross-host reads" invariant
/// user-facing functions preserve, since this returns only `bool` and
/// never surfaces another scope's Bot data to a caller.
///
/// `expected_owner`, if given, is a **Bot-ownership** precondition only
/// (`automations::storage::AutomationOwnerPrecondition`/
/// `assert_owner_fence`, enforced through
/// `automations::storage::delete_automation`) **before** anything is
/// mutated: a missing automation is `StorageError::NotFound`, a
/// present-but-differently-Bot-owned one is
/// `StorageError::AutomationOwnerConflict` -- covering an expectation
/// made stale by a *different* connection's ownership change that
/// committed **before this call** (see
/// `delete_automation_everywhere_detects_ownership_changed_by_a_concurrent_connection`
/// and the deterministic WAL-mode companion test). A change that lands
/// *during* this call, after this transaction's read snapshot, cannot
/// honor the fence against the stale read: in WAL mode the write attempt
/// fails closed with a SQLite busy/snapshot error and full rollback --
/// never a silent proceed, and never a synthesized mid-call
/// `AutomationOwnerConflict`. This is **not** the source's real
/// `assertAutomationOwnerFence`, which
/// fences a completely different concept (which execution host --
/// local/self or a specific SSH target at a specific registration
/// generation -- has authority over the automation), requires a live
/// SSH-target/workspace-host registry this crate does not implement, and
/// remains fully open; see the native-state evidence's mandatory
/// follow-on gate rather than a fabricated substitute here.
pub fn delete_automation_everywhere(
    conn: &Connection,
    automation_id: &str,
    expected_owner: Option<AutomationOwnerPrecondition>,
) -> Result<bool> {
    let tx = conn.unchecked_transaction()?;
    let deleted =
        automations_storage::delete_automation(&tx, automation_id, expected_owner.as_ref())?;
    if deleted {
        for (host_id, folder, mut bot, expected_rev) in all_bots_unordered(&tx)? {
            let before = bot.responsibilities.len();
            bot.responsibilities.retain(|r| {
                !matches!(&r.trigger, ResponsibilityTrigger::Scheduled { automation_id: a } if a == automation_id)
            });
            if bot.responsibilities.len() != before {
                cas_write(&tx, &host_id, &folder, &bot, expected_rev)?;
            }
        }
    }
    tx.commit()?;
    Ok(deleted)
}

/// Source `migrateDrogonBotAutomationOwners`: walks Bots **within
/// `(host_id, folder)` only** in insertion (`rowid`) order -- the native
/// stand-in for the source's single-`PersistedState` array iteration
/// order, preserving "first Bot wins" conflict resolution -- building a
/// `automation_id -> bot_id` owner map from each in-scope Bot's scheduled
/// responsibilities whose automation actually exists, dropping (from the
/// Bot's `responsibilities`) any scheduled responsibility whose automation
/// is missing or already claimed by an earlier in-scope Bot. A lookup
/// *error* (e.g. an unreadable automation payload) is neither missing nor
/// claimable: it propagates, rolling the whole repair back in one
/// transaction instead of silently recording any partial drop.
///
/// Unlike the source (which has exactly one `PersistedState`, i.e. one
/// implicit "scope"), this SQLite schema holds every host/folder's Bots
/// and a single *global*, unscoped `automations` table together. An
/// earlier revision of this function iterated **every** automation in the
/// whole table and cleared/reassigned `bot_id` purely based on whether
/// this scope's owner map claimed it -- which incorrectly cleared
/// ownership on any automation actually owned by a Bot in a *different*
/// scope this function never read (and must not read: "no cross-host
/// reads"). The fix: only touch an automation if either (a) some in-scope
/// Bot's responsibility claims it (`owners`), or (b) its *current* owner
/// is itself a Bot that exists in this scope (an in-scope dangling
/// reference -- the one case this function is entitled to correct without
/// having read any other scope). An automation currently owned by a Bot
/// outside this scope is left completely untouched.
pub fn migrate_ownership(conn: &Connection, host_id: &str, folder: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let bots = list_bots_unordered(&tx, host_id, folder)?;
    let bot_ids_in_scope: std::collections::HashSet<String> =
        bots.iter().map(|(b, _)| b.id.clone()).collect();
    let mut owners: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for (mut bot, expected_rev) in bots {
        let before = bot.responsibilities.len();
        let mut kept = Vec::with_capacity(before);
        for responsibility in std::mem::take(&mut bot.responsibilities) {
            let ResponsibilityTrigger::Scheduled { automation_id } = &responsibility.trigger else {
                kept.push(responsibility);
                continue;
            };
            // Unreadable is not missing: propagate errors to roll back the repair.
            match automations_storage::get_automation(&tx, automation_id) {
                Ok(Some(_)) => {}
                Ok(None) => continue, // genuinely missing: drop this projection
                Err(e) => return Err(e.into()),
            }
            if owners.contains_key(automation_id) {
                continue; // an earlier in-scope Bot already claimed it (first wins)
            }
            owners.insert(automation_id.clone(), bot.id.clone());
            kept.push(responsibility);
        }
        bot.responsibilities = kept;
        if bot.responsibilities.len() != before {
            cas_write(&tx, host_id, folder, &bot, expected_rev)?;
        }
    }
    for automation in automations_storage::list_all_automations(&tx)? {
        let currently_in_scope = automation
            .bot_id
            .as_ref()
            .is_some_and(|owner| bot_ids_in_scope.contains(owner));
        let claimed_in_scope = owners.get(&automation.id).cloned();
        let resolved_owner = match (&claimed_in_scope, currently_in_scope) {
            (Some(owner), _) => Some(owner.clone()),
            (None, true) => None,
            (None, false) => {
                // Not claimed by anything in this scope, and its current
                // owner (if any) is not a Bot in this scope either --
                // outside this function's jurisdiction; leave it alone.
                continue;
            }
        };
        if automation.bot_id != resolved_owner {
            let mut fixed = automation;
            fixed.bot_id = resolved_owner;
            automations_storage::upsert_automation(&tx, &fixed)?;
        }
    }
    tx.commit()?;
    Ok(())
}
