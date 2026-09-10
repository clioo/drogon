//! C01 consumer: selection validation on the existing `harness.start`
//! launch path.
//!
//! The C01-A slice (`drogon-harness`: host catalogs, [`validate_selection`],
//! the Mentu translation contract) shipped with no daemon consumer
//! (C01-QA-1): `harness_list` discovers binaries only and
//! `do_harness_start` plans straight from the request. This module wires
//! the real selection vocabulary into that existing admission without
//! changing what the launch authority owns:
//!
//! - `plan_launch` / `plan_with_settings` remain the sole argv authority.
//!   They re-enforce every shape/effort/provider rule before building
//!   argv; this gate only refuses earlier, with C01 verdict vocabulary.
//! - Host fencing (binary missing, unsupported launcher, disabled agent)
//!   stays with the existing discovery/settings/plan path. This gate
//!   performs no discovery and reads no settings.
//! - Explicit model/provider/effort are validated verbatim: an ambiguous
//!   or unknown id is refused, never silently pinned or substituted, and
//!   the effective selection on this path IS the explicit request (no
//!   credential-owned binding exists here, unlike the Mentu Pi path that
//!   C03 owns — this module never calls `translate_selection`).
//! - Catalog handling is honest about what the daemon owns today:
//!   `None` (no Engine-owned catalog yet) admits shape/capability-valid
//!   selections as [`SelectionVerdict::ManualUnverified`] instead of
//!   inventing enumeration. `Some` is the seam the held ownership change
//!   plugs into: a real probe-owned [`HostCatalog`] validated with the
//!   real [`validate_selection`].
//!
//! Held seam (coordinator-owned `crates/drogon-core/src/lib.rs`): adopting
//! a probed catalog needs an Engine-owned store (e.g. a catalog map) plus
//! a cleanup arm that boundedly reaps `CatalogProbe::pending` children and
//! only deletes `retained_roots` after verified containment — probe
//! custody must live in the daemon, never be dropped. Once that seam
//! lands, `do_harness_start` passes `Some(catalog)` here; no gate change
//! is needed. No process-global store is kept here to evade that
//! ownership.

use drogon_harness::{
    HarnessId, HarnessLaunchRequest, HarnessSelection, HostCatalog, SelectionVerdict,
    allowed_efforts, validate_selection,
};
use drogon_protocol::RpcError;

use crate::error;

/// Validate the explicit launch selection with the real C01 vocabulary
/// before the existing planning runs. Returns the admission verdict so a
/// future caller can surface it; today `do_harness_start` only needs the
/// refusal side.
///
/// `catalog` is `None` until the Engine owns probe catalogs (see module
/// docs). `Some` must name the same harness as the request.
pub(crate) fn check_launch_selection(
    request: &HarnessLaunchRequest,
    catalog: Option<&HostCatalog>,
) -> Result<SelectionVerdict, RpcError> {
    let selection = HarnessSelection {
        harness: request.harness_id,
        provider: request.provider.clone(),
        model: request.model.clone(),
        effort: request.effort.clone(),
    };
    match catalog {
        Some(catalog) => {
            if catalog.harness != request.harness_id {
                return Err(error::invalid_argument(
                    "Invalid harness: selection and catalog name different harnesses",
                ));
            }
            admit_verdict(validate_selection(&selection, catalog))
        }
        None => {
            // No catalog owned yet: the catalog-independent prefix, in the
            // same order `validate_selection` enforces it (shape, effort,
            // provider scope) before touching entries. Anything reaching
            // past here rides manual-unverified — never an invented
            // confirmation.
            if selection.provider.is_some() && selection.harness != HarnessId::Pi {
                return Err(error::invalid_argument(
                    "Provider selection is available only for Pi",
                ));
            }
            for (field, value) in [
                ("provider", &selection.provider),
                ("model", &selection.model),
                ("effort", &selection.effort),
            ] {
                if let Some(value) = value
                    && let Some(reason) = field_shape_error(value)
                {
                    return Err(error::invalid_argument(format!(
                        "Invalid {field}: {reason}"
                    )));
                }
            }
            if let Some(effort) = &selection.effort
                && !allowed_efforts(selection.harness).contains(&effort.as_str())
            {
                return Err(error::invalid_argument(
                    "Unsupported effort for this harness",
                ));
            }
            Ok(SelectionVerdict::ManualUnverified {
                reason: "no host catalog is owned by the daemon yet; \
                         the id is carried unverified"
                    .to_string(),
                known: Vec::new(),
            })
        }
    }
}

