//! Selection validation: verdicts for a `(harness, provider, model,
//! effort)` selection against a [`crate::catalog::HostCatalog`], with
//! model-change invalidation through the catalog's non-security freshness
//! token.
//!
//! The verdict vocabulary is deliberately honest (C01-A requirement):
//! there is no bare "confirmed". A selection either matches an entry the
//! harness's own surface enumerated under recorded provenance
//! ([`SelectionVerdict::Enumerated`]), is a syntactically valid manual ID
//! the host cannot verify ([`SelectionVerdict::ManualUnverified`]), fails a
//! shape/capability/effort check, or is unknown. Discovery proves
//! enumeration and installation scope — never authorization, quota, or
//! reliable continuity — so no variant here claims those.

use serde::Serialize;

use crate::catalog::{EnumerationStatus, HostCatalog, freshness_token};
use crate::{HarnessAvailability, HarnessId};

/// A user's launch-default or form selection. Empty/None fields mean
/// "harness default", matching `harness.start`'s vocabulary.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessSelection {
    pub harness: HarnessId,
    /// Provider selection is Pi-only, mirroring `plan_launch`.
    pub provider: Option<String>,
    pub model: Option<String>,
    pub effort: Option<String>,
}

/// Per-harness accepted effort levels. These mirror the existing launch
/// adapter (`crates/drogon-harness/src/launch.rs`, `plan_launch`) and were
/// re-verified against the installed CLIs' own help output during C01-A
/// (`pi --help` 0.85.1 documents `--thinking` levels off..max; `claude
/// --help` 2.1.266 documents `--effort` low..max). If `launch.rs` and this
/// table ever drift, `plan_launch` remains the launch authority — this
/// table only decides what selection validation advertises.
pub fn allowed_efforts(harness: HarnessId) -> &'static [&'static str] {
    match harness {
        HarnessId::Claude => &["low", "medium", "high", "xhigh", "max"],
        HarnessId::Pi => &["off", "minimal", "low", "medium", "high", "xhigh", "max"],
        HarnessId::Antigravity => &["low", "medium", "high"],
        HarnessId::Codex => &["minimal", "low", "medium", "high", "xhigh", "max", "ultra"],
        // plan_launch refuses OpenCode effort selection outright.
        HarnessId::Opencode => &[],
    }
}

/// The verdict for one selection. Every variant carries enough context for
/// a UI to explain itself without inventing claims.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionVerdict {
    /// The selection matched a catalog entry the harness's own surface
    /// enumerated, under the catalog's recorded provenance. Proves
    /// enumeration under that scope only — not authorization or quota.
    Enumerated {
        provider: Option<String>,
        model: String,
        /// The catalog's config scope string, for display next to the
        /// verdict so the user sees *what* enumeration confirmed it.
        scope: String,
    },
    /// Provider only: the provider is enumerated; the model rides the
    /// provider default. Same enumeration-only proof as `Enumerated`.
    ProviderDefault { provider: String, scope: String },
    /// The harness exposes no enumeration surface (or the catalog probe is
    /// auth-empty / failed), so a syntactically valid selection cannot be
    /// host-verified. Shape and capability checks passed; the ID is carried
    /// unverified, exactly the coordinator's "manual unverified IDs" path —
    /// never upgraded to a confirmation.
    ManualUnverified {
        reason: String,
        /// Entries the catalog did enumerate (empty for auth-empty or
        /// no-surface catalogs), for "did you mean" suggestions.
        known: Vec<String>,
    },
    /// The executable is not installed on this host.
    NotInstalled,
    /// The provider does not appear in the enumerated catalog.
    UnknownProvider {
        provider: String,
        known_providers: Vec<String>,
    },
    /// The provider is enumerated but this model id is not.
    UnknownModel {
        provider: Option<String>,
        model: String,
        known_models: Vec<String>,
    },
    /// A model id without a provider matched more than one enumerated
    /// entry. Refused rather than silently pinned to one provider.
    AmbiguousModel { model: String, matches: Vec<String> },
    /// The model is enumerated but does not advertise the capability the
    /// selection requires (`thinking` for a thinking-override effort on a
    /// `thinking: no` model).
    CapabilityUnsupported { capability: String, model: String },
    /// The effort level is not advertised for this harness.
    UnsupportedEffort {
        effort: String,
        allowed: Vec<String>,
    },
    /// Field shape is invalid (mirrors `plan_launch`'s value checks).
    Malformed {
        field: &'static str,
        reason: &'static str,
    },
    /// The catalog's probe failed in a way that makes any verdict
    /// dishonest (parse failure, timeout, spawn failure).
    CatalogUnavailable { reason: String },
}

