//! Recipe discovery and parsing for one workspace's `.mentu/recipes`
//! directory. MIT Copyright (c) 2026 Lovecast Inc.
//! Tolerant like the fork's `mentu-recipe-files.ts`: a recipe
//! that fails to parse is listed with `issue` set rather than hiding the
//! rest of the catalog, and only `.json` files inside `.mentu/recipes`
//! (containment checked through `realpath`, symlink-safe) are ever read.

use std::fs;
use std::path::{Path, PathBuf};

use drogon_protocol::RpcError;
use drogon_protocol::mentu::{MentuRecipeDetail, MentuRecipeSummary, MentuStep};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::error;

const MAX_RECIPE_SOURCE_BYTES: u64 = 1024 * 1024;
const MAX_STEP_DESCRIPTION_CHARS: usize = 240;

fn recipes_root(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".mentu").join("recipes")
}

fn path_inside(root: &Path, candidate: &Path) -> bool {
    candidate.starts_with(root)
}

/// Resolves `recipe_id` to a real, containment-checked path under
/// `<workspace>/.mentu/recipes`. Refuses absolute references, `..`
/// traversal and anything that canonicalizes outside the recipes root.
pub fn resolve_recipe_path(workspace_root: &Path, recipe_id: &str) -> Result<PathBuf, RpcError> {
    if recipe_id.is_empty() || recipe_id.contains('\0') || recipe_id.starts_with('/') {
        return Err(error::invalid_argument("Invalid Mentu recipe reference."));
    }
    if recipe_id
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err(error::invalid_argument("Invalid Mentu recipe reference."));
    }
    let root = recipes_root(workspace_root);
    let relative = if recipe_id.to_ascii_lowercase().ends_with(".json") {
        recipe_id.to_string()
    } else {
        format!("{recipe_id}.json")
    };
    let candidate = root.join(&relative);
    let workspace_real = fs::canonicalize(workspace_root)
        .map_err(|_| error::not_found("Workspace is unavailable."))?;
    let root_real = fs::canonicalize(&root)
        .map_err(|_| error::not_found("Workspace has no .mentu/recipes directory."))?;
    if !path_inside(&workspace_real, &root_real) {
        return Err(error::invalid_argument(
            "The .mentu/recipes directory is outside the workspace.",
        ));
    }
    let candidate_real =
        fs::canonicalize(&candidate).map_err(|_| error::not_found("Recipe not found."))?;
    if !path_inside(&root_real, &candidate_real) {
        return Err(error::invalid_argument(
            "Recipe reference is outside .mentu/recipes.",
        ));
    }
    if !candidate_real.is_file() {
        return Err(error::not_found("Recipe not found."));
    }
    Ok(candidate_real)
}

/// The recipe id for a real recipe path already known to be inside the
/// recipes root: the path relative to that root, without its `.json`
/// extension, using forward slashes on every platform.
fn recipe_id_for(root_real: &Path, path: &Path) -> String {
    let relative = path.strip_prefix(root_real).unwrap_or(path);
    let mut id = relative.to_string_lossy().replace('\\', "/");
    if let Some(stripped) = id.strip_suffix(".json") {
        id = stripped.to_string();
    }
    id
}

fn collect_recipe_files(
    dir: &Path,
    root_real: &Path,
    out: &mut Vec<PathBuf>,
) -> Result<(), RpcError> {
    let entries = fs::read_dir(dir).map_err(|e| error::io_error(e.to_string()))?;
    let mut names: Vec<_> = entries.filter_map(|entry| entry.ok()).collect();
    names.sort_by_key(|entry| entry.file_name());
    for entry in names {
        let path = entry.path();
        let Ok(real) = fs::canonicalize(&path) else {
            continue;
        };
        if !path_inside(root_real, &real) {
            continue;
        }
        if real.is_dir() {
            collect_recipe_files(&real, root_real, out)?;
        } else if real.is_file()
            && real
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
        {
            out.push(real);
        }
    }
    Ok(())
}

fn parse_recipe_json(source: &str) -> Result<Value, String> {
    serde_json::from_str(source).map_err(|e| format!("Invalid JSON: {e}"))
}

