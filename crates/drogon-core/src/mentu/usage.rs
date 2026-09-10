//! Observed usage projection for Mentu run records (C07). MIT Copyright
//! (c) 2026 Lovecast Inc. The pinned `mentu-recipes` 0.5.0 record carries
//! usage per `steps[]` entry — `input_tokens`, `output_tokens`, the
//! `usage_known` flag and the `model` string — and nothing else: there is
//! no aggregated run-level usage object and no cost/currency field at all
//! (verified against the locked runtime's record schema and real run
//! records). This module owns the honest reading of those fields, ported
//! from the fork's `reportedToken` semantics
//! (`src/main/mentu/mentu-run-parsing.ts`) with this product's own rules:
//!
//! - A recorded `0` is a genuine measured zero only when the entry carries
//!   `usage_known: true`; otherwise it is an unreported value and stays
//!   absent (rendered "unavailable", never fabricated into a zero).
//! - Malformed, negative, nonfinite and out-of-range values are rejected
//!   and visibly marked ([`MentuStepUsage::invalid`]), never silently
//!   dropped and never summed.
//! - Every `steps[]` entry is one recorded attempt of a labeled step and
//!   carries that attempt's own counts; the entry's `attempts` field is a
//!   lifetime counter that is displayed but never summed into token
//!   totals. Because the record has no aggregated run total, summing each
//!   entry exactly once ([`project_usage`]) is the run total — there is no
//!   second, already-aggregated level to double-count, and re-reading or
//!   re-parsing the same record cannot grow a pure projection.
//! - Attribution is retained per entry: label (step), recorded position
//!   (attempt), `backend` (the record's execution host; the schema has no
//!   separate provider id) and `model`. Entries with different models are
//!   never collapsed.

use serde_json::Value;

use drogon_protocol::mentu::{
    MentuStepRun, MentuStepUsage, MentuUsageInvalidReason, MentuUsageIssue,
};

/// The record's `usage_known` flag: the first strictly-boolean value among
/// the snake_case key the pinned runtime writes and the camelCase key the
/// fork also accepted. Any other type counts as absent.
fn recorded_usage_known(step: &Value) -> Option<bool> {
    ["usage_known", "usageKnown"]
        .iter()
        .find_map(|key| step.get(*key).and_then(Value::as_bool))
}

fn issue(field: &str, reason: MentuUsageInvalidReason) -> MentuUsageIssue {
    MentuUsageIssue {
        field: field.to_string(),
        reason,
    }
}

/// A `0` counts as measured only under `usage_known: true`; an unflagged
/// zero is an unreported value and stays absent.
fn accept(value: u64, usage_known: bool) -> Option<u64> {
    if value == 0 && !usage_known {
        return None;
    }
    Some(value)
}

/// Reads one usage token field per the fork's `reportedToken` ladder,
/// marking every rejected value in `invalid` instead of dropping it
/// silently.
fn token_field(
    step: &Value,
    key: &str,
    usage_known: bool,
    invalid: &mut Vec<MentuUsageIssue>,
) -> Option<u64> {
    let Some(raw) = step.get(key) else {
        return None; // Absent: no issue, honestly unavailable.
    };
    // Lossless integer path first: the pinned runtime writes integer
    // counts, so well-formed values never leave this branch.
    if let Some(value) = raw.as_u64() {
        return accept(value, usage_known);
    }
    let Some(number) = raw.as_f64() else {
        invalid.push(issue(key, MentuUsageInvalidReason::NotANumber));
        return None;
    };
    if !number.is_finite() {
        invalid.push(issue(key, MentuUsageInvalidReason::NotFinite));
        return None;
    }
    if number < 0.0 {
        invalid.push(issue(key, MentuUsageInvalidReason::Negative));
        return None;
    }
    if number.fract() != 0.0 {
        invalid.push(issue(key, MentuUsageInvalidReason::NotAnInteger));
        return None;
    }
    if number > u64::MAX as f64 {
        invalid.push(issue(key, MentuUsageInvalidReason::OutOfRange));
        return None;
    }
    accept(number as u64, usage_known)
}