/// Validate a selection against a catalog for the SAME harness. A harness
/// mismatch is a caller bug and returns `Malformed`.
pub fn validate_selection(selection: &HarnessSelection, catalog: &HostCatalog) -> SelectionVerdict {
    if selection.harness != catalog.harness {
        return SelectionVerdict::Malformed {
            field: "harness",
            reason: "selection and catalog name different harnesses",
        };
    }
    for (field, value) in [
        ("provider", &selection.provider),
        ("model", &selection.model),
        ("effort", &selection.effort),
    ] {
        if let Some(value) = value
            && let Some(reason) = field_shape_error(value)
        {
            return SelectionVerdict::Malformed { field, reason };
        }
    }
    if let Some(effort) = &selection.effort {
        let allowed = allowed_efforts(selection.harness);
        if !allowed.contains(&effort.as_str()) {
            return SelectionVerdict::UnsupportedEffort {
                effort: effort.clone(),
                allowed: allowed.iter().map(|level| level.to_string()).collect(),
            };
        }
    }
    if selection.provider.is_some() && selection.harness != HarnessId::Pi {
        return SelectionVerdict::Malformed {
            field: "provider",
            reason: "provider selection is available only for Pi",
        };
    }
    if catalog.availability != HarnessAvailability::Available {
        return SelectionVerdict::NotInstalled;
    }
    match catalog.status {
        EnumerationStatus::Enumerated => validate_against_entries(selection, catalog),
        EnumerationStatus::UnsupportedSurface => manual_unverified(
            catalog,
            "this harness exposes no model enumeration surface; the id will be \
             passed to the harness unverified",
        ),
        EnumerationStatus::TimedOut
        | EnumerationStatus::ParseFailed
        | EnumerationStatus::ProbeFailed
        | EnumerationStatus::IsolationFailed
        | EnumerationStatus::UnsupportedPlatform => SelectionVerdict::CatalogUnavailable {
            reason: catalog.note.clone().unwrap_or_else(|| {
                "the catalog probe failed; try again before launching".to_string()
            }),
        },
        EnumerationStatus::NotInstalled => SelectionVerdict::NotInstalled,
    }
}

/// Sorted, deduped `provider/id` display keys for any set of entries.
fn known_keys<'a>(
    entries: impl IntoIterator<Item = &'a crate::catalog::CatalogEntry>,
) -> Vec<String> {
    let mut keys: Vec<String> = entries
        .into_iter()
        .map(|entry| match &entry.provider {
            Some(provider) => format!("{provider}/{}", entry.id),
            None => entry.id.clone(),
        })
        .collect();
    keys.sort();
    keys.dedup();
    keys
}

fn validate_against_entries(
    selection: &HarnessSelection,
    catalog: &HostCatalog,
) -> SelectionVerdict {
    let scope = catalog
        .provenance
        .as_ref()
        .map(|provenance| provenance.config_scope.clone())
        .unwrap_or_default();
    // An auth-empty or genuinely empty enumeration cannot confirm anything.
    if catalog.entries.is_empty() {
        return manual_unverified(
            catalog,
            "the enumeration came back empty under its recorded scope (e.g. no \
             provider auth in the probe config); the id is carried unverified",
        );
    }
    match (&selection.provider, &selection.model) {
        (Some(provider), Some(model)) => {
            let provider_entries: Vec<_> = catalog
                .entries
                .iter()
                .filter(|entry| entry.provider.as_deref() == Some(provider.as_str()))
                .collect();
            if provider_entries.is_empty() {
                let mut known_providers: Vec<String> = catalog
                    .entries
                    .iter()
                    .filter_map(|entry| entry.provider.clone())
                    .collect();
                known_providers.sort();
                known_providers.dedup();
                return SelectionVerdict::UnknownProvider {
                    provider: provider.clone(),
                    known_providers,
                };
            }
            let entry = provider_entries.iter().find(|entry| entry.id == *model);
            match entry {
                Some(entry) => capability_check(selection, entry, scope),
                None => SelectionVerdict::UnknownModel {
                    provider: Some(provider.clone()),
                    model: model.clone(),
                    known_models: provider_entries
                        .iter()
                        .map(|entry| entry.id.clone())
                        .collect(),
                },
            }
        }
        (Some(provider), None) => {
            let known = catalog
                .entries
                .iter()
                .any(|entry| entry.provider.as_deref() == Some(provider.as_str()));
            if known {
                SelectionVerdict::ProviderDefault {
                    provider: provider.clone(),
                    scope,
                }
            } else {
                let mut known_providers: Vec<String> = catalog
                    .entries
                    .iter()
                    .filter_map(|entry| entry.provider.clone())
                    .collect();
                known_providers.sort();
                known_providers.dedup();
                SelectionVerdict::UnknownProvider {
                    provider: provider.clone(),
                    known_providers,
                }
            }
        }
        (None, Some(model)) => {
            let matches: Vec<&crate::catalog::CatalogEntry> = catalog
                .entries
                .iter()
                .filter(|entry| entry.id == *model)
                .collect();
            match matches.len() {
                0 => SelectionVerdict::UnknownModel {
                    provider: None,
                    model: model.clone(),
                    known_models: known_keys(&catalog.entries),
                },
                1 => capability_check(selection, matches[0], scope),
                _ => SelectionVerdict::AmbiguousModel {
                    model: model.clone(),
                    matches: known_keys(matches),
                },
            }
        }
        (None, None) => SelectionVerdict::ProviderDefault {
            provider: "harness-default".to_string(),
            scope,
        },
    }
}

