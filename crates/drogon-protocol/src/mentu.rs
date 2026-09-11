//! Wire types for Mentu (journey J9): workspace recipes, an explicit
//! content-bound approval, execution through the pinned `mentu-recipes`
//! runtime, run records with per-step evidence, and retry. Shape validation
//! only: the execution host verifies workspace ownership, recipe
//! containment and the runtime lock, same division of labor as `tasks.rs`.

use crate::RpcError;
use crate::orchestration_common::validate_opaque_token;
use serde::{Deserialize, Serialize};

pub const MENTU_CAPABILITY: &str = "mentu.v1";
pub const MAX_MENTU_ID_BYTES: usize = 200;

fn validate_workspace_id(value: &str) -> Result<(), RpcError> {
    validate_opaque_token(value, 128, "Invalid Mentu workspace identity.")
}

fn validate_recipe_id(value: &str) -> Result<(), RpcError> {
    validate_opaque_token(value, MAX_MENTU_ID_BYTES, "Invalid Mentu recipe identity.")
}

fn validate_run_id(value: &str) -> Result<(), RpcError> {
    validate_opaque_token(value, MAX_MENTU_ID_BYTES, "Invalid Mentu run identity.")
}

/// One entry in `.mentu/recipes` for a workspace: valid recipes carry a
/// `name`; a recipe that fails to parse still lists its path with `issue`
/// set, mirroring the fork's tolerant catalog (a bad recipe never hides the
/// rest of the list).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MentuRecipeSummary {
    pub id: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub valid: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MentuStep {
    pub label: String,
    pub backend: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_seconds: Option<u64>,
    /// The step's `verify.commands` strings, when the recipe defines any:
    /// the declared verification contract. The matching results live on
    /// each step run's `verification`, when the run record carries them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub verify_commands: Vec<String>,
}

/// The verification results `mentu-recipes` recorded for one step run:
/// the `verify` contract evaluated after the step, as error/warning
/// message lists. `None` when the run record carries no `verification`
/// object (older records, fixture runs) — rendered as "not recorded",
/// never as a clean bill.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MentuStepVerification {
    #[serde(default)]
    pub errors: Vec<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// Why one recorded usage value could not be accepted as a measurement.
/// Malformed, negative, nonfinite and out-of-range numbers are visibly
/// marked, never silently dropped and never summed into totals.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MentuUsageInvalidReason {
    NotANumber,
    NotAnInteger,
    Negative,
    NotFinite,
    OutOfRange,
}

/// One rejected usage field: the run-record key exactly as written there
/// (e.g. `input_tokens`) and why its value is not a usable measurement.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MentuUsageIssue {
    pub field: String,
    pub reason: MentuUsageInvalidReason,
}

/// The usage one run-record step entry observed, mirroring the fork's
/// per-step fields (`src/shared/mentu-run-contract.ts`'s `usage_known`,
/// `input_tokens`, `output_tokens`) with this product's honesty rules: a
/// recorded `0` is a genuine measured zero only when the entry carries
/// `usage_known: true`; anything rejected is marked in `invalid` and
/// excluded from totals. Each `steps[]` entry carries its own attempt's
/// token counts — the record has no separate aggregated run-level usage
/// object, so these per-entry values are the only source there is.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MentuStepUsage {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    /// The entry's `usage_known` flag, when recorded as a boolean: the only
    /// basis on which a recorded 0 counts as measured. `None` when the
    /// record carries no boolean flag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage_known: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub invalid: Vec<MentuUsageIssue>,
}

/// A parsed recipe plus its raw source text (the client-local "draft" seed)
/// and the sha256 of its exact on-disk bytes, which `mentu.approve` binds
/// approval to.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MentuRecipeDetail {
    pub id: String,
    pub path: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub content_hash: String,
    pub steps: Vec<MentuStep>,
    pub source: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MentuRuntimeInfo {
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub expected_revision: String,
    pub expected_sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actual_sha256: Option<String>,
    pub lock_matches: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Outcome of `mentu.runtime_install` (journey J9, fresh-install
/// provisioning): whether this call actually copied bytes, or found the
/// fixed runtime path already holding the identical, verified source.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MentuRuntimeInstallStatus {
    Installed,
    AlreadyInstalled,
}

/// Params for `mentu.runtime_install`: `source_path` is a local, already
/// existing runtime binary (never fetched by the daemon itself — the caller
/// is responsible for how it got on disk, e.g. this repo's
/// `scripts/mentu-runtime-provision.mjs` staging one before packaging, or a
/// developer pointing at a locally built `mentu-recipes`). Installation only
/// activates it after its sha256 matches [`MENTU_LOCK_SHA256`]'s runtime
/// value (`crate::mentu`'s `runtime` module owns the actual constant, kept
/// out of this shape-only crate).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRuntimeInstallParams {
    pub source_path: String,
}

