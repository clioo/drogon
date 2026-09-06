//! Actual-source boundary oracle: all 266 raw-JSON cases emitted by the pinned
//! source implementation (revision c97906287bb7a390b25e2025b600d9fb3c25d9c3,
//! six hash-verified admitted capsule files, Node v24.19.0 / esbuild 0.25.12)
//! fed verbatim through the production Rust validators and record admission.
//!
//! The frozen matrix is the admitted source oracle for portable Rust tests:
//! it is compiled in with `include_str!` so the suite runs from any working
//! directory and never regenerates source cases. The matrix file stays
//! immutable; the expected counts, the cases SHA-256, and the source pin are
//! asserted below so any accidental edit is caught, not silently consumed.
//!
//! Case-to-source mapping and coverage notes live in
//! `tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/source-boundary-case-map.json`.

use std::collections::BTreeSet;

use serde_json::Value;
use sha2::{Digest, Sha256};

use drogon_core::session_authority::provider_handle::{ProviderHandle, ProviderHandleLink};
use drogon_core::session_authority::record::{
    admit_persisted_record, is_agent_session_process_identity, is_agent_session_record,
};

const MATRIX_JSON: &str = include_str!(
    "../../../tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/source-boundary-cases.json"
);

const SOURCE_REVISION: &str = "c97906287bb7a390b25e2025b600d9fb3c25d9c3";
const CASES_SHA256: &str = "e942e2f26becdcf9d8a29418fc949aadb8f8dd76eddb9ec67be282dc18f323c0";
const MATRIX_BYTES_SHA256: &str =
    "948778eb0b27dfe203a19a9ec4e6b56ccac5eaa7a6ed52bfe353856f9812ae3c";
const EXPECTED_CASES: usize = 266;
const EXPECTED_ACCEPTED: usize = 163;
const EXPECTED_REJECTED: usize = 103;

struct MatrixCase {
    id: String,
    target: String,
    raw_json: String,
    accepted: bool,
}

fn load_matrix_cases() -> Vec<MatrixCase> {
    load_matrix_cases_from(MATRIX_JSON)
}

fn load_matrix_cases_from(raw: &str) -> Vec<MatrixCase> {
    assert_eq!(
        format!("{:x}", Sha256::digest(raw.as_bytes())),
        MATRIX_BYTES_SHA256,
        "frozen oracle bytes changed; metadata alone cannot authenticate cases"
    );
    let matrix: Value =
        serde_json::from_str(raw).expect("frozen boundary matrix must be valid JSON");
    assert_eq!(
        matrix
            .get("sourceRevision")
            .and_then(Value::as_str)
            .expect("matrix must record its source revision"),
        SOURCE_REVISION,
        "frozen matrix was regenerated from a different source pin"
    );
    assert_eq!(
        matrix
            .get("casesSha256")
            .and_then(Value::as_str)
            .expect("matrix must record its cases hash"),
        CASES_SHA256,
        "frozen matrix cases hash changed; the oracle is no longer the admitted one"
    );
    let cases = matrix
        .get("cases")
        .and_then(Value::as_array)
        .expect("matrix must carry a cases array");
    assert_eq!(
        cases.len(),
        EXPECTED_CASES,
        "frozen matrix must keep exactly {EXPECTED_CASES} cases"
    );
    let mut seen_ids = BTreeSet::new();
    cases
        .iter()
        .map(|case| {
            let id = case
                .get("id")
                .and_then(Value::as_str)
                .expect("every case has a string id")
                .to_string();
            assert!(
                seen_ids.insert(id.clone()),
                "duplicate case id in frozen matrix: {id}"
            );
            MatrixCase {
                id,
                target: case
                    .get("target")
                    .and_then(Value::as_str)
                    .expect("every case has a string target")
                    .to_string(),
                raw_json: case
                    .get("rawJson")
                    .and_then(Value::as_str)
                    .expect("every case carries its verbatim rawJson")
                    .to_string(),
                accepted: case
                    .get("accepted")
                    .and_then(Value::as_bool)
                    .expect("every case records the source verdict"),
            }
        })
        .collect()
}

/// The production validator the source generator targeted for this case.
/// `rawJson` strings are parsed exactly as a persisted JSON file would be;
/// every spelling (`2.0`, `1e0`, `-0`) therefore reaches the validator the
/// same way it reached the source implementation.
fn candidate_accepts(case: &MatrixCase) -> bool {
    let value: Value = serde_json::from_str(&case.raw_json)
        .unwrap_or_else(|error| panic!("case {} rawJson must parse: {error}", case.id));
    match case.target.as_str() {
        "handle" => ProviderHandle::from_json(&value).is_some(),
        "link" => ProviderHandleLink::from_json(&value).is_some(),
        "process" => is_agent_session_process_identity(&value),
        "record" => is_agent_session_record(&value),
        other => panic!("unknown matrix target {other:?} in case {}", case.id),
    }
}

