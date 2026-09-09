//! Versioned Bot identity domain operations (C04): pure, additive edits
//! over the identity fields the existing [`Bot`] record already carries
//! (`display_identity`, `instructions`), with explicit expected-version
//! compare-and-swap semantics and provenance. This module adds NO fields
//! to [`Bot`] itself: the identity version is a standalone counter the
//! storage owner persists alongside the Bot row (checkpoint
//! msg_068595e02641), supplied here as an explicit argument so the domain
//! layer never guesses a version. Kept meanings: `instructions` stays
//! free-standing text the operating prompt trims for display, the handle
//! stays normalized (trimmed, one leading `@` stripped, empty dropped)
//! exactly like `records::normalize_bot`, and the title stays optional.

use serde::{Deserialize, Serialize};

use super::records::{Bot, DisplayIdentity};
use crate::claim_identity::js_trim;

/// Bots created before identity versioning (and every new Bot) start at
/// version 1; every applied edit increments by exactly one.
pub const INITIAL_IDENTITY_VERSION: u64 = 1;

/// Shared provenance vocabulary for C04 mutations. `LegacyGlobal` is
/// produced only by the memory migration (`super::memory`); identity
/// edits are always `User`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EditOrigin {
    /// An explicit user/agent edit request.
    User,
    /// Migrated from the pre-scope `Bot.memories: Vec<String>` field;
    /// never minted by a live mutation.
    LegacyGlobal,
}

/// Who issued an edit and through which request. `request_id` is the
/// caller-chosen envelope id (same convention as `bot.create`/`bot.run`)
/// so a retried request stays traceable in provenance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditProvenance {
    pub origin: EditOrigin,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

impl EditProvenance {
    pub fn user(request_id: Option<String>) -> Self {
        Self {
            origin: EditOrigin::User,
            request_id,
        }
    }
}

/// A read-only view of a Bot's identity-bearing fields plus the explicit
/// version the storage layer persists for them. `identity_version` is
/// what mutation requests must match as `expected_identity_version`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityState {
    pub bot_id: String,
    pub identity_version: u64,
    pub display_identity: DisplayIdentity,
    pub instructions: String,
    pub updated_at: f64,
}

/// Identity domain errors. `VersionConflict` is the exact shape the RPC
/// layer must surface (a structured `versionConflict` carrying both
/// versions) so a losing writer is told its `expected` vs the stored
/// `current` instead of silently overwriting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentityError {
    /// The request targets a different Bot than the state was read from;
    /// refused rather than applied to the wrong record.
    BotMismatch {
        expected_bot: String,
        actual_bot: String,
    },
    VersionConflict {
        expected: u64,
        current: u64,
    },
    /// Version 0 is never valid: records start at
    /// [`INITIAL_IDENTITY_VERSION`]. A zero arriving from storage means
    /// incompatible/corrupt data and is refused, never silently bumped.
    InvalidVersion(u64),
    EmptyDisplayName,
}

impl std::fmt::Display for IdentityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BotMismatch {
                expected_bot,
                actual_bot,
            } => write!(
                f,
                "identity request targets bot {expected_bot} but state was read for {actual_bot}"
            ),
            Self::VersionConflict { expected, current } => write!(
                f,
                "identity version conflict: expected {expected}, current is {current}"
            ),
            Self::InvalidVersion(version) => {
                write!(f, "identity version {version} is not a valid version")
            }
            Self::EmptyDisplayName => write!(f, "display name must not be empty"),
        }
    }
}

impl std::error::Error for IdentityError {}

impl IdentityState {
    /// Reads the identity view off a real [`Bot`] record, tagged with the
    /// identity version its storage row carries. The Bot record itself is
    /// never mutated by this module.
    pub fn from_bot(bot: &Bot, identity_version: u64) -> Result<Self, IdentityError> {
        if identity_version == 0 {
            return Err(IdentityError::InvalidVersion(identity_version));
        }
        Ok(Self {
            bot_id: bot.id.clone(),
            identity_version,
            display_identity: bot.display_identity.clone(),
            instructions: bot.instructions.clone(),
            updated_at: bot.updated_at,
        })
    }
}

/// An explicit identity edit: the whole editable identity surface is
/// supplied (no field-level partials), because the editor form submits
/// the fields it showed. Normalization happens in [`apply_identity_edit`],
/// not on the wire shape.
#[derive(Debug, Clone, PartialEq)]
pub struct IdentityEditRequest {
    pub bot_id: String,
    pub expected_identity_version: u64,
    pub provenance: EditProvenance,
    pub display_identity: DisplayIdentity,
    pub instructions: String,
}

