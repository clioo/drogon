//! C01-A Mentu translation contract tests: source-backed rules pinned
//! against the locked runtime's recorded `adapters --json` evidence and
//! the live check/doctor findings from C01-A discovery. No real recipe
//! execution, no inference, no credentials. Public-API contract tests
//! against `drogon_harness::mentu_contract`.

use std::path::PathBuf;
use std::time::SystemTime;

use drogon_harness::{
    AdapterEvidence, CONTRACT_DERIVED_FROM_REVISION, CONTRACT_DERIVED_FROM_VERSION, CatalogEntry,
    EnumerationStatus, HarnessAvailability, HarnessId, HarnessSelection, HostCatalog,
    MentuRuntimeIdentity, MentuTranslation, PiProviderBinding, ProbeProvenance,
    parse_adapters_json, translate_selection,
};

/// The real `adapters --json` output of the locked mentu-recipes 0.5.0
/// binary (`~/Library/Application Support/Drogon/mentu/runtime/bin`,
/// sha256 == MENTU_LOCK_SHA256), recorded during C01-A discovery. It is
/// evidence, kept verbatim and complete for all nine adapters.
const LOCKED_RUNTIME_ADAPTERS_JSON: &str = include_str!("fixtures/locked-runtime-adapters.json");

fn locked_identity() -> MentuRuntimeIdentity {
    MentuRuntimeIdentity {
        version: CONTRACT_DERIVED_FROM_VERSION.to_string(),
        revision: CONTRACT_DERIVED_FROM_REVISION.to_string(),
    }
}