/// Extracts one run-record step entry's observed usage. `None` when the
/// entry carries no usage keys at all (older schemas, shell-only steps) so
/// the desktop renders "unavailable" rather than an invented zero.
pub fn extract_step_usage(step: &Value) -> Option<MentuStepUsage> {
    let has_usage_keys = ["input_tokens", "output_tokens", "usage_known", "usageKnown"]
        .iter()
        .any(|key| step.get(*key).is_some());
    if !has_usage_keys {
        return None;
    }
    let usage_known = recorded_usage_known(step);
    let known = usage_known == Some(true);
    let mut invalid = Vec::new();
    let input_tokens = token_field(step, "input_tokens", known, &mut invalid);
    let output_tokens = token_field(step, "output_tokens", known, &mut invalid);
    Some(MentuStepUsage {
        input_tokens,
        output_tokens,
        usage_known,
        invalid,
    })
}

/// The run-record keys for rejected token values, shared with
/// [`project_usage`]'s invalid counting.
const INPUT_TOKENS_KEY: &str = "input_tokens";
const OUTPUT_TOKENS_KEY: &str = "output_tokens";

/// Run-level usage totals: a pure projection of the parsed step entries.
/// `input_tokens`/`output_tokens` are `Some` only when at least one entry
/// reported that field (a genuine measured zero included); the `unknown`
/// counts are entries with no measured value for the field (absent,
/// unreported zero, or an entry with no usage object at all); the
/// `invalid` counts are recorded-but-rejected values, which also count as
/// unknown. Nothing here is cumulative state: calling it again on the same
/// entries — or on a fresh parse of the same record — yields the same
/// totals.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MentuUsageSummary {
    pub input_tokens: Option<u64>,
    pub input_unknown: usize,
    pub input_invalid: usize,
    pub output_tokens: Option<u64>,
    pub output_unknown: usize,
    pub output_invalid: usize,
}

pub fn project_usage(steps: &[MentuStepRun]) -> MentuUsageSummary {
    let mut summary = MentuUsageSummary {
        input_tokens: None,
        input_unknown: 0,
        input_invalid: 0,
        output_tokens: None,
        output_unknown: 0,
        output_invalid: 0,
    };
    for step in steps {
        let usage = step.usage.as_ref();
        match usage.and_then(|usage| usage.input_tokens) {
            Some(value) => {
                summary.input_tokens =
                    Some(summary.input_tokens.unwrap_or(0).saturating_add(value));
            }
            None => summary.input_unknown += 1,
        }
        match usage.and_then(|usage| usage.output_tokens) {
            Some(value) => {
                summary.output_tokens =
                    Some(summary.output_tokens.unwrap_or(0).saturating_add(value));
            }
            None => summary.output_unknown += 1,
        }
        if let Some(usage) = usage {
            summary.input_invalid += usage
                .invalid
                .iter()
                .filter(|issue| issue.field == INPUT_TOKENS_KEY)
                .count();
            summary.output_invalid += usage
                .invalid
                .iter()
                .filter(|issue| issue.field == OUTPUT_TOKENS_KEY)
                .count();
        }
    }
    summary
}

#[cfg(test)]
mod tests {
    use super::*;
    use drogon_protocol::mentu::MentuRunStatus;
    use serde_json::json;

    #[test]
    fn usage_keys_absent_means_absent_not_zero() {
        let step = json!({"label": "build", "backend": "shell", "exit_code": 0});
        assert!(extract_step_usage(&step).is_none());
    }

    #[test]
    fn measured_values_pass_through_and_zero_requires_usage_known() {
        let usage = extract_step_usage(&json!({"input_tokens": 50, "output_tokens": 40})).unwrap();
        assert_eq!(usage.input_tokens, Some(50));
        assert_eq!(usage.output_tokens, Some(40));
        assert_eq!(usage.usage_known, None);
        assert!(usage.invalid.is_empty());

        // An unflagged zero is an unreported value, not a measurement.
        let unreported =
            extract_step_usage(&json!({"input_tokens": 0, "output_tokens": 0})).unwrap();
        assert_eq!(unreported.input_tokens, None);
        assert_eq!(unreported.output_tokens, None);
        assert!(unreported.invalid.is_empty());

        // With `usage_known: true` the zero is genuine.
        let measured_zero = extract_step_usage(&json!({
            "input_tokens": 0, "output_tokens": 40, "usage_known": true
        }))
        .unwrap();
        assert_eq!(measured_zero.input_tokens, Some(0));
        assert_eq!(measured_zero.output_tokens, Some(40));

        // `usage_known: false` keeps even nonzero values recorded and
        // preserves the flag as provenance.
        let flagged_unknown =
            extract_step_usage(&json!({"input_tokens": 50, "usage_known": false})).unwrap();
        assert_eq!(flagged_unknown.usage_known, Some(false));
        assert_eq!(flagged_unknown.input_tokens, Some(50));
    }

