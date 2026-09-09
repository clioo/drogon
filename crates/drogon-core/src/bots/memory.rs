//! Versioned, project-scoped Bot memory records (C04): the standalone
//! additive domain types a scoped memory store persists and mutates.
//! This module is deliberately independent of the existing unscoped
//! `Bot.memories: Vec<String>` field (that field keeps its meaning until
//! the storage owner's reviewed migration lands; see the checkpoint in
//! `bots::identity`'s module doc): a [`BotMemory`] has a stable id, an
//! explicit global/project scope, an optional project id, a per-record
//! version, provenance and timestamps. Project-scope memories are
//! visible ONLY inside their own project; global memories are visible
//! everywhere but only because each record says `Global` explicitly.
//!
//! Versioning rule: every mutation request carries `expected_version`;
//! a mismatch is a [`MemoryError::VersionConflict`] carrying both the
//! requested and stored versions -- concurrent editors can never
//! silently overwrite each other. Provenance is immutable creation
//! evidence (`User` or the `LegacyGlobal` migration marker); edits bump
//! `version`/`updated_at` without rewriting it.

use serde::{Deserialize, Serialize};

use super::identity::{EditOrigin, EditProvenance};

/// Per-record content bound, mirroring `bots::input`'s per-memory text
/// cap for the legacy field.
pub const MAX_MEMORY_CONTENT_CHARS: usize = 262_144;

/// Per-bot record bound, mirroring `bots::input`'s legacy array cap.
pub const MAX_MEMORIES_PER_BOT: usize = 1000;

/// Explicit scope. A record's scope is never inferred: `Project` REQUIRES
/// a project id and `Global` MUST NOT carry one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryScope {
    Global,
    Project,
}

/// Memory domain errors. The RPC layer maps `VersionConflict` and
/// `AccessDenied` to structured errors; the rest are admission/storage
/// refusals.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemoryError {
    /// User-supplied content must be non-empty after trimming (legacy
    /// migrated rows are exempt -- see [`BotMemory::validate`]).
    EmptyContent,
    ContentTooLong {
        len: usize,
        max: usize,
    },
    /// A `Project`-scope record without a project id is unrepresentable:
    /// refused at creation and refused again at parse time (incompatible
    /// data never loads half-validated).
    ProjectScopeRequiresProjectId,
    /// A `Global` record carrying a project id would silently narrow its
    /// visibility; refused instead.
    GlobalScopeMustNotCarryProjectId,
    VersionConflict {
        expected: u64,
        current: u64,
    },
    MemoryNotFound(String),
    /// A project-scoped record read through a different project's (or no
    /// project's) context. The backend must enforce this, never filter
    /// merely in the renderer.
    AccessDenied {
        memory_id: String,
        required_project_id: String,
    },
    /// Version 0 or a shape this build cannot interpret (unknown scope
    /// string, unknown origin, empty ids). Incompatible future data
    /// refuses safely instead of loading partially.
    InvalidRecord(String),
    BotMismatch {
        expected_bot: String,
        actual_bot: String,
    },
    /// A create that would exceed [`MAX_MEMORIES_PER_BOT`] for one bot.
    MemoryLimitReached {
        max: usize,
    },
}

impl std::fmt::Display for MemoryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyContent => write!(f, "memory content must not be empty"),
            Self::ContentTooLong { len, max } => {
                write!(f, "memory content is {len} chars, maximum is {max}")
            }
            Self::ProjectScopeRequiresProjectId => {
                write!(f, "a project-scoped memory requires a project id")
            }
            Self::GlobalScopeMustNotCarryProjectId => {
                write!(f, "a global memory must not carry a project id")
            }
            Self::VersionConflict { expected, current } => write!(
                f,
                "memory version conflict: expected {expected}, current is {current}"
            ),
            Self::MemoryNotFound(id) => write!(f, "memory {id} not found"),
            Self::AccessDenied {
                memory_id,
                required_project_id,
            } => write!(
                f,
                "memory {memory_id} belongs to project {required_project_id} and is not \
                 accessible from this scope"
            ),
            Self::InvalidRecord(detail) => write!(f, "invalid memory record: {detail}"),
            Self::BotMismatch {
                expected_bot,
                actual_bot,
            } => write!(
                f,
                "memory request targets bot {expected_bot} but state was read for {actual_bot}"
            ),
            Self::MemoryLimitReached { max } => {
                write!(f, "a bot may hold at most {max} memories")
            }
        }
    }
}

