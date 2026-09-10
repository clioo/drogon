//! Wire contract for `harness.models`: the per-harness, host-probed model
//! catalog RPC that closes the held seam documented in
//! `crates/drogon-core/src/harness/selection_gate.rs`.
//!
//! Capability gating reuses the already-advertised `harness.catalog.v1`
//! (see `harness-capability.ts`): the capability was advertised before any
//! per-model enumeration existed, and this method is the catalog surface it
//! promised. The wire types here are protocol-owned (this crate cannot
//! depend on `drogon-harness`), so `drogon-core` converts its probed
//! [`crate`] catalogs field by field — the conversion is exhaustive over
//! both enums, so a status the daemon learns to produce cannot silently
//! bypass the renderer's vocabulary.
//!
//! Honesty contract (C01): a response carries what the probe actually saw
//! — installed/configured/discovered/unavailable/unknown distinctions via
//! `availability` + `status`, source (`provenance.executable`/`argv`/
//! `configScope`), version, and freshness (`probedAtEpochMs`). There is no
//! inference and no substitution: an empty, failed, or unsupported-surface
//! catalog is reported as exactly that, never dressed up as entries.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::RpcError;

/// The RPC method name for the per-harness model catalog.
pub const HARNESS_MODELS_METHOD: &str = "harness.models";

/// Params for [`HARNESS_MODELS_METHOD`]: `{"harnessId": "pi"}`. The id is
/// the shared session contract's `HarnessId` wire spelling (lowercase,
/// `agy` accepted as an antigravity alias by the daemon's parser).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HarnessModelsParams {
    pub harness_id: String,
}

impl HarnessModelsParams {
    /// Validates the raw params object against this contract: a non-empty,
    /// control-free, bounded string id. Anything else is a caller bug, not
    /// a host state, and must refuse as `invalid_argument`.
    pub fn from_params(params: &Value) -> Result<Self, RpcError> {
        let parsed: Self = serde_json::from_value(params.clone()).map_err(|_| {
            RpcError::new(
                "invalid_argument",
                "harness.models needs params {\"harnessId\": \"<claude|pi|opencode|antigravity|codex>\"}",
            )
        })?;
        let id = parsed.harness_id.trim();
        if id.is_empty() || id.len() > 64 || id.chars().any(char::is_control) {
            return Err(RpcError::new(
                "invalid_argument",
                "harnessId must be a 1..64 byte control-free string",
            ));
        }
        Ok(Self {
            harness_id: id.to_string(),
        })
    }
}

/// Why the harness can (or cannot) launch at all on this host. Mirrors the
/// discovery verdict spelled `snake_case` on the wire.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HarnessModelsAvailability {
    Available,
    Missing,
    UnsupportedLauncher,
}

/// How the enumeration attempt ended. Every variant is a fact about the
/// probe; the renderer renders each distinctly and none of them invents
/// model rows. Mirrors `drogon_harness::EnumerationStatus` (`snake_case`).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HarnessModelsStatus {
    /// The harness answered; `entries` holds what it reported (possibly
    /// empty — an auth-gated empty answer is still an honest enumeration).
    Enumerated,
    /// The executable is absent or not runnable.
    NotInstalled,
    /// The harness exposes no model enumeration command on this host.
    UnsupportedSurface,
    /// Host enumeration is unavailable on this platform (failed closed).
    UnsupportedPlatform,
    /// The probe ran but its output could not be parsed.
    ParseFailed,
    /// The probe exceeded its wall-clock budget.
    TimedOut,
    /// The probe child exited non-zero.
    ProbeFailed,
    /// The private probe root could not be created; the probe never ran.
    IsolationFailed,
}

/// One enumerated model, verbatim as the harness's own surface reported it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessModelEntry {
    /// Owning provider as reported; `None` for surfaces reporting bare ids.
    pub provider: Option<String>,
    /// Exact model id; selections match this verbatim.
    pub id: String,
    /// Raw reported context window (e.g. `"262.1K"`), uninterpreted.
    pub context: Option<String>,
    /// Raw reported max output, uninterpreted.
    pub max_output: Option<String>,
    pub thinking: Option<bool>,
    pub images: Option<bool>,
}