/// Map a real catalog verdict to admission: the pass-through verdicts
/// proceed to the existing planning; everything else refuses without
/// substituting a different provider, model, or effort.
fn admit_verdict(verdict: SelectionVerdict) -> Result<SelectionVerdict, RpcError> {
    match verdict {
        SelectionVerdict::Enumerated { .. }
        | SelectionVerdict::ProviderDefault { .. }
        | SelectionVerdict::ManualUnverified { .. } => Ok(verdict),
        SelectionVerdict::NotInstalled => Err(error::not_found(
            "Harness is not installed on this execution host",
        )),
        SelectionVerdict::UnknownProvider {
            provider,
            known_providers,
        } => Err(error::invalid_argument(format!(
            "Unknown provider {provider:?}; known providers: {}",
            display_list(&known_providers)
        ))),
        SelectionVerdict::UnknownModel {
            provider,
            model,
            known_models,
        } => Err(error::invalid_argument(match provider {
            Some(provider) => format!(
                "Unknown model {model:?} for provider {provider:?}; known models: {}",
                display_list(&known_models)
            ),
            None => format!(
                "Unknown model {model:?}; known models: {}",
                display_list(&known_models)
            ),
        })),
        SelectionVerdict::AmbiguousModel { model, matches } => {
            Err(error::invalid_argument(format!(
                "Model {model:?} matches more than one provider ({}); \
                 pick one with an explicit provider instead",
                display_list(&matches)
            )))
        }
        SelectionVerdict::CapabilityUnsupported { capability, model } => {
            Err(error::invalid_argument(format!(
                "Model {model:?} does not support the {capability:?} capability \
                 this selection requires"
            )))
        }
        SelectionVerdict::UnsupportedEffort { effort, allowed } => {
            Err(error::invalid_argument(format!(
                "Unsupported effort {effort:?} for this harness; allowed: {}",
                display_list(&allowed)
            )))
        }
        SelectionVerdict::Malformed { field, reason } => Err(error::invalid_argument(format!(
            "Invalid {field}: {reason}"
        ))),
        // A failed probe makes any verdict dishonest: refuse and say so
        // rather than launching on fiction. `io_error` (not a new wire
        // code) because the params may be fine — the host enumeration is
        // what failed.
        SelectionVerdict::CatalogUnavailable { reason } => Err(error::io_error(format!(
            "Host model catalog is unavailable ({reason}); try again before launching"
        ))),
    }
}

/// Bounded display for known-entry lists in refusal messages: enough for a
/// "did you mean" hint without pasting an unbounded enumeration.
fn display_list(entries: &[String]) -> String {
    const LIMIT: usize = 8;
    if entries.is_empty() {
        return "(none)".to_string();
    }
    let mut shown: Vec<String> = entries.iter().take(LIMIT).cloned().collect();
    if entries.len() > LIMIT {
        shown.push(format!("and {} more", entries.len() - LIMIT));
    }
    shown.join(", ")
}

/// `plan_launch`-compatible value shape checks. Mirrors the private
/// `field_shape_error` in `drogon-harness/src/selection.rs` (same strings)
/// so the daemon gate refuses exactly what selection validation would;
/// `plan_launch` remains the final argv authority and re-checks.
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

#[cfg(test)]
mod tests {
    use super::*;
    use drogon_harness::{CatalogEntry, EnumerationStatus, HarnessAvailability, ProbeProvenance};
    use std::path::PathBuf;
    use std::time::SystemTime;

    fn launch_request(
        harness: HarnessId,
        provider: Option<&str>,
        model: Option<&str>,
        effort: Option<&str>,
    ) -> HarnessLaunchRequest {
        serde_json::from_value(serde_json::json!({
            "harnessId": serde_json::to_value(harness).unwrap(),
            "provider": provider,
            "model": model,
            "effort": effort,
        }))
        .unwrap()
    }

    fn entry(provider: &str, id: &str, thinking: Option<bool>) -> CatalogEntry {
        CatalogEntry {
            provider: Some(provider.to_string()),
            id: id.to_string(),
            context: None,
            max_output: None,
            thinking,
            images: None,
        }
    }