impl MentuRuntimeInstallParams {
    pub fn validate(&self) -> Result<(), RpcError> {
        if self.source_path.is_empty()
            || self.source_path.len() > 4096
            || self.source_path.contains('\0')
        {
            return Err(RpcError::new(
                "invalid_argument",
                "Invalid Mentu runtime source path.",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRuntimeInstallResult {
    pub runtime: MentuRuntimeInfo,
    pub status: MentuRuntimeInstallStatus,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MentuApproval {
    pub id: String,
    pub workspace_id: String,
    pub recipe_id: String,
    pub content_hash: String,
    pub approved_at: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MentuRunStatus {
    Running,
    Succeeded,
    Failed,
    Cancelled,
    /// The host process could not confirm an outcome (e.g. it never produced
    /// a run record). Never reported as `succeeded`/`failed`.
    Unavailable,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MentuStepRun {
    pub label: String,
    pub backend: String,
    pub status: MentuRunStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempts: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification: Option<MentuStepVerification>,
    /// The model the runtime recorded for this entry, when a string.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Observed usage for this recorded entry; `None` when the record
    /// carries none (older schemas, shell-only steps) so the desktop can
    /// show "unavailable" rather than an invented zero.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<MentuStepUsage>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MentuRun {
    pub id: String,
    pub workspace_id: String,
    pub recipe_id: String,
    pub approval_id: String,
    /// The id `mentu-recipes` itself minted for this run (`run_...`), once
    /// known. Absent only in the brief window between spawn and the CLI
    /// creating its run directory.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mentu_run_id: Option<String>,
    pub status: MentuRunStatus,
    pub started_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    pub steps: Vec<MentuStepRun>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_of: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuWorkspaceScopeParams {
    pub workspace_id: String,
}

impl MentuWorkspaceScopeParams {
    pub fn validate(&self) -> Result<(), RpcError> {
        validate_workspace_id(&self.workspace_id)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRecipeParams {
    pub workspace_id: String,
    pub recipe_id: String,
}

impl MentuRecipeParams {
    pub fn validate(&self) -> Result<(), RpcError> {
        validate_workspace_id(&self.workspace_id)?;
        validate_recipe_id(&self.recipe_id)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuApproveParams {
    pub workspace_id: String,
    pub recipe_id: String,
    pub content_hash: String,
}

impl MentuApproveParams {
    pub fn validate(&self) -> Result<(), RpcError> {
        validate_workspace_id(&self.workspace_id)?;
        validate_recipe_id(&self.recipe_id)?;
        if self.content_hash.len() != 64
            || !self.content_hash.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(RpcError::new(
                "invalid_argument",
                "Invalid Mentu recipe content hash.",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRunParams {
    pub workspace_id: String,
    pub recipe_id: String,
    pub approval_id: String,
}

impl MentuRunParams {
    pub fn validate(&self) -> Result<(), RpcError> {
        validate_workspace_id(&self.workspace_id)?;
        validate_recipe_id(&self.recipe_id)?;
        validate_opaque_token(&self.approval_id, 128, "Invalid Mentu approval identity.")
    }
}

/// Params for `mentu.pending_approval`: the unconsumed approval bound to
/// this recipe's exact on-disk content, if one exists. Read-only, and the
/// only way a caller can turn "the human already approved this recipe"
/// into the approval id `mentu.run` demands without inventing a second
/// approval path (`mentu.approve` stays the human-facing write).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuPendingApprovalParams {
    pub workspace_id: String,
    pub recipe_id: String,
}

impl MentuPendingApprovalParams {
    pub fn validate(&self) -> Result<(), RpcError> {
        validate_workspace_id(&self.workspace_id)?;
        validate_recipe_id(&self.recipe_id)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRunsParams {
    pub workspace_id: String,
    #[serde(default)]
    pub limit: Option<u32>,
}

pub const DEFAULT_MENTU_RUNS_LIMIT: u32 = 50;
pub const MAX_MENTU_RUNS_LIMIT: u32 = 200;

impl MentuRunsParams {
    pub fn validate(&self) -> Result<u32, RpcError> {
        validate_workspace_id(&self.workspace_id)?;
        Ok(self
            .limit
            .unwrap_or(DEFAULT_MENTU_RUNS_LIMIT)
            .clamp(1, MAX_MENTU_RUNS_LIMIT))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRunIdParams {
    pub run_id: String,
}

impl MentuRunIdParams {
    pub fn validate(&self) -> Result<(), RpcError> {
        validate_run_id(&self.run_id)
    }
}

/// Params for `mentu.recipe_save` (journey J9, recipe editing): `content`
/// is the exact new JSON source text for the recipe. The daemon validates
/// it like the load path (JSON object with `name` and a `steps` array of
/// labeled steps), writes it atomically inside `.mentu/recipes`, and
/// invalidates approvals bound to the old content hash.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRecipeSaveParams {
    pub workspace_id: String,
    pub recipe_id: String,
    pub content: String,
}

/// The 1 MiB safety limit the daemon also enforces on recipe sources at
/// rest (`recipe.rs`); params carrying more are refused before any I/O.
pub const MAX_MENTU_RECIPE_SOURCE_BYTES: usize = 1024 * 1024;

impl MentuRecipeSaveParams {
    pub fn validate(&self) -> Result<(), RpcError> {
        validate_workspace_id(&self.workspace_id)?;
        validate_recipe_id(&self.recipe_id)?;
        let bytes = self.content.len();
        if bytes == 0 || bytes > MAX_MENTU_RECIPE_SOURCE_BYTES {
            return Err(RpcError::new(
                "invalid_argument",
                "Invalid Mentu recipe content.",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRecipesResult {
    pub recipes: Vec<MentuRecipeSummary>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRecipeResult {
    pub recipe: MentuRecipeDetail,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRuntimeResult {
    pub runtime: MentuRuntimeInfo,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuApproveResult {
    pub approval: MentuApproval,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRunResult {
    pub run: MentuRun,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRunsResult {
    pub runs: Vec<MentuRun>,
}

/// The pending approval for a recipe's exact current content, if any.
/// `approval: null` is the honest "nothing is approved right now" answer;
/// it never fabricates an approval, and the caller must refuse the run
/// rather than approve it itself.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuPendingApprovalResult {
    pub approval: Option<MentuApproval>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuCancelResult {
    pub run: MentuRun,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRecipeSaveResult {
    pub recipe: MentuRecipeDetail,
}

/// One captured stdio stream for a step, ported from the fork's
/// `MentuReferencedOutput` (`src/shared/mentu-run-contract.ts`):
/// `reference` is the file name the run record carries (`output_file` /
/// `error_file`), `path` the absolute path resolved inside the run
/// directory, and `content` the head of its UTF-8 text (lossy). `error`
/// carries the fork's machine-readable reasons verbatim:
/// `reference_outside_run_directory` (bad reference, or a record the OS
/// will not resolve) and `content_truncated` (content present but cut at
/// [`MAX_MENTU_EVIDENCE_BYTES`]); any other value is the OS read error.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MentuReferencedOutput {
    pub reference: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// The fork's per-output size cap (`MAX_OUTPUT_BYTES` in
/// `src/main/mentu/mentu-run-evidence-files.ts`): evidence reads never
/// pull more than the first 512 KiB of a stream into an RPC response.
pub const MAX_MENTU_EVIDENCE_BYTES: usize = 512 * 1024;

/// The `reference_outside_run_directory` reason: the record's file name is
/// empty, absolute, escapes the run directory, or names a path the OS
/// will not resolve to a file inside it.
pub const MENTU_EVIDENCE_OUTSIDE_RUN_DIR: &str = "reference_outside_run_directory";

/// The `content_truncated` reason: the stream is longer than
/// [`MAX_MENTU_EVIDENCE_BYTES`]; `content` still carries the head bytes.
pub const MENTU_EVIDENCE_CONTENT_TRUNCATED: &str = "content_truncated";

/// One step label's captured streams. Labels repeat across attempts in a
/// resumed record; the newest record wins, the same overwrite order the
/// fork's `readMentuRunEvidence` uses for `outputs[label]`.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MentuStepEvidence {
    pub label: String,
    pub stdout: MentuReferencedOutput,
    pub stderr: MentuReferencedOutput,
}

/// Params for `mentu.run_evidence` (journey J9, run evidence content):
/// `run_id` is this daemon's own run row id (not the `run_...` id
/// `mentu-recipes` minted). A separate read-only call — not fields on
/// `mentu.run_status` — mirroring the fork's separate `mentu.run.read`:
/// evidence payloads are up to 512 KiB per stream and must not ride the
/// 750 ms status poll.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRunEvidenceParams {
    pub run_id: String,
}

impl MentuRunEvidenceParams {
    pub fn validate(&self) -> Result<(), RpcError> {
        validate_run_id(&self.run_id)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MentuRunEvidenceResult {
    pub run_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mentu_run_id: Option<String>,
    pub evidence: Vec<MentuStepEvidence>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_run() -> MentuRun {
        MentuRun {
            id: "internal-1".into(),
            workspace_id: "ws1".into(),
            recipe_id: "hello".into(),
            approval_id: "approval-1".into(),
            mentu_run_id: Some("run_20260907202509_15F1772D".into()),
            status: MentuRunStatus::Succeeded,
            started_at: "2026-09-07T20:25:09Z".into(),
            ended_at: Some("2026-09-07T20:25:09Z".into()),
            steps: vec![MentuStepRun {
                label: "say-hello".into(),
                backend: "shell".into(),
                status: MentuRunStatus::Succeeded,
                exit_code: Some(0),
                duration_seconds: Some(0),
                attempts: Some(1),
                output_path: Some("say-hello.stdout".into()),
                error_path: Some("say-hello.stderr".into()),
                error: None,
                verification: None,
                model: None,
                usage: None,
            }],
            error: None,
            retry_of: None,
        }
    }

    #[test]
    fn run_round_trips_with_exact_wire_keys_and_snake_case_status() {
        let value = serde_json::to_value(sample_run()).unwrap();
        assert_eq!(
            value,
            json!({
                "id": "internal-1",
                "workspaceId": "ws1",
                "recipeId": "hello",
                "approvalId": "approval-1",
                "mentuRunId": "run_20260907202509_15F1772D",
                "status": "succeeded",
                "startedAt": "2026-09-07T20:25:09Z",
                "endedAt": "2026-09-07T20:25:09Z",
                "steps": [{
                    "label": "say-hello",
                    "backend": "shell",
                    "status": "succeeded",
                    "exitCode": 0,
                    "durationSeconds": 0,
                    "attempts": 1,
                    "outputPath": "say-hello.stdout",
                    "errorPath": "say-hello.stderr",
                }],
            })
        );
        let back: MentuRun = serde_json::from_value(value).unwrap();
        assert_eq!(back, sample_run());
    }

    #[test]
    fn step_usage_round_trips_with_exact_wire_keys_and_marks_invalid_values() {
        let mut run = sample_run();
        run.steps[0].model = Some("glm-5.3-flash".into());
        run.steps[0].usage = Some(MentuStepUsage {
            input_tokens: Some(0),
            output_tokens: None,
            usage_known: Some(true),
            invalid: vec![MentuUsageIssue {
                field: "output_tokens".into(),
                reason: MentuUsageInvalidReason::Negative,
            }],
        });
        let value = serde_json::to_value(&run).unwrap();
        assert_eq!(value["steps"][0]["model"], json!("glm-5.3-flash"));
        assert_eq!(
            value["steps"][0]["usage"],
            json!({
                "inputTokens": 0,
                "usageKnown": true,
                "invalid": [{"field": "output_tokens", "reason": "negative"}],
            })
        );
        let back: MentuRun = serde_json::from_value(value).unwrap();
        assert_eq!(back, run);
    }

    #[test]
    fn responses_without_usage_deserialize_as_absent_not_zero() {
        // Older daemons (and older run records replayed through them) omit
        // `model`/`usage` entirely: they must default to None, never to a
        // fabricated zero measurement.
        let legacy = serde_json::from_value::<MentuRun>(json!({
            "id": "internal-1",
            "workspaceId": "ws1",
            "recipeId": "hello",
            "approvalId": "approval-1",
            "status": "succeeded",
            "startedAt": "2026-09-07T20:25:09Z",
            "steps": [{
                "label": "say-hello",
                "backend": "shell",
                "status": "succeeded",
            }],
        }))
        .unwrap();
        assert_eq!(legacy.steps[0].model, None);
        assert_eq!(legacy.steps[0].usage, None);
    }

    #[test]
    fn approve_params_require_a_64_char_hex_content_hash() {
        let base = MentuApproveParams {
            workspace_id: "ws1".into(),
            recipe_id: "hello".into(),
            content_hash: "a".repeat(64),
        };
        base.validate().unwrap();
        for bad in ["", "a".repeat(63).as_str(), "z".repeat(64).as_str()] {
            let mut params = base.clone();
            params.content_hash = bad.to_string();
            assert_eq!(params.validate().unwrap_err().code, "invalid_argument");
        }
    }

    #[test]
    fn pending_approval_params_validate_ids_like_recipe_params() {
        let params = MentuPendingApprovalParams {
            workspace_id: "ws1".into(),
            recipe_id: "hello".into(),
        };
        params.validate().unwrap();
        // Additive fields stay forward-compatible.
        let forward: MentuPendingApprovalParams = serde_json::from_value(
            json!({"workspaceId": "ws1", "recipeId": "hello", "future": true}),
        )
        .unwrap();
        forward.validate().unwrap();
        for bad in ["", "has space", "has\nnewline"] {
            let params = MentuPendingApprovalParams {
                workspace_id: "ws1".into(),
                recipe_id: bad.into(),
            };
            assert!(params.validate().is_err(), "recipe id {bad:?}");
            let params = MentuPendingApprovalParams {
                workspace_id: bad.into(),
                recipe_id: "hello".into(),
            };
            assert!(params.validate().is_err(), "workspace id {bad:?}");
        }
    }

    #[test]
    fn pending_approval_result_serializes_null_approval_as_absence() {
        let result = MentuPendingApprovalResult { approval: None };
        let value = serde_json::to_value(&result).unwrap();
        assert_eq!(value, json!({"approval": null}));
        let result = MentuPendingApprovalResult {
            approval: Some(MentuApproval {
                id: "appr-1".into(),
                workspace_id: "ws1".into(),
                recipe_id: "hello".into(),
                content_hash: "a".repeat(64),
                approved_at: "2026-09-07T00:00:00Z".into(),
            }),
        };
        let value = serde_json::to_value(&result).unwrap();
        assert_eq!(value["approval"]["contentHash"], json!("a".repeat(64)));
        assert_eq!(
            value["approval"]["approvedAt"],
            json!("2026-09-07T00:00:00Z")
        );
    }

    #[test]
    fn runs_params_default_and_clamp_the_limit() {
        let params = MentuRunsParams {
            workspace_id: "ws1".into(),
            limit: None,
        };
        assert_eq!(params.validate().unwrap(), DEFAULT_MENTU_RUNS_LIMIT);
        let params = MentuRunsParams {
            workspace_id: "ws1".into(),
            limit: Some(MAX_MENTU_RUNS_LIMIT + 500),
        };
        assert_eq!(params.validate().unwrap(), MAX_MENTU_RUNS_LIMIT);
        let params = MentuRunsParams {
            workspace_id: "".into(),
            limit: None,
        };
        assert!(params.validate().is_err());
    }

    #[test]
    fn scope_params_accept_additive_fields_and_reject_empty_ids() {
        let value = json!({"workspaceId": "ws1", "recipeId": "hello", "future": true});
        let params: MentuRecipeParams = serde_json::from_value(value).unwrap();
        params.validate().unwrap();
        let bad = MentuRecipeParams {
            workspace_id: "".into(),
            recipe_id: "hello".into(),
        };
        assert!(bad.validate().is_err());
    }

    #[test]
    fn recipe_summary_omits_optional_fields_when_absent() {
        let summary = MentuRecipeSummary {
            id: "hello".into(),
            path: ".mentu/recipes/hello.json".into(),
            name: Some("hello".into()),
            valid: true,
            issue: None,
        };
        let value = serde_json::to_value(summary).unwrap();
        assert!(value.get("issue").is_none());
        assert_eq!(value["name"], "hello");
    }

    #[test]
    fn step_verify_commands_default_and_round_trip() {
        // Older daemons omit the field: it must default, never fail.
        let legacy = serde_json::from_value::<MentuStep>(json!({
            "label": "say-hello",
            "backend": "shell",
        }))
        .unwrap();
        assert!(legacy.verify_commands.is_empty());
        let step = MentuStep {
            verify_commands: vec!["test -f out.txt".into()],
            ..legacy.clone()
        };
        let value = serde_json::to_value(&step).unwrap();
        assert_eq!(value["verifyCommands"], json!(["test -f out.txt"]));
        // Empty commands stay off the wire like the other optional fields.
        let bare = MentuStep {
            verify_commands: Vec::new(),
            ..legacy.clone()
        };
        assert!(
            serde_json::to_value(bare)
                .unwrap()
                .get("verifyCommands")
                .is_none()
        );
    }

    #[test]
    fn recipe_save_params_validate_ids_and_bound_the_content_size() {
        let base = MentuRecipeSaveParams {
            workspace_id: "ws1".into(),
            recipe_id: "hello".into(),
            content: r#"{"name":"hello","steps":[]}"#.into(),
        };
        base.validate().unwrap();
        // Additive params stay forward-compatible: unknown fields deserialize.
        let forward: MentuRecipeSaveParams = serde_json::from_value(
            json!({"workspaceId": "ws1", "recipeId": "hello", "content": "{}", "future": true}),
        )
        .unwrap();
        forward.validate().unwrap();
        let empty = MentuRecipeSaveParams {
            content: String::new(),
            ..base.clone()
        };
        assert_eq!(empty.validate().unwrap_err().code, "invalid_argument");
        let oversize = MentuRecipeSaveParams {
            content: "x".repeat(MAX_MENTU_RECIPE_SOURCE_BYTES + 1),
            ..base.clone()
        };
        assert_eq!(oversize.validate().unwrap_err().code, "invalid_argument");
        // Shape validation only: empty and whitespace ids are refused here;
        // traversal (`../escape`) stays valid on the wire and is refused by
        // the daemon's containment checks, the same division of labor as
        // every other `mentu.*` method.
        for bad_id in ["", "has space", "has\nnewline"] {
            let bad = MentuRecipeSaveParams {
                recipe_id: bad_id.into(),
                ..base.clone()
            };
            assert!(
                bad.validate().is_err(),
                "recipe id {bad_id:?} must be refused"
            );
        }
    }

    #[test]
    fn run_evidence_result_carries_referenced_outputs_with_exact_wire_keys() {
        let result = MentuRunEvidenceResult {
            run_id: "internal-1".into(),
            mentu_run_id: Some("run_20260907202509_15F1772D".into()),
            evidence: vec![MentuStepEvidence {
                label: "say-hello".into(),
                stdout: MentuReferencedOutput {
                    reference: "say-hello.stdout".into(),
                    path: Some("/ws/.mentu/runs/run_1/say-hello.stdout".into()),
                    content: Some("hello\n".into()),
                    error: None,
                },
                stderr: MentuReferencedOutput {
                    reference: "say-hello.stderr".into(),
                    path: None,
                    content: None,
                    error: Some(MENTU_EVIDENCE_OUTSIDE_RUN_DIR.into()),
                },
            }],
        };
        let value = serde_json::to_value(&result).unwrap();
        assert_eq!(value["runId"], json!("internal-1"));
        assert_eq!(
            value["evidence"][0]["stdout"],
            json!({
                "reference": "say-hello.stdout",
                "path": "/ws/.mentu/runs/run_1/say-hello.stdout",
                "content": "hello\n",
            })
        );
        assert_eq!(
            value["evidence"][0]["stderr"]["error"],
            json!("reference_outside_run_directory")
        );
        let back: MentuRunEvidenceResult = serde_json::from_value(value).unwrap();
        assert_eq!(back, result);
    }

    #[test]
    fn run_evidence_params_validate_the_daemon_run_id() {
        let params = MentuRunEvidenceParams {
            run_id: "internal-1".into(),
        };
        params.validate().unwrap();
        for bad in ["", "has space", "has\nnewline"] {
            let params = MentuRunEvidenceParams { run_id: bad.into() };
            assert!(params.validate().is_err());
        }
    }

    #[test]
    fn recipe_save_result_carries_the_new_detail_with_exact_wire_keys() {
        let detail = MentuRecipeDetail {
            id: "hello".into(),
            path: ".mentu/recipes/hello.json".into(),
            name: "hello".into(),
            description: None,
            content_hash: "a".repeat(64),
            steps: Vec::new(),
            source: "{}".into(),
        };
        let value = serde_json::to_value(MentuRecipeSaveResult {
            recipe: detail.clone(),
        })
        .unwrap();
        assert_eq!(value["recipe"]["contentHash"], json!("a".repeat(64)));
        let back: MentuRecipeSaveResult = serde_json::from_value(value).unwrap();
        assert_eq!(back.recipe, detail);
    }
}
