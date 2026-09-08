//! SQLite storage for the **global** `Automation`/`AutomationRun` record
//! authority (see `automations::records`). MIT Copyright (c) 2026 Lovecast
//! Inc.; the record shape is the native equivalent of the fork's
//! `src/shared/automations-types.ts` and the run-history write/cascade
//! semantics follow `src/main/automations/automation-run-writer.ts` and the
//! fork persistence store's `deleteAutomation` cascade, source revision
//! `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. Every function here accepts an
//! existing `&rusqlite::Connection` (or, for multi-step operations, is
//! meant to be called inside a caller-owned `rusqlite::Transaction`
//! borrowed `as_ref()` as a `Connection`) -- this module never opens its
//! own database file. The standalone [`migrate`] keeps its
//! per-step-committing behavior, while the aggregate `Engine::open`
//! startup applies these same steps through `db::migrate_and_recover`'s
//! single rollback-safe transaction (see
//! `docs/migration/bot-state-admission.md`).
//!
//! Full records round-trip as a JSON payload column (`payload_json`), so
//! every source field -- including ones this build's callers do not yet
//! interpret -- survives a write/read cycle unmodified. `bot_id`/
//! `automation_id` are additionally split into real indexed columns
//! purely so ownership/join queries do not require parsing JSON.
//!
//! ## Bot-ownership precondition (corrected naming, round 3 -- see
//! native-state evidence)
//!
//! A prior revision of this module fenced automation deletion with a
//! caller-supplied **Bot-ownership** (`Automation::bot_id`) expectation
//! and mislabeled that as a port of the source's real
//! `assertAutomationOwnerFence`
//! (`src/shared/automation-owner-precondition.ts`). Root review
//! (msg_80ee2d7bfde1) correctly rejected the mislabeling: the real source
//! fence has nothing to do with Bot ownership at all -- it fences which
//! **execution host** (self/local, or a specific SSH target at a specific
//! registration generation) the caller believes currently has authority
//! over the automation, resolved via `projectAutomationSelector` against
//! a *live* SSH-target registry, workspace-host table, and repo/connection
//! table (`AutomationProjectionContext`). None of that host/registry
//! machinery exists anywhere in `drogon-core` today, and this bounded
//! correction does not fabricate one inside `records`/`storage` -- doing
//! so would itself be a test-only substitute for a real root-owned
//! subsystem, which the task instructions explicitly forbid. See
//! `docs/migration/native-bot-state-contract.md` and the native-state
//! evidence's "Mandatory follow-on gate" section for the precise,
//! disclosed statement of what must exist (a real SSH host/target
//! registry with live generation tracking) before any global-automation
//! RPC admission boundary can be considered complete, and for why the SSH
//! host-authority fence itself remains **fully open**, not partially
//! implemented here.
//!
//! [`AutomationOwnerPrecondition`]/[`assert_owner_fence`] below is
//! renamed-in-spirit but functionally unchanged from round 2: it is
//! **only** ever a Bot-ownership check (`Automation::bot_id`), used only
//! where Bot ownership is the actual thing being verified. It must never
//! be described as implementing, replacing, or approximating the source's
//! SSH host-authority fence -- the two are unrelated concepts in the
//! source and are kept unrelated here.

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};

use super::records::Automation;
use crate::automations::records::AutomationRun;

pub const AUTOMATIONS_SCHEMA_COMPONENT: &str = "automations";
/// v1: `automations`/`automation_runs` base tables. v2: an additive
/// `(automation_id, id)` covering index on `automation_runs`, proving this
/// module's `migrate` actually steps an older recorded version forward
/// instead of treating any `found <= CURRENT` as already-up-to-date (see
/// the native-state evidence's migration correction).
pub const AUTOMATIONS_SCHEMA_VERSION: i64 = 2;