    #[test]
    fn malformed_negative_and_nonfinite_values_are_marked_not_summed() {
        let usage = extract_step_usage(&json!({
            "input_tokens": "50",
            "output_tokens": 40.5,
            "usage_known": "yes"
        }))
        .unwrap();
        assert_eq!(usage.input_tokens, None);
        assert_eq!(usage.output_tokens, None);
        // A non-boolean `usage_known` is absent provenance, not `false`.
        assert_eq!(usage.usage_known, None);
        assert_eq!(
            usage.invalid,
            vec![
                issue("input_tokens", MentuUsageInvalidReason::NotANumber),
                issue("output_tokens", MentuUsageInvalidReason::NotAnInteger),
            ]
        );

        let negative = extract_step_usage(&json!({"input_tokens": -1})).unwrap();
        assert_eq!(
            negative.invalid,
            vec![issue("input_tokens", MentuUsageInvalidReason::Negative)]
        );

        // A finite number beyond u64 cannot be a measured count: rejected
        // as out of range. (Integer literals that large do not fit any
        // Rust integer type, so the fixture carries the f64 form.)
        let huge = extract_step_usage(
            &serde_json::from_str::<Value>("{\"output_tokens\": 10000000000000000000000000000000}")
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            huge.invalid,
            vec![issue("output_tokens", MentuUsageInvalidReason::OutOfRange)]
        );

        // Nonfinite numbers cannot enter through serde_json at all: the
        // parser refuses overflowing float literals outright, so a
        // malformed record fails at `read_run_json` ("run.json is invalid
        // JSON: number out of range"). The matcher's own NotFinite branch
        // stays as defense-in-depth for any non-`serde_json` Value source.
        assert!(serde_json::from_str::<Value>("{\"output_tokens\": 1e999}").is_err());
    }

    fn step(
        label: &str,
        attempts: i64,
        model: Option<&str>,
        usage: Option<MentuStepUsage>,
    ) -> MentuStepRun {
        MentuStepRun {
            label: label.into(),
            backend: "pi".into(),
            status: MentuRunStatus::Succeeded,
            exit_code: Some(0),
            duration_seconds: Some(3),
            attempts: Some(attempts),
            output_path: None,
            error_path: None,
            error: None,
            verification: None,
            model: model.map(str::to_string),
            usage,
        }
    }

    #[test]
    fn totals_sum_each_entry_once_and_count_unknown_and_invalid() {
        let steps = vec![
            step(
                "recovery",
                1,
                Some("model-a"),
                extract_step_usage(&json!({"input_tokens": 100, "output_tokens": 50})),
            ),
            step(
                "recovery",
                2,
                Some("model-b"),
                extract_step_usage(&json!({"input_tokens": 40})),
            ),
            step("quiet", 1, None, None),
        ];
        let summary = project_usage(&steps);
        // Each recorded attempt counts once; the missing output value on
        // the retry and the usage-less `quiet` entry stay unknown.
        assert_eq!(summary.input_tokens, Some(140));
        assert_eq!(summary.input_unknown, 1);
        assert_eq!(summary.output_tokens, Some(50));
        assert_eq!(summary.output_unknown, 2);
        assert_eq!(summary.input_invalid, 0);
        assert_eq!(summary.output_invalid, 0);
    }

    #[test]
    fn totals_are_a_pure_projection_of_the_same_entries() {
        // Reading "the same record twice" in the native projection:
        // re-parsing identical entries must not grow totals.
        let raw = json!({"input_tokens": 7, "output_tokens": 3, "usage_known": true});
        let first = project_usage(&[step("s", 1, Some("m"), extract_step_usage(&raw))]);
        let second = project_usage(&[step("s", 1, Some("m"), extract_step_usage(&raw))]);
        assert_eq!(first, second);
        assert_eq!(first.input_tokens, Some(7));
    }
}