impl std::error::Error for MemoryError {}

/// One versioned memory record. Serialized shape is the wire/persistence
/// contract the storage owner persists (camelCase, matching this crate's
/// serde conventions).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BotMemory {
    pub id: String,
    pub bot_id: String,
    pub scope: MemoryScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub content: String,
    /// Monotonic per-record version; starts at 1 and increments on every
    /// applied edit. Mutation requests must carry the version they read.
    pub version: u64,
    pub provenance: EditProvenance,
    pub created_at: f64,
    pub updated_at: f64,
}

/// A create request (user action): content must be non-empty, scope
/// pairing enforced, provenance supplied by the caller.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewMemoryRequest {
    pub bot_id: String,
    pub scope: MemoryScope,
    pub project_id: Option<String>,
    pub content: String,
    pub provenance: EditProvenance,
}

fn validate_user_content(content: &str) -> Result<(), MemoryError> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err(MemoryError::EmptyContent);
    }
    let len = content.chars().count();
    if len > MAX_MEMORY_CONTENT_CHARS {
        return Err(MemoryError::ContentTooLong {
            len,
            max: MAX_MEMORY_CONTENT_CHARS,
        });
    }
    Ok(())
}

fn validate_scope_pairing(scope: MemoryScope, project_id: Option<&str>) -> Result<(), MemoryError> {
    match scope {
        MemoryScope::Project => {
            if project_id
                .map(str::trim)
                .filter(|p| !p.is_empty())
                .is_none()
            {
                return Err(MemoryError::ProjectScopeRequiresProjectId);
            }
        }
        MemoryScope::Global => {
            if project_id.is_some() {
                return Err(MemoryError::GlobalScopeMustNotCarryProjectId);
            }
        }
    }
    Ok(())
}

impl BotMemory {
    /// Shape check for a record about to be persisted or just read back:
    /// non-empty ids, a valid version (>= 1), scope/project pairing, and
    /// content rules per origin. `LegacyGlobal` rows may hold any string
    /// verbatim -- the migration preserves every legacy entry, including
    /// blank ones, rather than deleting anything (user-visible blanks are
    /// filtered at composition, as the legacy prompt path always did).
    pub fn validate(&self) -> Result<(), MemoryError> {
        if self.id.trim().is_empty() {
            return Err(MemoryError::InvalidRecord("id must not be empty".into()));
        }
        if self.bot_id.trim().is_empty() {
            return Err(MemoryError::InvalidRecord(
                "bot id must not be empty".into(),
            ));
        }
        if self.version == 0 {
            return Err(MemoryError::InvalidRecord(format!(
                "version 0 is not valid for memory {}",
                self.id
            )));
        }
        if self
            .provenance
            .request_id
            .as_ref()
            .is_some_and(|r| r.is_empty())
        {
            return Err(MemoryError::InvalidRecord(
                "provenance request id must be omitted, not empty".into(),
            ));
        }
        if !matches!(
            self.provenance.origin,
            EditOrigin::User | EditOrigin::LegacyGlobal
        ) {
            return Err(MemoryError::InvalidRecord(format!(
                "unknown provenance origin {:?}",
                self.provenance.origin
            )));
        }
        validate_scope_pairing(self.scope, self.project_id.as_deref())?;
        if self.provenance.origin == EditOrigin::LegacyGlobal {
            let len = self.content.chars().count();
            if len > MAX_MEMORY_CONTENT_CHARS {
                return Err(MemoryError::ContentTooLong {
                    len,
                    max: MAX_MEMORY_CONTENT_CHARS,
                });
            }
        } else {
            validate_user_content(&self.content)?;
        }
        Ok(())
    }