    fn fixture_catalog(harness: HarnessId, entries: Vec<CatalogEntry>) -> HostCatalog {
        HostCatalog {
            harness,
            availability: HarnessAvailability::Available,
            executable: Some(PathBuf::from("/fixture/bin").join(harness.executable())),
            provenance: Some(ProbeProvenance {
                executable: PathBuf::from("/fixture/bin").join(harness.executable()),
                argv: Vec::new(),
                version: Some("0.0.0-fixture".to_string()),
                probed_at: SystemTime::now(),
                config_scope: "caller-enumerated:fixture".to_string(),
            }),
            entries,
            status: EnumerationStatus::Enumerated,
            note: None,
        }
    }

    fn no_surface_catalog(harness: HarnessId) -> HostCatalog {
        HostCatalog {
            harness,
            availability: HarnessAvailability::Available,
            executable: Some(PathBuf::from("/fixture/bin").join(harness.executable())),
            provenance: None,
            entries: Vec::new(),
            status: EnumerationStatus::UnsupportedSurface,
            note: Some("fixture: no enumeration surface".to_string()),
        }
    }

    #[test]
    fn unavailable_catalog_admits_valid_shapes_as_manual_unverified() {
        // The honest no-catalog posture: a syntactically valid selection
        // (even an id no host ever enumerated) rides unverified. It must
        // never come back as Enumerated — that would invent confirmation.
        let verdict = check_launch_selection(
            &launch_request(
                HarnessId::Pi,
                Some("dgx-spark"),
                Some("qwen3.8-flash-next"),
                Some("high"),
            ),
            None,
        )
        .expect("valid shape must admit without a catalog");
        assert!(
            matches!(verdict, SelectionVerdict::ManualUnverified { .. }),
            "expected ManualUnverified, got {verdict:?}"
        );
        let blank =
            check_launch_selection(&launch_request(HarnessId::Claude, None, None, None), None)
                .expect("harness defaults must admit without a catalog");
        assert!(
            matches!(blank, SelectionVerdict::ManualUnverified { .. }),
            "expected ManualUnverified, got {blank:?}"
        );
    }

    #[test]
    fn unavailable_catalog_still_refuses_provider_outside_pi() {
        let err = check_launch_selection(
            &launch_request(HarnessId::Claude, Some("anthropic"), None, None),
            None,
        )
        .unwrap_err();
        assert_eq!(err.code, "invalid_argument");
    }

    #[test]
    fn unavailable_catalog_refuses_unsupported_effort_per_harness() {
        // Mirrors `allowed_efforts` (the same table selection validation
        // uses); `plan_launch` re-refuses as the argv authority.
        for (harness, effort) in [
            (HarnessId::Claude, "turbo"),
            (HarnessId::Claude, "off"),
            (HarnessId::Pi, "ultra"),
            (HarnessId::Opencode, "high"),
            (HarnessId::Antigravity, "max"),
            (HarnessId::Codex, "off"),
        ] {
            let err =
                check_launch_selection(&launch_request(harness, None, None, Some(effort)), None)
                    .unwrap_err();
            assert_eq!(err.code, "invalid_argument", "{harness:?}/{effort}");
            assert!(
                err.message.contains("Unsupported effort"),
                "{harness:?}/{effort}: {}",
                err.message
            );
        }
        for (harness, effort) in [
            (HarnessId::Claude, "max"),
            (HarnessId::Pi, "off"),
            (HarnessId::Antigravity, "low"),
            (HarnessId::Codex, "ultra"),
        ] {
            check_launch_selection(&launch_request(harness, None, None, Some(effort)), None)
                .unwrap_or_else(|err| panic!("{harness:?}/{effort} must admit: {err:?}"));
        }
    }

    #[test]
    fn unavailable_catalog_refuses_malformed_fields() {
        for (model, effort) in [
            (Some("-x"), None),
            (Some("bad\nvalue"), None),
            (Some(""), None),
            (None, Some("--xhigh")),
        ] {
            let err =
                check_launch_selection(&launch_request(HarnessId::Pi, None, model, effort), None)
                    .unwrap_err();
            assert_eq!(err.code, "invalid_argument");
        }
        let long = "x".repeat(513);
        let err = check_launch_selection(
            &launch_request(HarnessId::Pi, None, Some(&long), None),
            None,
        )
        .unwrap_err();
        assert_eq!(err.code, "invalid_argument");
    }

    #[test]
    fn catalog_mismatch_is_a_caller_bug() {
        let catalog = fixture_catalog(HarnessId::Pi, Vec::new());
        let err = check_launch_selection(
            &launch_request(HarnessId::Claude, None, None, None),
            Some(&catalog),
        )
        .unwrap_err();
        assert_eq!(err.code, "invalid_argument");
    }

