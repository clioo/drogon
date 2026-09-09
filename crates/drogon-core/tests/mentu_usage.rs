//! C07 integration: observed Mentu usage projected from real-shaped
//! pinned-runtime (`mentu-recipes` 0.5.0) run-record fixtures through the
//! same seam production uses — `run_record::read_run_json` +
//! `run_record::parse_steps` — then summed by `usage::project_usage`.
//! MIT Copyright (c) 2026 Lovecast Inc.
//!
//! The fixtures live in `tests/fixtures/mentu_usage/`: complete, partial,
//! absent (old schema), unreported zero, retry and malformed records.
//! Reading the same record twice must yield identical projections: the
//! projection is a pure function of the record, never a cumulative read.

use std::fs;

use drogon_core::mentu::run_record;
use drogon_core::mentu::usage::project_usage;
use drogon_protocol::mentu::{MentuRunStatus, MentuUsageInvalidReason};

fn fixture(name: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/mentu_usage")
        .join(name);
    fs::read_to_string(path).expect("fixture must exist")
}

/// Writes `fixture_name` as the run record of `run_id` inside a fresh
/// temp workspace and returns the workspace root.
fn workspace_with_record(workspace: &std::path::Path, run_id: &str, fixture_name: &str) {
    let run_dir = workspace.join(".mentu").join("runs").join(run_id);
    fs::create_dir_all(&run_dir).expect("run dir");
    fs::write(run_dir.join("run.json"), fixture(fixture_name)).expect("run.json");
}

fn parse_fixture(
    workspace: &std::path::Path,
    run_id: &str,
) -> Vec<drogon_protocol::mentu::MentuStepRun> {
    let run_json = run_record::read_run_json(workspace, run_id)
        .expect("record must read")
        .expect("record must exist");
    run_record::parse_steps(&run_json, run_id)
}

#[test]
fn complete_record_reports_exact_totals_with_genuine_zero() {
    let workspace = tempfile::tempdir().unwrap();
    workspace_with_record(
        workspace.path(),
        "run_20260907A_complete01",
        "complete.json",
    );
    let steps = parse_fixture(workspace.path(), "run_20260907A_complete01");
    assert_eq!(steps.len(), 2);

    let research = &steps[0];
    assert_eq!(research.model.as_deref(), Some("glm-5.3-flash"));
    let usage = research.usage.as_ref().unwrap();
    assert_eq!(usage.input_tokens, Some(1200));
    assert_eq!(usage.output_tokens, Some(340));
    assert_eq!(usage.usage_known, Some(true));
    assert!(usage.invalid.is_empty());

    // `usage_known: true` makes the recorded input 0 a genuine measured
    // zero, not an absence.
    let apply = &steps[1];
    let usage = apply.usage.as_ref().unwrap();
    assert_eq!(usage.input_tokens, Some(0));
    assert_eq!(usage.output_tokens, Some(87));

    let summary = project_usage(&steps);
    assert_eq!(summary.input_tokens, Some(1200));
    assert_eq!(summary.output_tokens, Some(427));
    assert_eq!(summary.input_unknown, 0);
    assert_eq!(summary.output_unknown, 0);
    assert_eq!(summary.input_invalid, 0);
    assert_eq!(summary.output_invalid, 0);
}

#[test]
fn partial_record_keeps_unreported_entries_unknown_not_zero() {
    let workspace = tempfile::tempdir().unwrap();
    workspace_with_record(workspace.path(), "run_20260907B_partial001", "partial.json");
    let steps = parse_fixture(workspace.path(), "run_20260907B_partial001");

    // `build` reports tokens without a `usage_known` flag; `lint` carries
    // no usage keys at all (old-schema entry) and gets no usage object.
    assert_eq!(steps[1].usage, None);

    let summary = project_usage(&steps);
    assert_eq!(summary.input_tokens, Some(50));
    assert_eq!(summary.input_unknown, 1);
    assert_eq!(summary.output_tokens, Some(40));
    assert_eq!(summary.output_unknown, 1);
}

#[test]
fn unflagged_zeros_stay_unavailable_and_are_never_totals() {
    let workspace = tempfile::tempdir().unwrap();
    workspace_with_record(
        workspace.path(),
        "run_20260907C_zero_un00",
        "zero-unreported.json",
    );
    let steps = parse_fixture(workspace.path(), "run_20260907C_zero_un00");

    let usage = steps[0].usage.as_ref().unwrap();
    // Zeros without `usage_known: true` are unreported values: absent,
    // not measurements, and never marked invalid.
    assert_eq!(usage.input_tokens, None);
    assert_eq!(usage.output_tokens, None);
    assert_eq!(usage.usage_known, None);
    assert!(usage.invalid.is_empty());

    let summary = project_usage(&steps);
    assert_eq!(summary.input_tokens, None);
    assert_eq!(summary.output_tokens, None);
    assert_eq!(summary.input_unknown, 1);
    assert_eq!(summary.output_unknown, 1);
    assert_eq!(summary.input_invalid, 0);
}