/// How the catalog was produced — the source, version and scope a UI needs
/// to render "enumerated by pi 0.85.1 against a credential-free isolated
/// config at <time>" instead of an unearned "confirmed".
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessModelsProvenance {
    /// Absolute executable the probe ran.
    pub executable: String,
    /// The enumeration argv (e.g. `["--list-models"]`).
    pub argv: Vec<String>,
    /// First line of the bounded `--version` probe, when it succeeded.
    pub version: Option<String>,
    /// Wall-clock epoch milliseconds of the probe; the renderer derives an
    /// honest age from this instead of the daemon claiming freshness.
    pub probed_at_epoch_ms: u64,
    /// Human-readable config scope (e.g. `"private-isolated-root
    /// (credential-free)"` or `"caller-enumerated:<label>"`).
    pub config_scope: String,
}

/// One harness's host-scoped model catalog, as probed by the daemon.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessModelsCatalog {
    /// The harness id, shared session contract wire spelling.
    pub harness: String,
    pub availability: HarnessModelsAvailability,
    /// Absolute executable discovery resolved, `null` when missing.
    pub executable: Option<String>,
    pub provenance: Option<HarnessModelsProvenance>,
    pub entries: Vec<HarnessModelEntry>,
    pub status: HarnessModelsStatus,
    /// Honesty scope notes (auth-gating, cleanup evidence, raw parse
    /// sample). Never credential material.
    pub note: Option<String>,
    /// Probe isolation roots the daemon RETAINED because cleanup could not
    /// be verified. Normally empty; non-empty is disclosed evidence, never
    /// silently dropped.
    pub retained_roots: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn params_accept_a_valid_harness_id() {
        let params = HarnessModelsParams::from_params(&json!({"harnessId": " pi "})).unwrap();
        assert_eq!(params.harness_id, "pi");
    }

    #[test]
    fn params_refuse_missing_empty_or_malformed_ids() {
        for params in [
            json!({}),
            json!({"harnessId": ""}),
            json!({"harnessId": "  "}),
            json!({"harnessId": "bad\nid"}),
            json!({"harnessId": 7}),
            json!({"harnessId": "pi", "extra": true}),
            json!([]),
        ] {
            let err = HarnessModelsParams::from_params(&params).unwrap_err();
            assert_eq!(err.code, "invalid_argument", "{params:?}");
        }
        let long =
            HarnessModelsParams::from_params(&json!({"harnessId": "x".repeat(65)})).unwrap_err();
        assert_eq!(long.code, "invalid_argument");
    }

    #[test]
    fn wire_shapes_serialize_camel_case_with_snake_case_statuses() {
        let catalog = HarnessModelsCatalog {
            harness: "pi".to_string(),
            availability: HarnessModelsAvailability::Available,
            executable: Some("/bin/pi".to_string()),
            provenance: Some(HarnessModelsProvenance {
                executable: "/bin/pi".to_string(),
                argv: vec!["--list-models".to_string()],
                version: Some("0.85.1".to_string()),
                probed_at_epoch_ms: 1_700_000_000_000,
                config_scope: "private-isolated-root (credential-free)".to_string(),
            }),
            entries: vec![HarnessModelEntry {
                provider: Some("kimi-coding".to_string()),
                id: "kimi-for-coding".to_string(),
                context: Some("262.1K".to_string()),
                max_output: Some("32.8K".to_string()),
                thinking: Some(true),
                images: Some(true),
            }],
            status: HarnessModelsStatus::UnsupportedSurface,
            note: Some("scope note".to_string()),
            retained_roots: Vec::new(),
        };
        let value = serde_json::to_value(&catalog).unwrap();
        assert_eq!(value["harness"], "pi");
        assert_eq!(value["availability"], "available");
        assert_eq!(value["provenance"]["probedAtEpochMs"], 1_700_000_000_000u64);
        assert_eq!(
            value["provenance"]["configScope"],
            "private-isolated-root (credential-free)"
        );
        assert_eq!(value["entries"][0]["maxOutput"], "32.8K");
        assert_eq!(value["status"], "unsupported_surface");
        assert_eq!(value["retainedRoots"], json!([]));
    }
}