    /// Strictly-decoding shape check for persisted payloads: unknown
    /// `scope`/`origin` strings fail serde and surface as
    /// [`MemoryError::InvalidRecord`] -- incompatible future data refuses
    /// safely, never silently reinterpreted.
    pub fn parse_record(value: &serde_json::Value) -> Result<Self, MemoryError> {
        let record: Self = serde_json::from_value(value.clone()).map_err(|e| {
            MemoryError::InvalidRecord(format!("does not match the memory record shape: {e}"))
        })?;
        record.validate()?;
        Ok(record)
    }
}

/// Validates and mints a record for a user create. `mint_id` is injected
/// so the storage owner supplies real unique ids (production) and tests
/// deterministic ones; `at` is the caller's clock sample.
pub fn new_memory(
    request: &NewMemoryRequest,
    mint_id: impl FnOnce() -> String,
    at: f64,
) -> Result<BotMemory, MemoryError> {
    if request.bot_id.trim().is_empty() {
        return Err(MemoryError::InvalidRecord(
            "bot id must not be empty".into(),
        ));
    }
    validate_user_content(&request.content)?;
    validate_scope_pairing(request.scope, request.project_id.as_deref())?;
    if !matches!(
        request.provenance.origin,
        EditOrigin::User | EditOrigin::LegacyGlobal
    ) {
        return Err(MemoryError::InvalidRecord(format!(
            "unknown provenance origin {:?}",
            request.provenance.origin
        )));
    }
    Ok(BotMemory {
        id: mint_id(),
        bot_id: request.bot_id.clone(),
        scope: request.scope,
        project_id: request.project_id.clone(),
        content: request.content.clone(),
        version: 1,
        provenance: request.provenance.clone(),
        created_at: at,
        updated_at: at,
    })
}

/// Applies a user content edit under expected-version CAS. The record's
/// identity fields (id, bot, scope, project, provenance, created_at) are
/// immutable; only content, version and updated_at move. A stale
/// `expected_version` is [`MemoryError::VersionConflict`] -- the caller
/// must re-read; nothing is partially applied.
pub fn edit_memory(
    existing: &BotMemory,
    expected_version: u64,
    content: &str,
    at: f64,
) -> Result<BotMemory, MemoryError> {
    existing.validate()?;
    if expected_version == 0 {
        return Err(MemoryError::InvalidRecord(
            "expected version 0 is not valid".into(),
        ));
    }
    if expected_version != existing.version {
        return Err(MemoryError::VersionConflict {
            expected: expected_version,
            current: existing.version,
        });
    }
    validate_user_content(content)?;
    Ok(BotMemory {
        id: existing.id.clone(),
        bot_id: existing.bot_id.clone(),
        scope: existing.scope,
        project_id: existing.project_id.clone(),
        content: content.to_string(),
        version: existing.version + 1,
        provenance: existing.provenance.clone(),
        created_at: existing.created_at,
        updated_at: at,
    })
}

/// Domain-level CAS check for a delete: the storage owner performs the
/// row deletion only after this returns `Ok`. A stale expected version
/// conflicts exactly like an edit.
pub fn delete_memory(existing: &BotMemory, expected_version: u64) -> Result<(), MemoryError> {
    existing.validate()?;
    if expected_version == 0 {
        return Err(MemoryError::InvalidRecord(
            "expected version 0 is not valid".into(),
        ));
    }
    if expected_version != existing.version {
        return Err(MemoryError::VersionConflict {
            expected: expected_version,
            current: existing.version,
        });
    }
    Ok(())
}

/// Backend access rule: a project-scoped record is accessible only
/// through its own project's context; global records are accessible from
/// every context, including none. Returns the offending record's project
/// in [`MemoryError::AccessDenied`] so the RPC layer can render a
/// structured refusal.
pub fn assert_project_access(
    record: &BotMemory,
    project_id: Option<&str>,
) -> Result<(), MemoryError> {
    record.validate()?;
    match record.scope {
        MemoryScope::Global => Ok(()),
        MemoryScope::Project => {
            let required = record.project_id.as_deref().unwrap_or_default();
            if project_id == Some(required) {
                Ok(())
            } else {
                Err(MemoryError::AccessDenied {
                    memory_id: record.id.clone(),
                    required_project_id: required.to_string(),
                })
            }
        }
    }
}