#[test]
fn retry_attempts_count_once_each_with_model_attribution_retained() {
    let workspace = tempfile::tempdir().unwrap();
    workspace_with_record(workspace.path(), "run_20260907D_retries001", "retries.json");
    let steps = parse_fixture(workspace.path(), "run_20260907D_retries001");
    assert_eq!(steps.len(), 3);

    // Both recorded attempts of `recover` keep their own models; the
    // second attempt's missing output value stays unknown.
    assert_eq!(steps[0].label, "recover");
    assert_eq!(steps[0].attempts, Some(1));
    assert_eq!(steps[0].model.as_deref(), Some("model-a"));
    assert_eq!(steps[1].label, "recover");
    assert_eq!(steps[1].attempts, Some(2));
    assert_eq!(steps[1].model.as_deref(), Some("model-b"));
    assert_eq!(steps[1].usage.as_ref().unwrap().output_tokens, None);

    // Totals sum each recorded attempt entry exactly once — 100 + 40 +
    // 10 — never the lifetime `attempts` counters, and never twice.
    let summary = project_usage(&steps);
    assert_eq!(summary.input_tokens, Some(150));
    assert_eq!(summary.output_tokens, Some(55));
    assert_eq!(summary.input_unknown, 0);
    assert_eq!(summary.output_unknown, 1);
}

#[test]
fn malformed_negative_and_out_of_range_values_are_marked_not_summed() {
    let workspace = tempfile::tempdir().unwrap();
    workspace_with_record(
        workspace.path(),
        "run_20260907E_malform01",
        "malformed.json",
    );
    let steps = parse_fixture(workspace.path(), "run_20260907E_malform01");

    let bad = steps[0].usage.as_ref().unwrap();
    assert_eq!(bad.input_tokens, None);
    assert_eq!(bad.output_tokens, None);
    assert_eq!(bad.usage_known, None); // "yes" is not a boolean flag.
    assert_eq!(
        bad.invalid,
        vec![
            drogon_protocol::mentu::MentuUsageIssue {
                field: "input_tokens".into(),
                reason: MentuUsageInvalidReason::NotANumber,
            },
            drogon_protocol::mentu::MentuUsageIssue {
                field: "output_tokens".into(),
                reason: MentuUsageInvalidReason::NotAnInteger,
            },
        ]
    );

    let negative = steps[1].usage.as_ref().unwrap();
    assert_eq!(
        negative.invalid,
        vec![drogon_protocol::mentu::MentuUsageIssue {
            field: "input_tokens".into(),
            reason: MentuUsageInvalidReason::Negative,
        }]
    );
    // Its unflagged output zero is unreported, not invalid and not zero.
    assert_eq!(negative.output_tokens, None);
    assert!(
        negative
            .invalid
            .iter()
            .all(|issue| issue.field == "input_tokens")
    );

    let huge = steps[2].usage.as_ref().unwrap();
    assert_eq!(
        huge.invalid,
        vec![drogon_protocol::mentu::MentuUsageIssue {
            field: "output_tokens".into(),
            reason: MentuUsageInvalidReason::OutOfRange,
        }]
    );

    // No valid measurement survives: totals stay None; every rejected
    // value is counted per field and also as unknown.
    let summary = project_usage(&steps);
    assert_eq!(summary.input_tokens, None);
    assert_eq!(summary.output_tokens, None);
    assert_eq!(summary.input_invalid, 2);
    assert_eq!(summary.output_invalid, 2);
    assert_eq!(summary.input_unknown, 3);
    assert_eq!(summary.output_unknown, 3);
}

#[test]
fn old_schema_record_shows_everything_unavailable_without_inventing_zeros() {
    let workspace = tempfile::tempdir().unwrap();
    workspace_with_record(
        workspace.path(),
        "run_081D22885C1A4042BCDFFDEC9A088F5B",
        "old-schema.json",
    );
    let steps = parse_fixture(workspace.path(), "run_081D22885C1A4042BCDFFDEC9A088F5B");

    // A real 0.5.0 failure record without usage keys: model survives (the
    // schema carries it), usage stays entirely absent, and the failed
    // outcome is preserved as evidence.
    assert_eq!(steps[0].model.as_deref(), Some("fixture-isolation"));
    assert_eq!(steps[0].usage, None);
    assert_eq!(steps[0].status, MentuRunStatus::Failed);
    let summary = project_usage(&steps);
    assert_eq!(summary.input_tokens, None);
    assert_eq!(summary.output_tokens, None);
    assert_eq!(summary.input_unknown, 1);
    assert_eq!(summary.output_unknown, 1);
}

#[test]
fn reading_the_same_record_twice_yields_identical_projections() {
    let workspace = tempfile::tempdir().unwrap();
    workspace_with_record(workspace.path(), "run_20260907D_retries001", "retries.json");

    // Fresh parse of the same on-disk record, twice, plus a re-read of
    // the parsed entries: totals must be stable — a refresh never grows
    // them.
    let first = project_usage(&parse_fixture(workspace.path(), "run_20260907D_retries001"));
    let second = project_usage(&parse_fixture(workspace.path(), "run_20260907D_retries001"));
    let third = {
        let steps = parse_fixture(workspace.path(), "run_20260907D_retries001");
        project_usage(&steps);
        project_usage(&steps)
    };
    assert_eq!(first, second);
    assert_eq!(first, third);
    assert_eq!(first.input_tokens, Some(150));
}
