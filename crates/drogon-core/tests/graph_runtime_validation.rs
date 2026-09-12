//! Compiler output validated by the runtime's OWN `check`/`doctor --strict`.
//!
//! The most valuable assertion here is the provider-binding pin: the emitted
//! Pi step must carry the complete `{api: "cli", agent: "pi", base_url,
//! model, api_key_env}` binding, because the pinned runtime accepts an
//! incomplete one with `check` exit 0 and `doctor --strict` score 100 and then
//! silently downgrades the agent step to a bare chat-completion HTTP call —
//! no system prompt, no tools — and stamps the run `ok`.
//!
//! Set `DROGON_MENTU_RUNTIME` to the pinned `mentu-recipes` binary to run the
//! same recipe through the REAL runtime's validators (no inference is
//! performed). Without it the test still exercises the emitter and its shape
//! pin through a schema-faithful fixture, the same env-gated convention as
//! `scripts/recipe-toolchain.e2e.test.mjs`.

#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use drogon_core::graph::compiler::{self, PiProviderDefaults, Selection};
use drogon_protocol::graph::{GraphIntent, GraphNodeIntent, GraphNodeProvider};
use serde_json::json;

const FIXTURE_RUNTIME: &str = r#"#!/bin/sh
set -e
case "$1" in
  check) echo "ok"; exit 0 ;;
  doctor) printf '{"findings":[],"score":100}\n'; exit 0 ;;
esac
exit 0
"#;

fn runtime_path(root: &Path) -> PathBuf {
    if let Ok(overridden) = std::env::var("DROGON_MENTU_RUNTIME") {
        let path = PathBuf::from(&overridden);
        assert!(
            path.is_file(),
            "DROGON_MENTU_RUNTIME points at a missing file: {overridden}"
        );
        return path;
    }
    let path = root.join("mentu-recipes-fixture");
    fs::write(&path, FIXTURE_RUNTIME).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn pi_node(id: &str, deps: &[&str]) -> GraphNodeIntent {
    GraphNodeIntent {
        id: id.into(),
        title: format!("Node {id}"),
        harness: "pi".into(),
        model: "qwen3.8-flash-next-nvidia-nvfp4".into(),
        depends_on: deps.iter().map(|d| d.to_string()).collect(),
        prompt: "Report the number of tracked files.".into(),
        enabled: true,
        provider: Some(GraphNodeProvider {
            base_url: "http://127.0.0.1:9/v1".into(),
            api_key_env: "DROGON_FIXTURE_PI_KEY".into(),
        }),
        verify_commands: vec![],
    }
}

fn shell_node(id: &str, deps: &[&str]) -> GraphNodeIntent {
    GraphNodeIntent {
        id: id.into(),
        title: format!("Node {id}"),
        harness: "shell".into(),
        model: String::new(),
        depends_on: deps.iter().map(|d| d.to_string()).collect(),
        prompt: "git ls-files | wc -l".into(),
        enabled: true,
        provider: None,
        verify_commands: vec![],
    }
}

#[test]
fn the_emitted_two_node_recipe_validates_and_always_carries_a_complete_pi_binding() {
    let root = tempfile::tempdir().unwrap();
    let runtime = runtime_path(root.path());
    let workspace = root.path().join("workspace");
    fs::create_dir_all(workspace.join(".mentu/recipes")).unwrap();

    let intent = GraphIntent {
        nodes: vec![shell_node("n1", &[]), pi_node("n2", &["n1"])],
        ..GraphIntent::default()
    };
    let mut compiled = compiler::compile(
        &intent,
        &Selection::Target("n2".into()),
        &PiProviderDefaults::default(),
    )
    .unwrap();
    compiler::validate_and_persist(&runtime, &workspace, &mut compiled).unwrap();

    assert_eq!(compiled.node_ids(), vec!["n1", "n2"]);
    assert_eq!(compiled.recipe_id, "drogon-graph-n2");
    assert_eq!(compiled.content_hash.len(), 64);

    // The pin, read back from the exact bytes the runtime will load.
    let persisted = workspace
        .join(".mentu/recipes/drogon-graph-n2.json")
        .to_string_lossy()
        .into_owned();
    let on_disk: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&persisted).unwrap()).unwrap();
    assert_eq!(on_disk["name"], "drogon-graph-n2");
    assert_eq!(on_disk["steps"][0]["backend"], "shell");
    assert_eq!(on_disk["steps"][1]["backend"], "drogon-pi-n2");
    let binding = &on_disk["providers"]["drogon-pi-n2"];
    assert_eq!(binding["api"], "cli");
    assert_eq!(binding["agent"], "pi");
    assert_eq!(binding["base_url"], "http://127.0.0.1:9/v1");
    assert_eq!(binding["model"], "qwen3.8-flash-next-nvidia-nvfp4");
    assert_eq!(binding["api_key_env"], "DROGON_FIXTURE_PI_KEY");
    for field in ["api", "agent", "base_url", "model", "api_key_env"] {
        assert!(
            binding.get(field).is_some_and(|value| !value.is_null()),
            "incomplete binding on disk: {binding}"
        );
    }
    // And the compiler's own validation never turned the binding into a
    // bare-`pi` step, which is the false-positive shape.
    assert_ne!(on_disk["steps"][1]["backend"], "pi");

    // `check` must accept it, and no ERROR-severity doctor finding may
    // remain. Warnings/info are surfaced to the caller but do not block.
    let errors: Vec<_> = compiled
        .findings
        .iter()
        .filter(|finding| finding.is_error())
        .collect();
    assert!(
        errors.is_empty(),
        "runtime validators reported errors: {errors:#?}"
    );
    assert!(
        compiled
            .findings
            .iter()
            .all(|finding| finding.code != "check_failed"),
        "check refused the recipe: {:#?}",
        compiled.findings
    );
}

/// The trap itself, documented as a test: the runtime's own `check` and
/// `doctor --strict` accept an INCOMPLETE provider binding (or a bare `pi`
/// step), which is why the emitter cannot rely on them alone. When the real
/// binary is available this asserts the live false-positive; otherwise the
/// fixture stands in so the shape claim still has a consumer.
#[test]
fn an_incomplete_pi_binding_passes_the_runtimes_validators() {
    let root = tempfile::tempdir().unwrap();
    let runtime = runtime_path(root.path());
    let workspace = root.path().join("workspace");
    fs::create_dir_all(workspace.join(".mentu/recipes")).unwrap();

    let bare: serde_json::Value = json!({
        "name": "drogon-bare-pi",
        "steps": [{"label": "n1", "backend": "pi", "prompt": "x", "timeout": 60,
                   "completion_keyword": "DONE"}],
    });
    let mut compiled = compiler::CompiledGraph {
        recipe_id: "drogon-bare-pi".into(),
        recipe: bare,
        content_hash: String::new(),
        nodes: vec![compiler::CompiledNode {
            id: "n1".into(),
            step_label: "n1".into(),
        }],
        findings: Vec::new(),
    };
    compiler::validate_and_persist(&runtime, &workspace, &mut compiled).unwrap();
    assert!(
        !compiled.findings.iter().any(|finding| finding.is_error()),
        "the documented false positive: the validators do not refuse a bare pi step: {:#?}",
        compiled.findings
    );
}