/// The visible set for a turn/project context: every `Global` record plus
/// exactly the `Project` records of `project_id` (none when the context
/// is project-less). Order follows the input slice (the storage layer's
/// stable read order); filtering here is a domain helper -- the RPC list
/// endpoint must apply the same rule server-side.
pub fn visible_memories<'a>(
    records: &'a [BotMemory],
    project_id: Option<&str>,
) -> Vec<&'a BotMemory> {
    records
        .iter()
        .filter(|record| match record.scope {
            MemoryScope::Global => true,
            MemoryScope::Project => record.project_id.as_deref() == project_id,
        })
        .collect()
}

/// One-time legacy migration (C04 checkpoint rule): every legacy
/// `Bot.memories` string becomes a `Global` record with
/// `origin: legacy-global` provenance, content preserved VERBATIM (no
/// trimming, no dropping, no project reassignment -- legacy entries were
/// global-by-construction and keep that exact meaning). IDs are minted
/// per entry via `mint_id` so they are stable once persisted. This
/// function never mutates the legacy `Bot` field itself; the storage
/// owner writes the returned records and coordinates the field's
/// retirement.
pub fn migrate_legacy_memories(
    bot_id: &str,
    legacy: &[String],
    mint_id: &mut impl FnMut() -> String,
    at: f64,
) -> Result<Vec<BotMemory>, MemoryError> {
    if bot_id.trim().is_empty() {
        return Err(MemoryError::InvalidRecord(
            "bot id must not be empty".into(),
        ));
    }
    if legacy.len() > MAX_MEMORIES_PER_BOT {
        return Err(MemoryError::MemoryLimitReached {
            max: MAX_MEMORIES_PER_BOT,
        });
    }
    Ok(legacy
        .iter()
        .map(|content| BotMemory {
            id: mint_id(),
            bot_id: bot_id.to_string(),
            scope: MemoryScope::Global,
            project_id: None,
            content: content.clone(),
            version: 1,
            provenance: EditProvenance {
                origin: EditOrigin::LegacyGlobal,
                request_id: None,
            },
            created_at: at,
            updated_at: at,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(id: &str, scope: MemoryScope, project: Option<&str>, content: &str) -> BotMemory {
        BotMemory {
            id: id.to_string(),
            bot_id: "bot-1".to_string(),
            scope,
            project_id: project.map(str::to_string),
            content: content.to_string(),
            version: 2,
            provenance: EditProvenance::user(Some("req-1".to_string())),
            created_at: 1.0,
            updated_at: 2.0,
        }
    }

    #[test]
    fn create_enforces_scope_pairing_and_content() {
        let base = |scope: MemoryScope, project: Option<&str>, content: &str| NewMemoryRequest {
            bot_id: "bot-1".to_string(),
            scope,
            project_id: project.map(str::to_string),
            content: content.to_string(),
            provenance: EditProvenance::user(Some("req-2".to_string())),
        };
        assert_eq!(
            new_memory(
                &base(MemoryScope::Project, None, "fact"),
                || "m-1".into(),
                5.0
            )
            .unwrap_err(),
            MemoryError::ProjectScopeRequiresProjectId
        );
        assert_eq!(
            new_memory(
                &base(MemoryScope::Global, Some("p-1"), "fact"),
                || "m-1".into(),
                5.0
            )
            .unwrap_err(),
            MemoryError::GlobalScopeMustNotCarryProjectId
        );
        assert_eq!(
            new_memory(
                &base(MemoryScope::Global, None, "   "),
                || "m-1".into(),
                5.0
            )
            .unwrap_err(),
            MemoryError::EmptyContent
        );
        let created = new_memory(
            &base(MemoryScope::Project, Some("p-1"), " fact "),
            || "m-1".into(),
            5.0,
        )
        .expect("creates");
        assert_eq!(created.version, 1);
        assert_eq!(created.project_id.as_deref(), Some("p-1"));
    }

    #[test]
    fn edit_bumps_version_and_conflicts_on_stale_expected() {
        let subject = record("m-1", MemoryScope::Global, None, "v2 text");
        let next = edit_memory(&subject, 2, "v3 text", 9.0).expect("edits");
        assert_eq!(next.version, 3);
        assert_eq!(next.updated_at, 9.0);
        assert_eq!(next.created_at, 1.0);
        assert_eq!(
            edit_memory(&subject, 1, "stale", 9.0).unwrap_err(),
            MemoryError::VersionConflict {
                expected: 1,
                current: 2
            }
        );
    }

    #[test]
    fn delete_conflicts_on_stale_expected() {
        let subject = record("m-1", MemoryScope::Global, None, "text");
        assert!(delete_memory(&subject, 2).is_ok());
        assert_eq!(
            delete_memory(&subject, 3).unwrap_err(),
            MemoryError::VersionConflict {
                expected: 3,
                current: 2
            }
        );
    }

    #[test]
    fn access_denied_across_projects_and_allowed_for_owner_and_global() {
        let project_a = record("m-a", MemoryScope::Project, Some("proj-a"), "A");
        assert!(assert_project_access(&project_a, Some("proj-a")).is_ok());
        assert_eq!(
            assert_project_access(&project_a, Some("proj-b")).unwrap_err(),
            MemoryError::AccessDenied {
                memory_id: "m-a".into(),
                required_project_id: "proj-a".into()
            }
        );
        assert!(assert_project_access(&project_a, None).is_err());
        let global = record("m-g", MemoryScope::Global, None, "G");
        assert!(assert_project_access(&global, None).is_ok());
        assert!(assert_project_access(&global, Some("proj-b")).is_ok());
    }

    #[test]
    fn visibility_filters_project_records_by_context() {
        let records = vec![
            record("m-g", MemoryScope::Global, None, "G"),
            record("m-a", MemoryScope::Project, Some("proj-a"), "A"),
            record("m-b", MemoryScope::Project, Some("proj-b"), "B"),
        ];
        let for_a = visible_memories(&records, Some("proj-a"));
        assert_eq!(
            for_a.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            vec!["m-g", "m-a"]
        );
        let for_b = visible_memories(&records, Some("proj-b"));
        assert_eq!(
            for_b.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            vec!["m-g", "m-b"]
        );
        assert_eq!(visible_memories(&records, None).len(), 1);
    }

    #[test]
    fn legacy_migration_preserves_every_entry_verbatim_as_legacy_global() {
        let mut ids = ["m-1", "m-2", "m-3"].iter();
        let mut mint = || ids.next().unwrap().to_string();
        let migrated = migrate_legacy_memories(
            "bot-1",
            &[
                "Prefers terse replies.".to_string(),
                "   ".to_string(),
                "Ships on Fridays.".to_string(),
            ],
            &mut mint,
            7.0,
        )
        .expect("migrates");
        assert_eq!(migrated.len(), 3);
        assert!(
            migrated
                .iter()
                .all(|m| m.scope == MemoryScope::Global && m.version == 1)
        );
        assert!(
            migrated
                .iter()
                .all(|m| m.provenance.origin == EditOrigin::LegacyGlobal)
        );
        assert_eq!(migrated[1].content, "   ");
        assert_eq!(migrated[2].id, "m-3");
        for record in &migrated {
            record.validate().expect("legacy rows validate");
        }
    }

    #[test]
    fn parse_record_refuses_incompatible_future_data_safely() {
        let good = record("m-1", MemoryScope::Global, None, "text");
        let value = serde_json::to_value(&good).expect("serializes");
        assert_eq!(BotMemory::parse_record(&value).expect("parses"), good);
        // Unknown scope string: refused, not reinterpreted.
        let mut future = value.clone();
        future["scope"] = serde_json::Value::String("workspace".into());
        assert!(BotMemory::parse_record(&future).is_err());
        // Version 0: refused.
        let mut zero = value;
        zero["version"] = serde_json::Value::from(0);
        assert!(BotMemory::parse_record(&zero).is_err());
    }
}