    #[test]
    fn catalog_enumerated_selection_admits_with_scope() {
        let catalog = fixture_catalog(
            HarnessId::Pi,
            vec![entry("kimi-coding", "kimi-for-coding", Some(true))],
        );
        let verdict = check_launch_selection(
            &launch_request(
                HarnessId::Pi,
                Some("kimi-coding"),
                Some("kimi-for-coding"),
                None,
            ),
            Some(&catalog),
        )
        .expect("enumerated selection must admit");
        assert!(
            matches!(verdict, SelectionVerdict::Enumerated { .. }),
            "got {verdict:?}"
        );
    }

    #[test]
    fn catalog_refutations_refuse_without_substitution() {
        let catalog = fixture_catalog(
            HarnessId::Pi,
            vec![
                entry("kimi-coding", "kimi-for-coding", Some(true)),
                entry("zai", "shared-name", Some(true)),
                entry("kimi-coding", "shared-name", Some(true)),
                entry("zai", "no-think", Some(false)),
            ],
        );
        // Unknown model: refused, not carried as unverified.
        let err = check_launch_selection(
            &launch_request(
                HarnessId::Pi,
                Some("kimi-coding"),
                Some("no-such-model"),
                None,
            ),
            Some(&catalog),
        )
        .unwrap_err();
        assert_eq!(err.code, "invalid_argument");
        // Unknown provider: refused, never defaulted to a known one.
        let err = check_launch_selection(
            &launch_request(
                HarnessId::Pi,
                Some("no-such-provider"),
                Some("kimi-for-coding"),
                None,
            ),
            Some(&catalog),
        )
        .unwrap_err();
        assert_eq!(err.code, "invalid_argument");
        // Ambiguous bare id: refused, never pinned to one provider.
        let err = check_launch_selection(
            &launch_request(HarnessId::Pi, None, Some("shared-name"), None),
            Some(&catalog),
        )
        .unwrap_err();
        assert_eq!(err.code, "invalid_argument");
        assert!(err.message.contains("explicit provider"), "{}", err.message);
        // Thinking effort on a thinking:no model: refused.
        let err = check_launch_selection(
            &launch_request(HarnessId::Pi, Some("zai"), Some("no-think"), Some("high")),
            Some(&catalog),
        )
        .unwrap_err();
        assert_eq!(err.code, "invalid_argument");
        // ...while effort off on the same model admits (no thinking needed).
        let verdict = check_launch_selection(
            &launch_request(HarnessId::Pi, Some("zai"), Some("no-think"), Some("off")),
            Some(&catalog),
        )
        .expect("effort off needs no thinking capability");
        assert!(matches!(verdict, SelectionVerdict::Enumerated { .. }));
    }

    #[test]
    fn catalog_without_enumeration_admits_manual_unverified() {
        // No-surface harnesses and auth-empty enumerations carry ids
        // unverified — the coordinator's manual-unverified path.
        for catalog in [
            no_surface_catalog(HarnessId::Claude),
            fixture_catalog(HarnessId::Pi, Vec::new()),
        ] {
            let verdict = check_launch_selection(
                &launch_request(catalog.harness, None, Some("any-shape-valid-id"), None),
                Some(&catalog),
            )
            .expect("unverifiable ids must admit, not refuse");
            assert!(
                matches!(verdict, SelectionVerdict::ManualUnverified { .. }),
                "got {verdict:?}"
            );
        }
    }

    #[test]
    fn failed_or_missing_catalog_refuses_honestly() {
        let mut catalog = fixture_catalog(HarnessId::Pi, Vec::new());
        catalog.status = EnumerationStatus::ProbeFailed;
        catalog.note = Some("exit 1: nope".to_string());
        let err = check_launch_selection(
            &launch_request(HarnessId::Pi, None, Some("whatever"), None),
            Some(&catalog),
        )
        .unwrap_err();
        assert_eq!(
            err.code, "io_error",
            "a failed probe is host state, not bad params"
        );
        catalog.status = EnumerationStatus::NotInstalled;
        catalog.availability = HarnessAvailability::Missing;
        let err = check_launch_selection(
            &launch_request(HarnessId::Pi, None, None, None),
            Some(&catalog),
        )
        .unwrap_err();
        assert_eq!(err.code, "not_found");
    }
}