#[derive(Debug)]
pub enum StorageError {
    Sqlite(rusqlite::Error),
    Json(serde_json::Error),
    NotFound(&'static str),
    /// A create attempted to reuse an `id` already occupied by a different
    /// automation row -- see [`insert_new_automation`]. Never silently
    /// upserted/hijacked.
    IdCollision,
    /// The caller's [`AutomationOwnerPrecondition`] (a **Bot-ownership**
    /// expectation only -- see the module doc) does not match the
    /// automation's actual current `bot_id`.
    OwnerConflict,
    /// A future, unrecognized schema version was found; the migration
    /// refused to touch the existing tables (contract: "reject a future
    /// version without modifying it").
    UnsupportedSchemaVersion {
        component: &'static str,
        found: i64,
        supported: i64,
    },
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

impl std::fmt::Display for StorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sqlite(e) => write!(f, "sqlite error: {e}"),
            Self::Json(e) => write!(f, "json error: {e}"),
            Self::NotFound(what) => write!(f, "{what} not found"),
            Self::IdCollision => write!(f, "an automation with this id already exists"),
            Self::OwnerConflict => write!(
                f,
                "expected automation owner (Bot ownership) does not match its actual current owner"
            ),
            Self::UnsupportedSchemaVersion {
                component,
                found,
                supported,
            } => write!(
                f,
                "{component} schema version {found} is newer than the {supported} this build supports; refusing to modify it"
            ),
        }
    }
}

impl std::error::Error for StorageError {}

type Result<T> = std::result::Result<T, StorageError>;

fn create_v1_tables(tx: &rusqlite::Transaction) -> Result<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS automations (
            id TEXT PRIMARY KEY,
            bot_id TEXT,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS automations_bot_id ON automations(bot_id);
        CREATE TABLE IF NOT EXISTS automation_runs (
            id TEXT PRIMARY KEY,
            automation_id TEXT NOT NULL,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS automation_runs_automation_id ON automation_runs(automation_id);",
    )?;
    Ok(())
}

/// Additive-only step applied when stepping a database from schema
/// version 1 to version 2. Kept as its own function (rather than folded
/// into `create_v1_tables`) so a database that already recorded version 1
/// visibly runs this step instead of the migration treating "some past
/// version" as synonymous with "already fully current".
fn migrate_v1_to_v2(tx: &rusqlite::Transaction) -> Result<()> {
    tx.execute_batch(
        "CREATE INDEX IF NOT EXISTS automation_runs_automation_id_id ON automation_runs(automation_id, id);",
    )?;
    Ok(())
}

/// Read-only precondition, called by [`migrate`] and by
/// `apply_pending_steps_in_tx` (the single-transaction aggregate startup
/// gate in `Engine::open`): refuses -- without creating or altering any
/// `automations` table -- if this database already recorded a version
/// newer than [`AUTOMATIONS_SCHEMA_VERSION`]. Within the aggregate gate
/// the components are applied sequentially in one transaction, so the
/// no-partial-state property comes from that transaction's
/// rollback-on-any-failure (a later component's refusal undoes an earlier
/// component's already-applied steps), not from checking every component
/// before any of them runs. `schema_versions` itself is shared,
/// version-less tracking infrastructure, not a component's schema, so
/// creating it here (idempotently) is not a side effect this precondition
/// needs to protect against.
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
            params![AUTOMATIONS_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(found) = existing
        && found > AUTOMATIONS_SCHEMA_VERSION
    {
        return Err(StorageError::UnsupportedSchemaVersion {
            component: AUTOMATIONS_SCHEMA_COMPONENT,
            found,
            supported: AUTOMATIONS_SCHEMA_VERSION,
        });
    }
    Ok(())
}

