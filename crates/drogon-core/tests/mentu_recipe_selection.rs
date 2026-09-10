//! C03 recipe selection + approved snapshot (journey J9): filesystem and
//! pure-computation cases only. No `Engine`, no daemon, no child process,
//! no model inference — every case runs against a temp workspace through
//! the public `drogon_core::mentu::{recipe, execution}` APIs, so this file
//! stays runnable without any native launcher grant.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::Mutex;

use drogon_core::mentu::execution;
use drogon_core::mentu::recipe;
use drogon_core::mentu::recipe::AgentStepExecution;

/// `PATH`-touching cases run under one serial lock: `PATH` is
/// process-wide and the availability lookup reads it.
static PATH_SERIAL: Mutex<()> = Mutex::new(());
/// The test that points `PATH` at an empty dir restores the previous value
/// on drop, so no other binary (or later case) observes the override.
struct PathOverride {
    previous: Option<String>,
}

impl PathOverride {
    fn set_to(dir: &Path) -> Self {
        let previous = std::env::var("PATH").ok();
        unsafe { std::env::set_var("PATH", dir) };
        Self { previous }
    }
}

impl Drop for PathOverride {
    fn drop(&mut self) {
        unsafe {
            match &self.previous {
                Some(value) => std::env::set_var("PATH", value),
                None => std::env::remove_var("PATH"),
            }
        }
    }
}

fn workspace() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

