//! C01-A selection contract tests: verdicts and model-change invalidation
//! against in-memory catalogs — no processes, no user configuration.
//! Public-API contract tests against `drogon_harness::selection`.

use std::path::PathBuf;
use std::time::SystemTime;

use drogon_harness::{
    CatalogEntry, EnumerationStatus, HarnessAvailability, HarnessId, HarnessSelection, HostCatalog,
    ProbeProvenance, SelectionRecord, SelectionVerdict, allowed_efforts, validate_selection,
};

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

fn enumerated_catalog(harness: HarnessId, entries: Vec<CatalogEntry>) -> HostCatalog {
    HostCatalog {
        harness,
        availability: HarnessAvailability::Available,
        executable: Some(PathBuf::from("/fixture/bin").join(harness.executable())),
        provenance: Some(ProbeProvenance {
            executable: PathBuf::from("/fixture/bin").join(harness.executable()),
            argv: vec![],
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

fn empty_enumeration_catalog(harness: HarnessId) -> HostCatalog {
    HostCatalog {
        entries: Vec::new(),
        ..enumerated_catalog(harness, Vec::new())
    }
}

fn selection(
    harness: HarnessId,
    provider: Option<&str>,
    model: Option<&str>,
    effort: Option<&str>,
) -> HarnessSelection {
    HarnessSelection {
        harness,
        provider: provider.map(str::to_string),
        model: model.map(str::to_string),
        effort: effort.map(str::to_string),
    }
}

#[test]
fn enumerated_selection_carries_the_scope_of_its_enumeration() {
    let catalog = enumerated_catalog(
        HarnessId::Pi,
        vec![
            entry("kimi-coding", "kimi-for-coding", Some(true)),
            entry("zai", "glm-5.3-flash", Some(true)),
        ],
    );
    let verdict = validate_selection(
        &selection(
            HarnessId::Pi,
            Some("kimi-coding"),
            Some("kimi-for-coding"),
            None,
        ),
        &catalog,
    );
    let SelectionVerdict::Enumerated {
        provider,
        model,
        scope,
    } = verdict
    else {
        panic!("expected Enumerated, got {verdict:?}");
    };
    assert_eq!(provider.as_deref(), Some("kimi-coding"));
    assert_eq!(model, "kimi-for-coding");
    assert!(
        scope.contains("caller-enumerated"),
        "the verdict must surface what enumerated it: {scope}"
    );
}

#[test]
fn bare_model_id_with_a_single_match_is_enumerated_with_its_provider() {
    let catalog = enumerated_catalog(
        HarnessId::Pi,
        vec![
            entry("kimi-coding", "kimi-for-coding", Some(true)),
            entry("zai", "glm-5.3-flash", Some(true)),
        ],
    );
    let verdict = validate_selection(
        &selection(HarnessId::Pi, None, Some("glm-5.3-flash"), None),
        &catalog,
    );
    let SelectionVerdict::Enumerated { provider, .. } = verdict else {
        panic!("expected Enumerated, got {verdict:?}");
    };
    assert_eq!(provider.as_deref(), Some("zai"));
}

#[test]
fn ambiguous_bare_model_id_is_refused_not_silently_pinned() {
    let catalog = enumerated_catalog(
        HarnessId::Pi,
        vec![entry("a", "same-id", None), entry("b", "same-id", None)],
    );
    let verdict = validate_selection(
        &selection(HarnessId::Pi, None, Some("same-id"), None),
        &catalog,
    );
    assert!(matches!(verdict, SelectionVerdict::AmbiguousModel { .. }));
}

#[test]
fn unknown_provider_and_unknown_model_list_what_is_known() {
    let catalog = enumerated_catalog(HarnessId::Pi, vec![entry("zai", "glm-5.3-flash", None)]);
    let verdict = validate_selection(
        &selection(HarnessId::Pi, Some("nope"), Some("x"), None),
        &catalog,
    );
    let SelectionVerdict::UnknownProvider {
        provider,
        known_providers,
    } = verdict
    else {
        panic!("expected UnknownProvider, got {verdict:?}");
    };
    assert_eq!(provider, "nope");
    assert_eq!(known_providers, ["zai"]);

    let verdict = validate_selection(
        &selection(HarnessId::Pi, Some("zai"), Some("nope"), None),
        &catalog,
    );
    let SelectionVerdict::UnknownModel {
        provider,
        model,
        known_models,
    } = verdict
    else {
        panic!("expected UnknownModel, got {verdict:?}");
    };
    assert_eq!(provider.as_deref(), Some("zai"));
    assert_eq!(model, "nope");
    assert_eq!(known_models, ["glm-5.3-flash"]);
}

#[test]
fn provider_only_selection_is_a_provider_default() {
    let catalog = enumerated_catalog(HarnessId::Pi, vec![entry("zai", "glm-5.3-flash", None)]);
    let verdict = validate_selection(&selection(HarnessId::Pi, Some("zai"), None, None), &catalog);
    assert!(matches!(
        verdict,
        SelectionVerdict::ProviderDefault { provider, .. } if provider == "zai"
    ));
}

#[test]
fn thinking_override_on_a_non_thinking_model_is_a_capability_mismatch() {
    let catalog = enumerated_catalog(
        HarnessId::Pi,
        vec![entry(
            "dgx-spark",
            "qwen3.8-flash-next-nvidia-nvfp4",
            Some(false),
        )],
    );
    let verdict = validate_selection(
        &selection(
            HarnessId::Pi,
            Some("dgx-spark"),
            Some("qwen3.8-flash-next-nvidia-nvfp4"),
            Some("high"),
        ),
        &catalog,
    );
    let SelectionVerdict::CapabilityUnsupported { capability, model } = verdict else {
        panic!("expected CapabilityUnsupported, got {verdict:?}");
    };
    assert_eq!(capability, "thinking");
    assert_eq!(model, "qwen3.8-flash-next-nvidia-nvfp4");
}

#[test]
fn auth_empty_catalog_degrades_selections_to_manual_unverified() {
    // Exactly what the real credential-free Pi probe reports: enumerated,
    // zero entries. The selection must NOT be confirmed.
    let catalog = empty_enumeration_catalog(HarnessId::Pi);
    let verdict = validate_selection(
        &selection(
            HarnessId::Pi,
            Some("kimi-coding"),
            Some("kimi-for-coding"),
            None,
        ),
        &catalog,
    );
    let SelectionVerdict::ManualUnverified { reason, known } = verdict else {
        panic!("expected ManualUnverified, got {verdict:?}");
    };
    assert!(reason.contains("unverified"), "{reason}");
    assert!(known.is_empty());
}

#[test]
fn no_surface_catalog_validates_shape_but_stays_unverified() {
    let catalog = no_surface_catalog(HarnessId::Claude);
    let verdict = validate_selection(
        &selection(HarnessId::Claude, None, Some("sonnet"), Some("high")),
        &catalog,
    );
    let SelectionVerdict::ManualUnverified { reason, .. } = verdict else {
        panic!("expected ManualUnverified, got {verdict:?}");
    };
    assert!(reason.contains("no model enumeration surface"), "{reason}");

    // Shape checks still apply: a flag-shaped model is malformed.
    let verdict = validate_selection(
        &selection(HarnessId::Claude, None, Some("--effort"), None),
        &catalog,
    );
    assert!(matches!(verdict, SelectionVerdict::Malformed { .. }));
}

#[test]
fn malformed_and_unsupported_effort_never_reach_the_harness() {
    let catalog = enumerated_catalog(HarnessId::Pi, vec![entry("zai", "glm-5.3-flash", None)]);
    let verdict = validate_selection(
        &selection(
            HarnessId::Pi,
            Some("zai"),
            Some("glm-5.3-flash"),
            Some("turbo"),
        ),
        &catalog,
    );
    let SelectionVerdict::UnsupportedEffort { effort, allowed } = verdict else {
        panic!("expected UnsupportedEffort, got {verdict:?}");
    };
    assert_eq!(effort, "turbo");
    assert!(allowed.contains(&"high".to_string()));

    let verdict = validate_selection(
        &selection(HarnessId::Pi, None, Some("x\ny"), None),
        &catalog,
    );
    assert!(matches!(verdict, SelectionVerdict::Malformed { .. }));

    // Provider on a non-Pi harness is refused, mirroring plan_launch.
    let verdict = validate_selection(
        &selection(HarnessId::Claude, Some("dgx-spark"), Some("sonnet"), None),
        &no_surface_catalog(HarnessId::Claude),
    );
    assert!(matches!(
        verdict,
        SelectionVerdict::Malformed {
            field: "provider",
            ..
        }
    ));
}

#[test]
fn opencode_advertises_no_effort_levels() {
    assert!(allowed_efforts(HarnessId::Opencode).is_empty());
    let catalog = enumerated_catalog(
        HarnessId::Opencode,
        vec![entry("opencode", "claude-sonnet-5", None)],
    );
    let verdict = validate_selection(
        &selection(
            HarnessId::Opencode,
            None,
            Some("claude-sonnet-5"),
            Some("high"),
        ),
        &catalog,
    );
    assert!(matches!(
        verdict,
        SelectionVerdict::UnsupportedEffort { .. }
    ));
}

#[test]
fn harness_mismatch_and_unavailable_catalog_are_honest() {
    let catalog = enumerated_catalog(HarnessId::Pi, vec![entry("zai", "glm-5.3-flash", None)]);
    let verdict = validate_selection(
        &selection(HarnessId::Claude, None, Some("sonnet"), None),
        &catalog,
    );
    assert!(matches!(verdict, SelectionVerdict::Malformed { .. }));

    let timed_out = HostCatalog {
        status: EnumerationStatus::TimedOut,
        note: Some("probe exceeded its wall-clock budget".to_string()),
        ..catalog.clone()
    };
    let verdict = validate_selection(
        &selection(HarnessId::Pi, Some("zai"), Some("glm-5.3-flash"), None),
        &timed_out,
    );
    let SelectionVerdict::CatalogUnavailable { reason } = verdict else {
        panic!("expected CatalogUnavailable, got {verdict:?}");
    };
    assert!(reason.contains("wall-clock"), "{reason}");
}

#[test]
fn selection_record_goes_stale_on_model_set_or_version_change() {
    let catalog_v1 = enumerated_catalog(HarnessId::Pi, vec![entry("zai", "glm-5.3-flash", None)]);
    let record = SelectionRecord::new(
        selection(HarnessId::Pi, Some("zai"), Some("glm-5.3-flash"), None),
        &catalog_v1,
    );
    assert!(!record.is_stale(&catalog_v1));
    assert!(matches!(
        record.verdict,
        SelectionVerdict::Enumerated { .. }
    ));

    // Model-set change (a new model appears in the catalog).
    let catalog_v2 = enumerated_catalog(
        HarnessId::Pi,
        vec![
            entry("zai", "glm-5.3-flash", None),
            entry("zai", "glm-5.4", None),
        ],
    );
    assert!(record.is_stale(&catalog_v2), "model-set change invalidates");

    // Version change with the same model set.
    let catalog_v3 = HostCatalog {
        provenance: Some(ProbeProvenance {
            version: Some("0.86.0".to_string()),
            ..catalog_v1.provenance.clone().expect("provenance")
        }),
        ..catalog_v1.clone()
    };
    assert!(record.is_stale(&catalog_v3), "version change invalidates");
}