/// Applies every pending `automations` migration step using the caller's
/// already-open transaction; never opens or commits a transaction of its
/// own. This is what `db::migrate_and_recover` (the real single-transaction
/// aggregate startup gate in `Engine::open`) calls, so a genuine SQL
/// failure partway through -- or a sibling component (`bots`) refusing or
/// failing afterward in the *same* transaction -- rolls every step here
/// back too, along with everything else the caller does in that
/// transaction. [`migrate`] below is the independent, standalone entry
/// point (used by tests and any other direct caller) that keeps its own
/// documented per-step-commit behavior; the two are intentionally
/// different call shapes for the same steps, not two schema policies.
pub(crate) fn apply_pending_steps_in_tx(tx: &Transaction) -> Result<()> {
    check_schema_not_ahead(tx)?;
    let existing: Option<i64> = tx
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![AUTOMATIONS_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    let mut from_version = existing.unwrap_or(0);
    while from_version < AUTOMATIONS_SCHEMA_VERSION {
        let next_version = from_version + 1;
        match next_version {
            1 => create_v1_tables(tx)?,
            2 => migrate_v1_to_v2(tx)?,
            _ => unreachable!("no migration step defined for version {next_version}"),
        }
        tx.execute(
            "INSERT INTO schema_versions(component, version) VALUES (?1, ?2)
             ON CONFLICT(component) DO UPDATE SET version = excluded.version",
            params![AUTOMATIONS_SCHEMA_COMPONENT, next_version],
        )?;
        from_version = next_version;
    }
    Ok(())
}

/// Additive, idempotent, reopen-safe, step-wise migration for the
/// `automations` component, as a **standalone** call: opens its own
/// per-step transactions and commits each step immediately (see
/// [`apply_pending_steps_in_tx`] for the single-transaction call shape
/// `Engine::open` actually uses). A freshly-created database jumps
/// straight to [`AUTOMATIONS_SCHEMA_VERSION`]. A database that already
/// recorded an older *supported* version (`0 < found < AUTOMATIONS_SCHEMA_VERSION`)
/// has every intermediate step from `found + 1` up to
/// [`AUTOMATIONS_SCHEMA_VERSION`] applied in order, each in its own
/// transaction with the version row advanced immediately after -- this
/// is the fix for the earlier bug where any recorded version `<= CURRENT`
/// was treated as a no-op regardless of how far behind it actually was.
/// A recorded version newer than [`AUTOMATIONS_SCHEMA_VERSION`] is refused
/// without touching any table (unchanged from before).
pub fn migrate(conn: &Connection) -> Result<()> {
    check_schema_not_ahead(conn)?;
    let existing: Option<i64> = conn
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![AUTOMATIONS_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    let mut from_version = existing.unwrap_or(0);
    if from_version == AUTOMATIONS_SCHEMA_VERSION {
        return Ok(());
    }
    while from_version < AUTOMATIONS_SCHEMA_VERSION {
        let next_version = from_version + 1;
        let tx = conn.unchecked_transaction()?;
        match next_version {
            1 => create_v1_tables(&tx)?,
            2 => migrate_v1_to_v2(&tx)?,
            _ => unreachable!("no migration step defined for version {next_version}"),
        }
        tx.execute(
            "INSERT INTO schema_versions(component, version) VALUES (?1, ?2)
             ON CONFLICT(component) DO UPDATE SET version = excluded.version",
            params![AUTOMATIONS_SCHEMA_COMPONENT, next_version],
        )?;
        tx.commit()?;
        from_version = next_version;
    }
    Ok(())
}

/// Inserts or fully replaces an automation row (keyed by `automation.id`).
/// For legitimate updates to an automation that is known to already exist
/// (ownership repair, field edits). **Never** use this to create a
/// brand-new automation from caller-supplied input -- see
/// [`insert_new_automation`], which cannot silently overwrite/hijack an
/// existing row.
pub fn upsert_automation(conn: &Connection, automation: &Automation) -> Result<()> {
    let payload = serde_json::to_string(automation)?;
    conn.execute(
        "INSERT INTO automations (id, bot_id, payload_json) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET bot_id = excluded.bot_id, payload_json = excluded.payload_json",
        params![automation.id, automation.bot_id, payload],
    )?;
    Ok(())
}

/// Inserts a brand-new automation. Unlike [`upsert_automation`], a
/// collision on `id` (an automation -- foreign-owned, same-owner, or
/// otherwise -- already occupying that id) is a hard
/// [`StorageError::IdCollision`], never a silent overwrite. This is what
/// `bots::storage::create_scheduled_responsibility` must use: a scheduled
/// responsibility creates a *new* automation, it never hijacks an
/// existing one that happens to share an id.
pub fn insert_new_automation(conn: &Connection, automation: &Automation) -> Result<()> {
    let payload = serde_json::to_string(automation)?;
    let outcome = conn.execute(
        "INSERT INTO automations (id, bot_id, payload_json) VALUES (?1, ?2, ?3)",
        params![automation.id, automation.bot_id, payload],
    );
    match outcome {
        Ok(_) => Ok(()),
        Err(rusqlite::Error::SqliteFailure(e, _))
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            Err(StorageError::IdCollision)
        }
        Err(e) => Err(e.into()),
    }
}

pub fn get_automation(conn: &Connection, id: &str) -> Result<Option<Automation>> {
    conn.query_row(
        "SELECT payload_json FROM automations WHERE id = ?1",
        params![id],
        |r| r.get::<_, String>(0),
    )
    .optional()?
    .map(|json| Ok(serde_json::from_str(&json)?))
    .transpose()
}

/// Every automation currently owned by `bot_id` (`Automation.bot_id ==
/// bot_id`), in no particular guaranteed order (see the open
/// locale-ordering gap in the native-state evidence for display ordering
/// concerns generally; this function is used for ownership repair/lookup,
/// not user-facing listing).
pub fn list_automations_owned_by_bot(conn: &Connection, bot_id: &str) -> Result<Vec<Automation>> {
    let mut stmt = conn.prepare("SELECT payload_json FROM automations WHERE bot_id = ?1")?;
    let rows = stmt
        .query_map(params![bot_id], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|json| Ok(serde_json::from_str(&json)?))
        .collect()
}

pub fn list_all_automations(conn: &Connection) -> Result<Vec<Automation>> {
    let mut stmt = conn.prepare("SELECT payload_json FROM automations")?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|json| Ok(serde_json::from_str(&json)?))
        .collect()
}