/// Pi's `--thinking` effort rides on the model's thinking capability; the
/// catalog reports it per entry. A thinking override on a `thinking: no`
/// model is a capability mismatch, not a confirmation.
fn capability_check(
    selection: &HarnessSelection,
    entry: &crate::catalog::CatalogEntry,
    scope: String,
) -> SelectionVerdict {
    if selection.harness == HarnessId::Pi
        && selection.effort.is_some()
        && entry.thinking == Some(false)
    {
        return SelectionVerdict::CapabilityUnsupported {
            capability: "thinking".to_string(),
            model: entry.id.clone(),
        };
    }
    SelectionVerdict::Enumerated {
        provider: entry.provider.clone(),
        model: entry.id.clone(),
        scope,
    }
}

fn manual_unverified(catalog: &HostCatalog, reason: &str) -> SelectionVerdict {
    let mut known: Vec<String> = catalog
        .entries
        .iter()
        .map(|entry| match &entry.provider {
            Some(provider) => format!("{provider}/{}", entry.id),
            None => entry.id.clone(),
        })
        .collect();
    known.sort();
    known.dedup();
    let reason = match &catalog.note {
        Some(note) => format!("{reason} ({note})"),
        None => reason.to_string(),
    };
    SelectionVerdict::ManualUnverified { reason, known }
}

/// `plan_launch`-compatible value shape checks, shared so the form layer
/// and the launch adapter refuse the same inputs.
fn field_shape_error(value: &str) -> Option<&'static str> {
    if value.is_empty() || value.len() > 512 {
        Some("must be 1..512 bytes")
    } else if value.chars().any(char::is_control) {
        Some("must not contain control characters")
    } else if value.starts_with('-') {
        Some("must not start with '-'")
    } else {
        None
    }
}

/// A durable selection record: the selection plus the catalog freshness
/// token it was validated against. Staleness is the model-change
/// invalidation signal — a version bump, catalog refresh or model-set
/// change produces a different token, and the record must be revalidated.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionRecord {
    pub selection: HarnessSelection,
    /// [`freshness_token`] of the catalog at validation time. Explicitly
    /// non-security; integrity comes from the core runtime lock, not here.
    pub catalog_freshness: String,
    /// The verdict at validation time, for display without revalidation.
    pub verdict: SelectionVerdict,
}

impl SelectionRecord {
    pub fn new(selection: HarnessSelection, catalog: &HostCatalog) -> Self {
        let verdict = validate_selection(&selection, catalog);
        Self {
            selection,
            catalog_freshness: freshness_token(catalog),
            verdict,
        }
    }

    /// True when the current catalog no longer matches the one this record
    /// was validated against (model-set or version change).
    pub fn is_stale(&self, current: &HostCatalog) -> bool {
        freshness_token(current) != self.catalog_freshness
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effort_lists_match_the_launch_adapter() {
        // Guard against drift from launch.rs's documented sets.
        assert_eq!(allowed_efforts(HarnessId::Pi)[0], "off");
        assert!(allowed_efforts(HarnessId::Opencode).is_empty());
        assert!(allowed_efforts(HarnessId::Claude).contains(&"high"));
    }

    #[test]
    fn field_shape_rejects_launch_refused_values() {
        assert!(field_shape_error("").is_some());
        assert!(field_shape_error(&"x".repeat(513)).is_some());
        assert!(field_shape_error("bad\nvalue").is_some());
        assert!(field_shape_error("--model").is_some());
        assert!(field_shape_error("dgx-spark/qwen3.8").is_none());
    }
}