#[test]
fn matrix_integrity_rejects_edited_cases_with_unchanged_hash_metadata() {
    let mut edited: Value = serde_json::from_str(MATRIX_JSON).unwrap();
    edited["cases"][0]["rawJson"] = Value::String("{}".to_owned());
    assert_eq!(edited["casesSha256"].as_str(), Some(CASES_SHA256));
    assert_eq!(edited["cases"].as_array().unwrap().len(), EXPECTED_CASES);
    let raw = serde_json::to_string(&edited).unwrap();
    assert!(
        std::panic::catch_unwind(|| load_matrix_cases_from(&raw)).is_err(),
        "unchanged metadata must not authenticate edited oracle cases"
    );
}

#[test]
fn matrix_shape_matches_admitted_source_oracle() {
    let cases = load_matrix_cases();
    let accepted = cases.iter().filter(|case| case.accepted).count();
    let rejected = cases.len() - accepted;
    assert_eq!(accepted, EXPECTED_ACCEPTED, "accepted-case count drifted");
    assert_eq!(rejected, EXPECTED_REJECTED, "rejected-case count drifted");
    for target in ["handle", "link", "process", "record"] {
        assert!(
            cases.iter().any(|case| case.target == target),
            "frozen matrix lost its {target} cases"
        );
    }
}

#[test]
fn source_boundary_validators_agree_with_source_oracle() {
    let cases = load_matrix_cases();
    let mismatches: Vec<String> = cases
        .iter()
        .filter(|case| candidate_accepts(case) != case.accepted)
        .map(|case| {
            format!(
                "{}: source accepted={} but production validator accepts={}",
                case.id,
                case.accepted,
                candidate_accepts(case)
            )
        })
        .collect();
    assert!(
        mismatches.is_empty(),
        "{} validator mismatches against the pinned source oracle:\n{}",
        mismatches.len(),
        mismatches.join("\n")
    );
}

#[test]
fn source_boundary_record_admission_agrees_with_source_oracle() {
    let cases = load_matrix_cases();
    let mismatches: Vec<String> = cases
        .iter()
        .filter(|case| case.target == "record")
        .filter_map(|case| {
            let value: Value = serde_json::from_str(&case.raw_json)
                .unwrap_or_else(|error| panic!("case {} rawJson must parse: {error}", case.id));
            let admitted = admit_persisted_record(&value).is_ok();
            (admitted != case.accepted).then(|| {
                format!(
                    "{}: source accepted={} but record admission admits={}",
                    case.id, case.accepted, admitted
                )
            })
        })
        .collect();
    assert!(
        mismatches.is_empty(),
        "{} record-admission mismatches against the pinned source oracle:\n{}",
        mismatches.len(),
        mismatches.join("\n")
    );
}

#[test]
fn admitted_record_cases_roundtrip_through_typed_model() {
    let cases = load_matrix_cases();
    let failures: Vec<String> = cases
        .iter()
        .filter(|case| case.target == "record" && case.accepted)
        .filter_map(|case| {
            let value: Value = serde_json::from_str(&case.raw_json)
                .unwrap_or_else(|error| panic!("case {} rawJson must parse: {error}", case.id));
            let record = admit_persisted_record(&value)
                .unwrap_or_else(|error| panic!("case {} must admit: {:?}", case.id, error));
            let serialized = record.to_json();
            if !is_agent_session_record(&serialized) {
                return Some(format!(
                    "{}: typed serialization no longer validates as a record",
                    case.id
                ));
            }
            let re_admitted = admit_persisted_record(&serialized).unwrap_or_else(|error| {
                panic!("case {} roundtrip must admit: {:?}", case.id, error)
            });
            (re_admitted != record).then(|| format!("{}: typed roundtrip is not stable", case.id))
        })
        .collect();
    assert!(
        failures.is_empty(),
        "{} roundtrip failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

#[test]
fn minimum_next_fence_raw_values_survive_admission_and_roundtrip() {
    let cases = load_matrix_cases();
    let fence_cases: Vec<&MatrixCase> = cases
        .iter()
        .filter(|case| case.id.starts_with("record:unvalidated-minimumNextFence"))
        .collect();
    assert_eq!(
        fence_cases.len(),
        6,
        "the source oracle admits exactly six unvalidated minimumNextFence spellings"
    );
    for case in fence_cases {
        let value: Value = serde_json::from_str(&case.raw_json)
            .unwrap_or_else(|error| panic!("case {} rawJson must parse: {error}", case.id));
        let record = admit_persisted_record(&value)
            .unwrap_or_else(|error| panic!("case {} must admit: {:?}", case.id, error));
        let persisted = value
            .get("lease")
            .and_then(|lease| lease.get("minimumNextFence"))
            .expect("case carries a lease minimumNextFence");
        assert_eq!(
            record.lease.minimum_next_fence.as_ref(),
            Some(persisted),
            "{}: admission must preserve the raw minimumNextFence verbatim",
            case.id
        );
        let re_serialized = record.to_json();
        assert_eq!(
            re_serialized
                .get("lease")
                .and_then(|lease| lease.get("minimumNextFence")),
            Some(persisted),
            "{}: typed serialization must re-emit the raw minimumNextFence",
            case.id
        );
    }
}