/// Strips only the `bot_id` ownership field, leaving every other field
/// (and all of the automation's runs) untouched -- the source `deleteBot`
/// semantics (`const { botId: _, ...unowned } = automation`).
pub fn clear_automation_owner(conn: &Connection, automation_id: &str) -> Result<()> {
    let Some(mut automation) = get_automation(conn, automation_id)? else {
        return Ok(());
    };
    automation.bot_id = None;
    upsert_automation(conn, &automation)
}

/// A caller's expectation of which **Bot** (`Automation::bot_id`, or
/// "unowned") currently owns an automation -- see the module doc's
/// "Bot-ownership precondition". This is a Bot-ownership check only; it is
/// not, and must never be described as, a port or approximation of the
/// source's `assertAutomationOwnerFence` (a different, SSH-execution-host
/// concept this crate does not implement -- see the module doc). `None`
/// (no precondition at all) skips the check entirely.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AutomationOwnerPrecondition {
    Owned(String),
    Unowned,
}

/// Refuses a mutation/deletion whose caller-stated expectation of which
/// **Bot** owns `automation` does not match its actual current `bot_id` --
/// covering an expectation that has gone stale because a *different*
/// connection's ownership change committed **before the transaction's read**
/// (see
/// `delete_automation_everywhere_detects_ownership_changed_by_a_concurrent_connection`
/// in the tests). The WAL companion test separately exercises stale-snapshot
/// writes through the storage primitives, not a mid-call interleaving of
/// this function; SQLite rejects those writes with a busy/snapshot error.
/// `expected = None` performs no check at all. Bot ownership
/// only -- see the module doc for why this is unrelated to the source's
/// SSH host-authority fence.
pub fn assert_owner_fence(
    automation: &Automation,
    expected: Option<&AutomationOwnerPrecondition>,
) -> Result<()> {
    let Some(expected) = expected else {
        return Ok(());
    };
    let matches = match expected {
        AutomationOwnerPrecondition::Owned(bot_id) => {
            automation.bot_id.as_deref() == Some(bot_id.as_str())
        }
        AutomationOwnerPrecondition::Unowned => automation.bot_id.is_none(),
    };
    if matches {
        Ok(())
    } else {
        Err(StorageError::OwnerConflict)
    }
}