/// Applies an identity edit to `state` under expected-version CAS.
///
/// - A stale `expected_identity_version` is a [`IdentityError::
///   VersionConflict`]: the caller must re-read and re-submit, never
///   silently lose the other writer's change.
/// - The display name is trimmed and must be non-empty (the same rule
///   `records::normalize_bot` enforces on load); handle/title normalize
///   exactly like `normalize_bot` (trim, strip one leading `@`, empty
///   dropped). `instructions` is preserved verbatim -- the operating
///   prompt trims it for display, and the record keeps the user's text.
/// - On success the returned state carries `identity_version + 1` and
///   `updated_at = at`; the caller persists `request.provenance` beside
///   it. `provenance` is validated only insofar as the RPC layer stamps
///   it; the domain layer never mints provenance itself.
pub fn apply_identity_edit(
    state: &IdentityState,
    request: &IdentityEditRequest,
    at: f64,
) -> Result<IdentityState, IdentityError> {
    if request.bot_id != state.bot_id {
        return Err(IdentityError::BotMismatch {
            expected_bot: request.bot_id.clone(),
            actual_bot: state.bot_id.clone(),
        });
    }
    if state.identity_version == 0 || request.expected_identity_version == 0 {
        return Err(IdentityError::InvalidVersion(
            request.expected_identity_version,
        ));
    }
    if request.expected_identity_version != state.identity_version {
        return Err(IdentityError::VersionConflict {
            expected: request.expected_identity_version,
            current: state.identity_version,
        });
    }
    let display_name = js_trim(&request.display_identity.display_name).to_string();
    if display_name.is_empty() {
        return Err(IdentityError::EmptyDisplayName);
    }
    let handle = request
        .display_identity
        .handle
        .as_deref()
        .map(js_trim)
        .map(|h| h.trim_start_matches('@').to_string())
        .filter(|h| !h.is_empty());
    let title = request
        .display_identity
        .title
        .as_deref()
        .map(js_trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string);
    Ok(IdentityState {
        bot_id: state.bot_id.clone(),
        identity_version: state.identity_version + 1,
        display_identity: DisplayIdentity {
            display_name,
            handle,
            title,
        },
        instructions: request.instructions.clone(),
        updated_at: at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> IdentityState {
        IdentityState {
            bot_id: "bot-1".to_string(),
            identity_version: 3,
            display_identity: DisplayIdentity {
                display_name: "Arya".to_string(),
                handle: Some("arya".to_string()),
                title: Some("Scout".to_string()),
            },
            instructions: "Guard the realm.".to_string(),
            updated_at: 10.0,
        }
    }

    fn request(expected: u64) -> IdentityEditRequest {
        IdentityEditRequest {
            bot_id: "bot-1".to_string(),
            expected_identity_version: expected,
            provenance: EditProvenance::user(Some("req-1".to_string())),
            display_identity: DisplayIdentity {
                display_name: "Arya Stark".to_string(),
                handle: Some("@arya".to_string()),
                title: Some("  Scout  ".to_string()),
            },
            instructions: "New instructions.".to_string(),
        }
    }

    #[test]
    fn applies_edit_bumping_version_and_normalizing_identity() {
        let next = apply_identity_edit(&state(), &request(3), 20.0).expect("applies");
        assert_eq!(next.identity_version, 4);
        assert_eq!(next.display_identity.display_name, "Arya Stark");
        assert_eq!(next.display_identity.handle.as_deref(), Some("arya"));
        assert_eq!(next.display_identity.title.as_deref(), Some("Scout"));
        assert_eq!(next.instructions, "New instructions.");
        assert_eq!(next.updated_at, 20.0);
    }

    #[test]
    fn stale_expected_version_conflicts_without_applying() {
        let err = apply_identity_edit(&state(), &request(2), 20.0).unwrap_err();
        assert_eq!(
            err,
            IdentityError::VersionConflict {
                expected: 2,
                current: 3
            }
        );
    }

    #[test]
    fn refuses_wrong_bot_zero_version_and_blank_name() {
        let mut wrong = request(3);
        wrong.bot_id = "bot-2".to_string();
        assert!(matches!(
            apply_identity_edit(&state(), &wrong, 20.0),
            Err(IdentityError::BotMismatch { .. })
        ));
        let mut zero = request(0);
        zero.display_identity.display_name = "x".to_string();
        assert_eq!(
            apply_identity_edit(&state(), &zero, 20.0).unwrap_err(),
            IdentityError::InvalidVersion(0)
        );
        let mut blank = request(3);
        blank.display_identity.display_name = "   ".to_string();
        assert_eq!(
            apply_identity_edit(&state(), &blank, 20.0).unwrap_err(),
            IdentityError::EmptyDisplayName
        );
    }

    #[test]
    fn drops_empty_handle_and_title_like_normalize_bot() {
        let mut cleared = request(3);
        cleared.display_identity.handle = Some("  ".to_string());
        cleared.display_identity.title = Some("".to_string());
        let next = apply_identity_edit(&state(), &cleared, 20.0).expect("applies");
        assert_eq!(next.display_identity.handle, None);
        assert_eq!(next.display_identity.title, None);
    }

    #[test]
    fn from_bot_refuses_version_zero() {
        let bot = crate::bots::records::Bot {
            id: "bot-1".to_string(),
            character_preset: "none".to_string(),
            display_identity: DisplayIdentity {
                display_name: "Arya".to_string(),
                handle: None,
                title: None,
            },
            harness_policy: crate::bots::records::HarnessModelPolicy {
                default_harness: "codex".to_string(),
                explicit_model: None,
            },
            instructions: String::new(),
            memories: Vec::new(),
            responsibilities: Vec::new(),
            current_session: None,
            created_at: 0.0,
            updated_at: 0.0,
        };
        assert_eq!(
            IdentityState::from_bot(&bot, 0).unwrap_err(),
            IdentityError::InvalidVersion(0)
        );
        let state = IdentityState::from_bot(&bot, 1).expect("reads");
        assert_eq!(state.identity_version, INITIAL_IDENTITY_VERSION);
    }
}