fn recipe_name(value: &Value) -> Option<String> {
    value
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn truncate_description(text: &str) -> String {
    let flattened: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flattened.chars().count() > MAX_STEP_DESCRIPTION_CHARS {
        let truncated: String = flattened.chars().take(MAX_STEP_DESCRIPTION_CHARS).collect();
        format!("{truncated}…")
    } else {
        flattened
    }
}

fn step_description(step: &Value) -> Option<String> {
    if let Some(prompt) = step.get("prompt").and_then(Value::as_str) {
        return Some(truncate_description(prompt));
    }
    if let Some(prompt_file) = step.get("prompt_file").and_then(Value::as_str) {
        return Some(format!("file: {prompt_file}"));
    }
    let commands = step
        .get("verify")
        .and_then(|v| v.get("commands"))
        .and_then(Value::as_array)?;
    let joined = commands
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>()
        .join(" && ");
    (!joined.is_empty()).then(|| truncate_description(&joined))
}

fn parse_steps(recipe: &Value) -> Result<Vec<MentuStep>, String> {
    let default_backend = recipe
        .get("backend")
        .and_then(Value::as_str)
        .unwrap_or("shell");
    let steps = recipe
        .get("steps")
        .and_then(Value::as_array)
        .ok_or_else(|| "Recipe has no \"steps\" array.".to_string())?;
    steps
        .iter()
        .map(|step| {
            let label = step
                .get("label")
                .and_then(Value::as_str)
                .ok_or_else(|| "A step is missing its \"label\".".to_string())?;
            let backend = step
                .get("backend")
                .and_then(Value::as_str)
                .unwrap_or(default_backend)
                .to_string();
            let depends_on = step
                .get("depends_on")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            let timeout_seconds = step.get("timeout").and_then(Value::as_u64);
            let verify_commands = step
                .get("verify")
                .and_then(|verify| verify.get("commands"))
                .and_then(Value::as_array)
                .map(|commands| {
                    commands
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            Ok(MentuStep {
                label: label.to_string(),
                backend,
                description: step_description(step),
                depends_on,
                timeout_seconds,
                verify_commands,
            })
        })
        .collect()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Lists every recipe under `<workspace>/.mentu/recipes`. An absent
/// directory is an empty, valid catalog (a workspace with no recipes yet
/// is not an error); any other read failure propagates.
pub fn discover_recipes(workspace_root: &Path) -> Result<Vec<MentuRecipeSummary>, RpcError> {
    let root = recipes_root(workspace_root);
    let Ok(root_real) = fs::canonicalize(&root) else {
        return Ok(Vec::new());
    };
    let Ok(workspace_real) = fs::canonicalize(workspace_root) else {
        return Ok(Vec::new());
    };
    if !path_inside(&workspace_real, &root_real) {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    collect_recipe_files(&root_real, &root_real, &mut files)?;
    let mut summaries = Vec::with_capacity(files.len());
    for path in files {
        let id = recipe_id_for(&root_real, &path);
        let display_path = path
            .strip_prefix(&workspace_real)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        match fs::read_to_string(&path) {
            Ok(source) => match parse_recipe_json(&source) {
                Ok(value) => summaries.push(MentuRecipeSummary {
                    id,
                    path: display_path,
                    name: recipe_name(&value),
                    valid: recipe_name(&value).is_some() && value.get("steps").is_some(),
                    issue: if value.get("steps").is_some() && recipe_name(&value).is_some() {
                        None
                    } else {
                        Some("Recipe is missing \"name\" or \"steps\".".to_string())
                    },
                }),
                Err(issue) => summaries.push(MentuRecipeSummary {
                    id,
                    path: display_path,
                    name: None,
                    valid: false,
                    issue: Some(issue),
                }),
            },
            Err(e) => summaries.push(MentuRecipeSummary {
                id,
                path: display_path,
                name: None,
                valid: false,
                issue: Some(e.to_string()),
            }),
        }
    }
    Ok(summaries)
}

/// Loads and parses one recipe by id, returning its steps, raw source text
/// (the client-local draft seed) and the sha256 of its exact on-disk bytes.
pub fn load_recipe(workspace_root: &Path, recipe_id: &str) -> Result<MentuRecipeDetail, RpcError> {
    let path = resolve_recipe_path(workspace_root, recipe_id)?;
    let metadata = fs::metadata(&path).map_err(|e| error::io_error(e.to_string()))?;
    if metadata.len() > MAX_RECIPE_SOURCE_BYTES {
        return Err(error::invalid_argument(
            "Recipe source exceeds the 1 MiB safety limit.",
        ));
    }
    let bytes = fs::read(&path).map_err(|e| error::io_error(e.to_string()))?;
    let source = String::from_utf8(bytes.clone())
        .map_err(|_| error::invalid_argument("Recipe source is not valid UTF-8."))?;
    let value = parse_recipe_json(&source).map_err(error::invalid_argument)?;
    let name = recipe_name(&value)
        .ok_or_else(|| error::invalid_argument("Recipe is missing \"name\"."))?;
    let description = value
        .get("description")
        .and_then(Value::as_str)
        .map(str::to_string);
    let steps = parse_steps(&value).map_err(error::invalid_argument)?;
    Ok(MentuRecipeDetail {
        id: recipe_id.to_string(),
        path: path
            .strip_prefix(workspace_root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/"),
        name,
        description,
        content_hash: sha256_hex(&bytes),
        steps,
        source,
    })
}

/// The sha256 of a recipe's exact current on-disk bytes, used to check a
/// stored approval's content hash still matches before a run starts.
pub fn current_content_hash(workspace_root: &Path, recipe_id: &str) -> Result<String, RpcError> {
    let path = resolve_recipe_path(workspace_root, recipe_id)?;
    let bytes = fs::read(&path).map_err(|e| error::io_error(e.to_string()))?;
    Ok(sha256_hex(&bytes))
}

/// Validates a candidate recipe source with the same rules the load path
/// enforces (a JSON object with `name` and a `steps` array of labeled
/// steps), so `mentu.recipe_save` refuses exactly what `mentu.recipe`
/// could never serve back.
fn validate_recipe_value(value: &Value) -> Result<(), RpcError> {
    if !value.is_object() {
        return Err(error::invalid_argument("Recipe must be a JSON object."));
    }
    if recipe_name(value).is_none() {
        return Err(error::invalid_argument("Recipe is missing \"name\"."));
    }
    parse_steps(value)
        .map(|_| ())
        .map_err(error::invalid_argument)?;
    Ok(())
}

/// Writes `content` as the new source of an existing recipe and returns
/// the reloaded detail (with the new content hash). The target resolves
/// through [`resolve_recipe_path`]'s containment and symlink checks, then
/// the write lands atomically: a temp file in the same directory renamed
/// over the recipe, so a crash never leaves half a recipe behind.
pub fn save_recipe(
    workspace_root: &Path,
    recipe_id: &str,
    content: &str,
) -> Result<MentuRecipeDetail, RpcError> {
    if content.len() as u64 > MAX_RECIPE_SOURCE_BYTES {
        return Err(error::invalid_argument(
            "Updated recipe source exceeds the 1 MiB safety limit.",
        ));
    }
    let path = resolve_recipe_path(workspace_root, recipe_id)?;
    let value: Value = serde_json::from_str(content)
        .map_err(|e| error::invalid_argument(format!("Invalid JSON: {e}")))?;
    validate_recipe_value(&value)?;
    let dir = path
        .parent()
        .ok_or_else(|| error::invalid_argument("Recipe reference is outside .mentu/recipes."))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| error::invalid_argument("Invalid Mentu recipe reference."))?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = dir.join(format!(".{file_name}.tmp-{}-{stamp}", std::process::id()));
    if let Err(e) = fs::write(&tmp, content).and_then(|()| fs::rename(&tmp, &path)) {
        let _ = fs::remove_file(&tmp);
        return Err(error::io_error(e.to_string()));
    }
    load_recipe(workspace_root, recipe_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn workspace() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn write_recipe(root: &Path, id: &str, contents: &str) {
        let path = recipes_root(root).join(format!("{id}.json"));
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }

    const VALID: &str = r#"{
        "name": "hello",
        "description": "tiny",
        "steps": [
            {"label": "say-hello", "backend": "shell", "prompt": "echo hi", "timeout": 30}
        ]
    }"#;

    #[test]
    fn discovers_valid_and_invalid_recipes_without_hiding_either() {
        let dir = workspace();
        write_recipe(dir.path(), "hello", VALID);
        write_recipe(dir.path(), "broken", "{not json");
        let recipes = discover_recipes(dir.path()).unwrap();
        assert_eq!(recipes.len(), 2);
        let hello = recipes.iter().find(|r| r.id == "hello").unwrap();
        assert!(hello.valid);
        assert_eq!(hello.name.as_deref(), Some("hello"));
        let broken = recipes.iter().find(|r| r.id == "broken").unwrap();
        assert!(!broken.valid);
        assert!(broken.issue.is_some());
    }

    #[test]
    fn missing_recipes_directory_is_an_empty_catalog() {
        let dir = workspace();
        assert_eq!(discover_recipes(dir.path()).unwrap(), Vec::new());
    }

    #[test]
    fn load_recipe_extracts_steps_and_a_stable_content_hash() {
        let dir = workspace();
        write_recipe(dir.path(), "hello", VALID);
        let detail = load_recipe(dir.path(), "hello").unwrap();
        assert_eq!(detail.name, "hello");
        assert_eq!(detail.steps.len(), 1);
        assert_eq!(detail.steps[0].label, "say-hello");
        assert_eq!(detail.steps[0].backend, "shell");
        assert_eq!(detail.steps[0].timeout_seconds, Some(30));
        assert_eq!(
            detail.content_hash,
            current_content_hash(dir.path(), "hello").unwrap()
        );
        assert_eq!(detail.content_hash.len(), 64);
    }

    #[test]
    fn load_recipe_extracts_verify_commands_and_defaults_to_empty() {
        let dir = workspace();
        write_recipe(
            dir.path(),
            "verified",
            r#"{
            "name": "verified",
            "steps": [
                {"label": "checked", "backend": "shell", "verify": {"commands": ["test -f out.txt"]}},
                {"label": "plain", "backend": "shell"}
            ]
        }"#,
        );
        let detail = load_recipe(dir.path(), "verified").unwrap();
        assert_eq!(
            detail.steps[0].verify_commands,
            vec!["test -f out.txt".to_string()]
        );
        assert!(detail.steps[1].verify_commands.is_empty());
    }

    #[test]
    fn recipe_reference_cannot_escape_the_recipes_directory() {
        let dir = workspace();
        write_recipe(dir.path(), "hello", VALID);
        for bad in ["../secret", "/etc/passwd", "a/../../b"] {
            assert!(resolve_recipe_path(dir.path(), bad).is_err());
        }
    }

    #[test]
    fn save_recipe_rewrites_the_source_and_returns_the_new_hash() {
        let dir = workspace();
        write_recipe(dir.path(), "hello", VALID);
        let before = load_recipe(dir.path(), "hello").unwrap();
        let next = VALID.replace("\"tiny\"", "\"edited\"");
        let detail = save_recipe(dir.path(), "hello", &next).unwrap();
        assert_eq!(detail.name, "hello");
        assert_eq!(detail.source, next);
        assert_ne!(detail.content_hash, before.content_hash);
        assert_eq!(detail.content_hash.len(), 64);
        // The reload path serves the saved bytes back verbatim.
        assert_eq!(load_recipe(dir.path(), "hello").unwrap(), detail);
        // No temp files leak beside the recipe.
        let leftovers: Vec<_> = fs::read_dir(recipes_root(dir.path()))
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn save_recipe_refuses_invalid_content_and_traversal() {
        let dir = workspace();
        write_recipe(dir.path(), "hello", VALID);
        // Missing name.
        assert!(save_recipe(dir.path(), "hello", r#"{"steps": [{"label": "a"}]}"#).is_err());
        // Missing steps.
        assert!(save_recipe(dir.path(), "hello", r#"{"name": "hello"}"#).is_err());
        // Step without a label.
        assert!(
            save_recipe(
                dir.path(),
                "hello",
                r#"{"name": "hello", "steps": [{"backend": "shell"}]}"#,
            )
            .is_err()
        );
        // Not JSON at all.
        assert!(save_recipe(dir.path(), "hello", "{not json").is_err());
        // Traversal never reaches the write.
        assert!(
            save_recipe(dir.path(), "../secret", VALID).is_err(),
            "traversal save must be refused"
        );
        // The refused writes left the recipe untouched.
        assert_eq!(load_recipe(dir.path(), "hello").unwrap().source, VALID);
    }
}