fn write_recipe(root: &Path, id: &str, contents: &str) {
    let path = root
        .join(".mentu")
        .join("recipes")
        .join(format!("{id}.json"));
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

fn test_argv(workspace_root: &Path, recipe_arg: &str) -> Vec<String> {
    vec![
        "/runtime/mentu-recipes".to_string(),
        "run".to_string(),
        recipe_arg.to_string(),
        "--workspace".to_string(),
        workspace_root.to_string_lossy().into_owned(),
    ]
}

fn two_step() -> String {
    serde_json::json!({
        "name": "two-step",
        "description": "acceptance pair",
        "backend": "shell",
        "customRoot": {"keep": true},
        "steps": [
            {"label": "build", "prompt": "make all", "prompt_file": "docs/build.md",
             "depends_on": [], "timeout": 60, "customStep": [1, 2]},
            {"label": "review", "backend": "codex", "prompt": "review the diff",
             "depends_on": ["build"]}
        ]
    })
    .to_string()
}

/// Acceptance 1: edit step A (execution settings); step B, dependencies
/// and unknown fields are unchanged; reload serves A back verbatim.
#[test]
fn edit_agent_step_preserves_sibling_and_unknown_fields() {
    let dir = workspace();
    fs::create_dir_all(dir.path().join("docs")).unwrap();
    fs::write(dir.path().join("docs/build.md"), "how to build\n").unwrap();
    write_recipe(dir.path(), "pair", &two_step());
    let loaded = recipe::load_recipe(dir.path(), "pair").unwrap();

    let edited = recipe::update_agent_step_execution(
        &loaded.source,
        "review",
        &AgentStepExecution {
            backend: None,
            model: Some("gpt-5.6-luna".to_string()),
        },
    )
    .unwrap();
    let saved =
        recipe::save_recipe_expected(dir.path(), "pair", &edited, &loaded.content_hash).unwrap();

    let reloaded = recipe::load_recipe(dir.path(), "pair").unwrap();
    assert_eq!(reloaded.source, edited);
    assert_eq!(reloaded.content_hash, saved.content_hash);
    let value: serde_json::Value = serde_json::from_str(&reloaded.source).unwrap();
    let steps = value["steps"].as_array().unwrap();
    // B untouched: prompt, dependency edge and custom field survive.
    assert_eq!(
        steps[0]["prompt"],
        serde_json::Value::String("make all".into())
    );
    assert_eq!(steps[0]["depends_on"], serde_json::json!([]));
    assert_eq!(steps[0]["customStep"], serde_json::json!([1, 2]));
    assert_eq!(
        steps[0]["prompt_file"],
        serde_json::Value::String("docs/build.md".into())
    );
    assert!(steps[0].get("model").is_none());
    // A carries exactly the edited execution setting.
    assert_eq!(
        steps[1]["backend"],
        serde_json::Value::String("codex".into())
    );
    assert_eq!(
        steps[1]["model"],
        serde_json::Value::String("gpt-5.6-luna".into())
    );
    assert_eq!(steps[1]["depends_on"], serde_json::json!(["build"]));
    // Unknown root fields round-trip.
    assert_eq!(value["customRoot"], serde_json::json!({"keep": true}));
}

/// Acceptance 2: two editors save from the same hash — exactly one
/// succeeds; the loser receives the conflict and keeps its draft.
#[test]
fn concurrent_saves_from_one_hash_exactly_one_wins() {
    let dir = workspace();
    write_recipe(dir.path(), "pair", &two_step());
    let base = recipe::load_recipe(dir.path(), "pair").unwrap();

    let draft_a = two_step().replace("acceptance pair", "editor A");
    let draft_b = two_step().replace("acceptance pair", "editor B");

    let won =
        recipe::save_recipe_expected(dir.path(), "pair", &draft_a, &base.content_hash).unwrap();
    let lost =
        recipe::save_recipe_expected(dir.path(), "pair", &draft_b, &base.content_hash).unwrap_err();
    assert_eq!(lost.code, recipe::RECIPE_CONFLICT_CODE);
    assert!(lost.message.contains(&won.content_hash));
    // The winner's bytes are on disk; the loser's draft is untouched in hand.
    assert_eq!(
        recipe::load_recipe(dir.path(), "pair").unwrap().source,
        draft_a
    );
    assert!(draft_b.contains("editor B"));
    // The loser reloads, re-reviews the current hash, and can then save.
    let fresh = recipe::load_recipe(dir.path(), "pair").unwrap();
    assert_eq!(fresh.content_hash, won.content_hash);
    let retry =
        recipe::save_recipe_expected(dir.path(), "pair", &draft_b, &fresh.content_hash).unwrap();
    assert_eq!(retry.source, draft_b);
}

/// Acceptance 3: approve version A, edit the file to B before launch — the
/// staged execution content remains A, and freshness verification refuses
/// instead of silently executing B.
#[test]
fn approved_snapshot_survives_a_later_edit_and_refuses_it() {
    let dir = workspace();
    write_recipe(dir.path(), "pair", &two_step());
    let approved = recipe::load_recipe(dir.path(), "pair").unwrap();

    let staged =
        execution::stage_approved_snapshot(dir.path(), "pair", &approved.content_hash).unwrap();
    assert_eq!(staged.recipe_bytes, approved.source.as_bytes());

    // Another editor lands B. The staged bytes still equal A …
    let version_b = two_step().replace("acceptance pair", "version B");
    write_recipe(dir.path(), "pair", &version_b);
    assert_eq!(staged.recipe_bytes, approved.source.as_bytes());

    // … and pre-spawn verification refuses to launch B under A's approval.
    let err = execution::verify_staged_fresh(dir.path(), &staged).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    assert!(err.message.contains("re-approve"));

    // Materializing before the edit pins A's bytes to the run dir.
    write_recipe(dir.path(), "pair", &two_step());
    let staged =
        execution::stage_approved_snapshot(dir.path(), "pair", &approved.content_hash).unwrap();
    let snapshot_arg = dir
        .path()
        .join(".mentu/snapshots/run-aaa/pair.json")
        .to_string_lossy()
        .into_owned();
    let materialized = execution::materialize_snapshot(
        dir.path(),
        "run-aaa",
        &staged,
        &test_argv(dir.path(), &snapshot_arg),
    )
    .unwrap();
    write_recipe(dir.path(), "pair", &version_b);
    assert_eq!(
        fs::read(&materialized.recipe_path).unwrap(),
        approved.source.as_bytes(),
        "execution content remains A after the file moved to B"
    );
    assert!(
        execution::verify_staged_fresh(dir.path(), &staged).is_err(),
        "launch under B must refuse, never silently execute it"
    );
}

/// Acceptance 4: spaces/Unicode paths and relative files stay usable from
/// the execution snapshot.
#[test]
fn snapshot_keeps_unicode_paths_and_relative_resources() {
    let dir = workspace();
    let id = "equipo compuesto";
    fs::create_dir_all(dir.path().join("recursos")).unwrap();
    fs::write(dir.path().join("recursos/guía.md"), "contenido\n").unwrap();
    let source = two_step().replace(
        r#""prompt_file":"docs/build.md""#,
        r#""prompt_file":"recursos/guía.md""#,
    );
    write_recipe(dir.path(), id, &source);
    let loaded = recipe::load_recipe(dir.path(), id).unwrap();

    let staged = execution::stage_approved_snapshot(dir.path(), id, &loaded.content_hash).unwrap();
    assert_eq!(staged.resources.len(), 1);
    let snapshot_arg = dir
        .path()
        .join(".mentu/snapshots/run-uni/pair.json")
        .to_string_lossy()
        .into_owned();
    let materialized = execution::materialize_snapshot(
        dir.path(),
        "run-uni",
        &staged,
        &test_argv(dir.path(), &snapshot_arg),
    )
    .unwrap();
    let manifest: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(materialized.dir.join("manifest.json")).unwrap())
            .unwrap();
    // Pinned runtime identity rides with the run.
    assert_eq!(manifest["runtime"]["version"], serde_json::json!("0.5.0"));
    assert_eq!(
        manifest["runtime"]["revision"],
        serde_json::json!("c82ccfa0ebbe77d62193e068821ba6e74f87a8d3")
    );
    // The cwd the snapshot preserves is the workspace root.
    assert_eq!(
        manifest["cwd"],
        serde_json::Value::String(dir.path().to_string_lossy().into_owned())
    );
    // The mirrored relative resource is byte-exact under a Unicode path,
    // at the workspace-relative layout.
    let mirrored = materialized.dir.join("recursos/guía.md");
    assert_eq!(fs::read(&mirrored).unwrap(), b"contenido\n");
    execution::verify_staged_fresh(dir.path(), &staged).unwrap();
}