/// Deletes the automation **and all of its runs** (matching the actual
/// source `deleteAutomation`, which cascades its own run history -- this
/// is distinct from *Bot* deletion, which never touches automation run
/// history). `expected_owner`, if given, is a **Bot-ownership** check
/// only (see the module doc): it is not the source's real
/// `assertAutomationOwnerFence` (SSH host-authority) call, which this
/// crate does not implement -- see the native-state evidence's mandatory
/// follow-on gate. A missing automation is [`StorageError::NotFound`], a
/// present-but-differently-Bot-owned one is [`StorageError::OwnerConflict`],
/// neither ever silently deletes. Removing any Bot-side responsibility
/// projection that referenced it is the caller's responsibility
/// (`bots::storage::delete_automation_everywhere`), performed in the same
/// transaction.
pub fn delete_automation(
    conn: &Connection,
    automation_id: &str,
    expected_owner: Option<&AutomationOwnerPrecondition>,
) -> Result<bool> {
    match get_automation(conn, automation_id)? {
        None => {
            if expected_owner.is_some() {
                return Err(StorageError::NotFound("automation"));
            }
            return Ok(false);
        }
        Some(automation) => assert_owner_fence(&automation, expected_owner)?,
    }
    conn.execute(
        "DELETE FROM automation_runs WHERE automation_id = ?1",
        params![automation_id],
    )?;
    let deleted = conn.execute(
        "DELETE FROM automations WHERE id = ?1",
        params![automation_id],
    )?;
    Ok(deleted > 0)
}

/// Begins a real `BEGIN IMMEDIATE` transaction: acquires SQLite's
/// RESERVED lock up front (rather than the default deferred/optimistic
/// lock a plain `BEGIN` takes), so a second connection attempting the
/// same kind of transaction concurrently blocks (subject to the
/// connection's configured busy timeout, set once in `db.rs`) instead of
/// racing. Used where two connections doing "check, then act" on the
/// same row must be serialized rather than merely detected after the
/// fact -- see `bots::storage::record_responsibility_run`.
pub fn begin_immediate(conn: &Connection) -> Result<Transaction<'_>> {
    Ok(Transaction::new_unchecked(
        conn,
        TransactionBehavior::Immediate,
    )?)
}

pub fn upsert_automation_run(conn: &Connection, run: &AutomationRun) -> Result<()> {
    let payload = serde_json::to_string(run)?;
    conn.execute(
        "INSERT INTO automation_runs (id, automation_id, payload_json) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET automation_id = excluded.automation_id, payload_json = excluded.payload_json",
        params![run.id, run.automation_id, payload],
    )?;
    Ok(())
}

pub fn get_automation_run(conn: &Connection, id: &str) -> Result<Option<AutomationRun>> {
    conn.query_row(
        "SELECT payload_json FROM automation_runs WHERE id = ?1",
        params![id],
        |r| r.get::<_, String>(0),
    )
    .optional()?
    .map(|json| Ok(serde_json::from_str(&json)?))
    .transpose()
}

pub fn list_automation_runs(conn: &Connection, automation_id: &str) -> Result<Vec<AutomationRun>> {
    let mut stmt =
        conn.prepare("SELECT payload_json FROM automation_runs WHERE automation_id = ?1")?;
    let rows = stmt
        .query_map(params![automation_id], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|json| Ok(serde_json::from_str(&json)?))
        .collect()
}

/// Every stored run grouped by automation id: the runs-across-automations
/// scan behind `automation.runs_all`. One pass over the single runs table;
/// ordering is the caller's concern.
pub fn list_all_automation_runs(conn: &Connection) -> Result<Vec<(String, Vec<AutomationRun>)>> {
    let mut stmt = conn.prepare("SELECT automation_id, payload_json FROM automation_runs")?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut order: Vec<String> = Vec::new();
    let mut grouped: std::collections::HashMap<String, Vec<AutomationRun>> =
        std::collections::HashMap::new();
    for (automation_id, json) in rows {
        let runs = grouped.entry(automation_id.clone()).or_default();
        if runs.is_empty() {
            order.push(automation_id);
        }
        runs.push(serde_json::from_str(&json)?);
    }
    Ok(order
        .into_iter()
        .map(|automation_id| {
            let runs = grouped.remove(&automation_id).unwrap_or_default();
            (automation_id, runs)
        })
        .collect())
}