fn adapters() -> Vec<AdapterEvidence> {
    parse_adapters_json(LOCKED_RUNTIME_ADAPTERS_JSON).expect("locked adapters evidence parses")
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
fn locked_adapters_evidence_records_all_nine_adapters() {
    let adapters = adapters();
    let names: Vec<&str> = adapters
        .iter()
        .map(|adapter| adapter.name.as_str())
        .collect();
    assert_eq!(
        names,
        [
            "shell",
            "openai",
            "openai-chat",
            "deepseek",
            "ollama",
            "claude",
            "codex",
            "pi"
        ]
    );
    let claude = adapters
        .iter()
        .find(|adapter| adapter.name == "claude")
        .expect("claude adapter");
    assert_eq!(claude.execution_kind, "agent-cli");
    assert!(claude.supports_thinking, "claude is the thinking adapter");
    let pi = adapters
        .iter()
        .find(|adapter| adapter.name == "pi")
        .expect("pi adapter");
    assert!(!pi.supports_thinking, "doctor flags thinking on pi");
    assert!(pi.requires_credential);
}

#[test]
fn claude_selection_translates_with_reasoning_from_effort() {
    let catalog = no_surface_catalog(HarnessId::Claude);
    let translation = translate_selection(
        &locked_identity(),
        &adapters(),
        &selection(HarnessId::Claude, None, Some("sonnet"), Some("high")),
        &catalog,
        None,
    );
    let MentuTranslation::Translated(plan) = translation else {
        panic!("expected Translated, got {translation:?}");
    };
    assert_eq!(plan.backend, "claude");
    assert_eq!(plan.model.as_deref(), Some("sonnet"));
    assert_eq!(plan.reasoning.as_deref(), Some("high"));
    assert!(plan.providers_entry.is_none());
    assert!(
        plan.notes
            .iter()
            .any(|note| note.contains("manual-unverified")),
        "claude ids carry the unverified note: {:?}",
        plan.notes
    );
}

#[test]
fn codex_effort_is_normalized_max_to_xhigh() {
    let catalog = no_surface_catalog(HarnessId::Codex);
    let translated = translate_selection(
        &locked_identity(),
        &adapters(),
        &selection(HarnessId::Codex, None, Some("gpt-5.5"), Some("max")),
        &catalog,
        None,
    );
    let MentuTranslation::Translated(plan) = translated else {
        panic!("expected Translated, got {translated:?}");
    };
    assert_eq!(plan.backend, "codex");
    assert_eq!(plan.reasoning.as_deref(), Some("xhigh"), "max -> xhigh");

    let translated = translate_selection(
        &locked_identity(),
        &adapters(),
        &selection(HarnessId::Codex, None, Some("gpt-5.5"), Some("high")),
        &catalog,
        None,
    );
    let MentuTranslation::Translated(plan) = translated else {
        panic!("expected Translated, got {translated:?}");
    };
    assert_eq!(plan.reasoning.as_deref(), Some("high"));
}

#[test]
fn bare_pi_backend_is_the_documented_false_positive_and_stays_blocked() {
    // C01-A live evidence: a recipe with backend "pi" passes BOTH
    // `mentu-recipes check` AND `doctor --strict` (score 100) on the
    // locked 0.5.0 binary, yet PiCLIAdapter.execute unconditionally
    // throws without a provider config. Translation must refuse it.
    let catalog = enumerated_catalog(
        HarnessId::Pi,
        vec![entry("kimi-coding", "kimi-for-coding", Some(true))],
    );
    let translation = translate_selection(
        &locked_identity(),
        &adapters(),
        &selection(
            HarnessId::Pi,
            Some("kimi-coding"),
            Some("kimi-for-coding"),
            None,
        ),
        &catalog,
        None,
    );
    let MentuTranslation::Blocked { reason, evidence } = translation else {
        panic!("expected Blocked, got {translation:?}");
    };
    assert!(
        reason.contains("Pi requires an explicit provider"),
        "{reason}"
    );
    assert!(evidence.contains("PiCLIAdapter"), "{evidence}");
}

#[test]
fn pi_translation_requires_an_executable_shaped_binding() {
    let catalog = enumerated_catalog(
        HarnessId::Pi,
        vec![entry("kimi-coding", "kimi-for-coding", Some(true))],
    );
    let valid = PiProviderBinding {
        provider_name: "kimi-coding".to_string(),
        base_url: "https://kimi.example.com/v1".to_string(),
        model: "kimi-for-coding".to_string(),
        api_key_env: Some("KIMI_FIXTURE_KEY".to_string()),
        api_key_vault: None,
    };
    let translation = translate_selection(
        &locked_identity(),
        &adapters(),
        &selection(
            HarnessId::Pi,
            Some("kimi-coding"),
            Some("kimi-for-coding"),
            None,
        ),
        &catalog,
        Some(&valid),
    );
    let MentuTranslation::Translated(plan) = translation else {
        panic!("expected Translated, got {translation:?}");
    };
    // Never the bare "pi" backend: the step names the provider-config
    // adapter, and the providers map carries the executable-shaped entry.
    assert_eq!(plan.backend, "kimi-coding");
    let (name, config) = plan.providers_entry.expect("providers entry");
    assert_eq!(name, "kimi-coding");
    assert_eq!(config.api, "cli");
    assert_eq!(config.agent.as_deref(), Some("pi"));
    assert_eq!(config.base_url, "https://kimi.example.com/v1");
    assert_eq!(config.model.as_deref(), Some("kimi-for-coding"));
    assert_eq!(config.api_key_env.as_deref(), Some("KIMI_FIXTURE_KEY"));
    // Recipe-schema shape per RecipeModels.swift CodingKeys (snake_case).
    let json = serde_json::to_value(&config).unwrap();
    assert_eq!(json["api"], "cli");
    assert_eq!(json["agent"], "pi");
    assert_eq!(json["base_url"], "https://kimi.example.com/v1");
    assert_eq!(json["model"], "kimi-for-coding");
    assert_eq!(json["api_key_env"], "KIMI_FIXTURE_KEY");

    // A binding shaped wrong for the adapter (embedded credentials in the
    // base_url) is blocked, not laundered into a recipe.
    let invalid = PiProviderBinding {
        base_url: "https://user:pw@192.0.2.1".to_string(),
        ..valid.clone()
    };
    let translation = translate_selection(
        &locked_identity(),
        &adapters(),
        &selection(
            HarnessId::Pi,
            Some("kimi-coding"),
            Some("kimi-for-coding"),
            None,
        ),
        &catalog,
        Some(&invalid),
    );
    let MentuTranslation::Blocked { reason, .. } = translation else {
        panic!("expected Blocked, got {translation:?}");
    };
    assert!(reason.contains("embedded credentials"), "{reason}");

    // A thinking/effort override on pi is rejected by the adapter source.
    let translation = translate_selection(
        &locked_identity(),
        &adapters(),
        &selection(
            HarnessId::Pi,
            Some("kimi-coding"),
            Some("kimi-for-coding"),
            Some("high"),
        ),
        &catalog,
        Some(&valid),
    );
    let MentuTranslation::Blocked { reason, .. } = translation else {
        panic!("expected Blocked, got {translation:?}");
    };
    assert!(reason.contains("reasoning/thinking"), "{reason}");
}

#[test]
fn opencode_and_antigravity_have_no_adapter_and_stay_blocked() {
    let catalog = no_surface_catalog(HarnessId::Opencode);
    let translation = translate_selection(
        &locked_identity(),
        &adapters(),
        &selection(
            HarnessId::Opencode,
            None,
            Some("opencode/claude-sonnet-5"),
            None,
        ),
        &catalog,
        None,
    );
    let MentuTranslation::Blocked { reason, evidence } = translation else {
        panic!("expected Blocked, got {translation:?}");
    };
    assert!(reason.contains("no opencode adapter"), "{reason}");
    assert!(reason.contains("unknown_backend"), "{reason}");
    assert!(evidence.contains("Adapters.swift"), "{evidence}");

    let catalog = no_surface_catalog(HarnessId::Antigravity);
    let translation = translate_selection(
        &locked_identity(),
        &adapters(),
        &selection(HarnessId::Antigravity, None, None, None),
        &catalog,
        None,
    );
    let MentuTranslation::Blocked { reason, .. } = translation else {
        panic!("expected Blocked, got {translation:?}");
    };
    assert!(reason.contains("no antigravity adapter"), "{reason}");
}

#[test]
fn identity_mismatch_blocks_translation_silently_refused() {
    let foreign = MentuRuntimeIdentity {
        version: "0.3.0".to_string(),
        revision: "deadbeef".to_string(),
    };
    let translation = translate_selection(
        &foreign,
        &adapters(),
        &selection(HarnessId::Claude, None, Some("sonnet"), None),
        &no_surface_catalog(HarnessId::Claude),
        None,
    );
    let MentuTranslation::Blocked { reason, .. } = translation else {
        panic!("expected Blocked, got {translation:?}");
    };
    assert!(reason.contains(CONTRACT_DERIVED_FROM_VERSION), "{reason}");
}

#[test]
fn missing_live_adapter_evidence_blocks_translation() {
    let without_claude: Vec<AdapterEvidence> = adapters()
        .into_iter()
        .filter(|adapter| adapter.name != "claude")
        .collect();
    let translation = translate_selection(
        &locked_identity(),
        &without_claude,
        &selection(HarnessId::Claude, None, Some("sonnet"), None),
        &no_surface_catalog(HarnessId::Claude),
        None,
    );
    let MentuTranslation::Blocked { reason, .. } = translation else {
        panic!("expected Blocked, got {translation:?}");
    };
    assert!(reason.contains("adapters --json"), "{reason}");
}

#[test]
fn catalog_refuted_selections_are_not_translated() {
    // Unknown model in the host catalog -> translating would embed a
    // fictitious combination in the recipe.
    let catalog = enumerated_catalog(HarnessId::Pi, vec![entry("zai", "glm-5.3-flash", None)]);
    let valid = PiProviderBinding {
        provider_name: "kimi-coding".to_string(),
        base_url: "https://kimi.example.com/v1".to_string(),
        model: "kimi-for-coding".to_string(),
        api_key_env: Some("KIMI_FIXTURE_KEY".to_string()),
        api_key_vault: None,
    };
    let translation = translate_selection(
        &locked_identity(),
        &adapters(),
        &selection(
            HarnessId::Pi,
            Some("kimi-coding"),
            Some("kimi-for-coding"),
            None,
        ),
        &catalog,
        Some(&valid),
    );
    let MentuTranslation::Blocked { reason, .. } = translation else {
        panic!("expected Blocked, got {translation:?}");
    };
    assert!(reason.contains("refutes"), "{reason}");
}

#[test]
fn parse_adapters_json_rejects_garbage() {
    assert!(parse_adapters_json("not json").is_err());
    assert!(parse_adapters_json("{}").is_err());
    assert!(parse_adapters_json("[42]").is_err());
}