/// Acceptance 5: a supported selection stages with its exact backend/model;
/// an unsupported one refuses without inference — and stages nothing.
#[test]
fn supported_selection_stages_exactly_unsupported_refuses_cleanly() {
    let dir = workspace();
    write_recipe(dir.path(), "pair", &two_step());
    let loaded = recipe::load_recipe(dir.path(), "pair").unwrap();
    let staged =
        execution::stage_approved_snapshot(dir.path(), "pair", &loaded.content_hash).unwrap();
    // Shell-only agent list here is the codex review step with no model:
    // carried exactly, never substituted.
    assert_eq!(staged.steps.len(), 1);
    assert_eq!(staged.steps[0].backend, "codex");
    assert_eq!(staged.steps[0].model, None);

    let bad = serde_json::json!({
        "name": "bad",
        "steps": [{"label": "a", "backend": "opencode", "prompt": "hi"}]
    })
    .to_string();
    write_recipe(dir.path(), "bad", &bad);
    let hash = recipe::current_content_hash(dir.path(), "bad").unwrap();
    let err = execution::stage_approved_snapshot(dir.path(), "bad", &hash).unwrap_err();
    assert_eq!(err.code, execution::BACKEND_UNSUPPORTED_CODE);
    assert!(err.message.contains("opencode"), "{}", err.message);
    assert!(
        !dir.path().join(".mentu/snapshots").exists(),
        "a refused selection stages no snapshot bytes"
    );
}

/// Host verdicts honest by construction: an installed executable rides
/// manual-unverified (never confirmed); an absent one refuses with the
/// missing executable named. Both cases create a bare executable bit only —
/// nothing is ever spawned.
#[test]
fn host_verdicts_follow_executable_presence_without_probing() {
    let _guard = PATH_SERIAL.lock().unwrap();
    let bin_dir = workspace();
    let empty_dir = workspace();
    let codex = bin_dir.path().join("codex");
    fs::write(&codex, "").unwrap();
    fs::set_permissions(&codex, fs::Permissions::from_mode(0o755)).unwrap();

    let recipe = serde_json::json!({
        "name": "x",
        "steps": [{"label": "a", "backend": "codex", "model": "m1"}]
    });
    let recipe_value: serde_json::Value = recipe;

    {
        let _path = PathOverride::set_to(bin_dir.path());
        let steps = execution::validate_agent_execution(&recipe_value).unwrap();
        assert_eq!(steps.len(), 1);
        assert!(
            steps[0]
                .notes
                .iter()
                .any(|n| n.contains("manual-unverified")),
            "present executable degrades to unverified, not confirmed: {:?}",
            steps[0].notes
        );
    }
    {
        let _path = PathOverride::set_to(empty_dir.path());
        let err = execution::validate_agent_execution(&recipe_value).unwrap_err();
        assert_eq!(err.code, execution::BACKEND_UNSUPPORTED_CODE);
        assert!(err.message.contains("codex"), "{}", err.message);
    }
}
