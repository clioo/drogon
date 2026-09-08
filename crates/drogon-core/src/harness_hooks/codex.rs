//! Codex's per-session `CODEX_HOME` and hook configuration.
//!
//! MIT Copyright (c) 2026 Lovecast Inc.
//!
//! Codex reads hooks from `CODEX_HOME/hooks.json`, unlike Claude's command-line
//! settings file.  A session therefore gets a private home under Drogon's
//! data directory.  The user's real Codex home is a read-only source: selected
//! resources and config are copied into the private home, user hook trust keys
//! are rewritten for the copied `hooks.json`, and Drogon's own hook entries are
//! added there.  No auth, history, or session database files are copied.
//!
//! This is intentionally a filesystem adapter, not a Codex client.  The
//! managed hooks invoke the already-installed `drogon-cli` with the same
//! `session.hook_event` callback used by the other harness adapters.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use drogon_protocol::RpcError;
use serde_json::{Value, json};

use crate::{error, hooks};

/// Codex hook names written by the reference installer.  The names are the
/// PascalCase JSON spelling; trust keys in config.toml use their snake_case
/// labels (see [`trust_event_label`]).
type HookMap = BTreeMap<String, Vec<Value>>;

pub(crate) const CODEX_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "SubagentStart",
    "SubagentStop",
    "Stop",
];

const CODEX_RESOURCE_ENTRIES: &[&str] = &[
    "skills",
    "hooks",
    "plugins",
    "plugin-state",
    "profile-v2",
    "themes",
    "prompts",
    "AGENTS.md",
];
const MANAGED_HOOK_TIMEOUT_SECONDS: u64 = 10;
const MANAGED_HOOK_MARKER: &str = "drogon-codex-hook";
const MANAGED_HOOK_SCRIPT_PATHS: &[&str] = &[
    "agent-hooks/codex-hook.sh",
    "agent-hooks/codex-hook.cmd",
    "agent-hooks/codex-hook.ps1",
];

/// Per-session homes are disposable.  Keeping them alongside the existing
/// harness hook artifacts makes ownership and exit cleanup obvious.
pub(crate) fn homes_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("harness-hooks").join("codex")
}

pub(crate) fn nonce_home_path(data_dir: &Path, nonce: &str) -> PathBuf {
    homes_dir(data_dir).join(nonce)
}

/// The user's source home.  `CODEX_HOME` is honored by the daemon as the
/// source only; the child is always overwritten with a managed path later.
/// Relative/empty values are ignored so a malformed inherited variable cannot
/// make the daemon read from its current working directory.
pub(crate) fn source_home_path() -> PathBuf {
    if let Some(path) = std::env::var_os("CODEX_HOME") {
        let path = PathBuf::from(path);
        if path.is_absolute() {
            return path;
        }
    }
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        // Never fall back to the daemon's current directory: a relative or
        // missing home must not make an ambient `./.codex` authoritative.
        .unwrap_or_else(|| PathBuf::from("/"));
    home.join(".codex")
}

/// Installs the private home.  `install_hooks` is false for a headless run:
/// its process exit is the completion signal and a hook wait event would have
/// no user-facing surface to answer.  User-authored hooks are still mirrored,
/// while stale Drogon entries are removed from the copy.
pub(crate) fn install(
    home: &Path,
    source_home: &Path,
    cli: &str,
    session_id: &str,
    incarnation: &str,
    install_hooks: bool,
) -> Result<(), RpcError> {
    if home == source_home || home.starts_with(source_home) {
        return Err(error::invalid_argument(
            "Codex managed home must not be the user's source home",
        ));
    }
    fs::create_dir_all(home)
        .map_err(|e| error::io_error(format!("cannot create Codex managed home: {e}")))?;

    copy_resources(source_home, home)?;

    let source_hooks_path = source_home.join("hooks.json");
    let managed_hooks_path = home.join("hooks.json");
    let user_hooks = read_hooks_json(&source_hooks_path)?;
    let mirrored_hooks = build_hooks_json(user_hooks, cli, session_id, incarnation, install_hooks);
    write_json_file(&managed_hooks_path, &json!({ "hooks": mirrored_hooks }))?;

    let source_config_path = source_home.join("config.toml");
    if source_config_path.is_file() {
        let raw = fs::read_to_string(&source_config_path)
            .map_err(|e| error::io_error(format!("cannot read Codex config.toml: {e}")))?;
        let raw = raw.strip_prefix('\u{feff}').unwrap_or(&raw);
        let config = mirror_config(
            raw,
            source_home,
            &source_hooks_path,
            &managed_hooks_path,
            install_hooks,
        );
        write_text_file(&home.join("config.toml"), &config)?;
    }
    Ok(())
}

fn copy_resources(source_home: &Path, managed_home: &Path) -> Result<(), RpcError> {
    for entry_name in CODEX_RESOURCE_ENTRIES {
        let source = source_home.join(entry_name);
        let target = managed_home.join(entry_name);
        if !path_exists(&source) {
            continue;
        }
        copy_path(&source, &target, 0)?;
    }
    Ok(())
}

/// `metadata` follows links and therefore cannot distinguish a missing entry
/// from a dangling link.  `symlink_metadata` is used for the copy boundary so
/// a user resource is never accidentally treated as a regular directory.
fn path_exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

fn copy_path(source: &Path, target: &Path, depth: usize) -> Result<(), RpcError> {
    if depth > 32 {
        return Err(error::io_error(format!(
            "Codex resource symlink nesting is too deep: {}",
            source.display()
        )));
    }
    let metadata = fs::symlink_metadata(source)
        .map_err(|e| error::io_error(format!("cannot inspect Codex resource: {e}")))?;
    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        // Copy the link target's contents, not a link into the real home.  A
        // relative link is resolved relative to its source parent, preserving
        // the meaning of dotfile-manager links while keeping the managed home
        // self-contained.
        let link = fs::read_link(source)
            .map_err(|e| error::io_error(format!("cannot read Codex resource link: {e}")))?;
        let resolved = if link.is_absolute() {
            link
        } else {
            source.parent().unwrap_or_else(|| Path::new(".")).join(link)
        };
        return copy_path(&resolved, target, depth + 1);
    }
    if file_type.is_dir() {
        fs::create_dir_all(target)
            .map_err(|e| error::io_error(format!("cannot create Codex resource directory: {e}")))?;
        let entries = fs::read_dir(source)
            .map_err(|e| error::io_error(format!("cannot read Codex resource directory: {e}")))?;
        for entry in entries {
            let entry = entry
                .map_err(|e| error::io_error(format!("cannot enumerate Codex resource: {e}")))?;
            copy_path(&entry.path(), &target.join(entry.file_name()), depth + 1)?;
        }
        return Ok(());
    }
    if !file_type.is_file() {
        // Codex resources are files/directories.  Ignore sockets, devices and
        // FIFOs rather than making launch depend on a special file.
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| error::io_error(format!("cannot create Codex resource parent: {e}")))?;
    }
    fs::copy(source, target)
        .map_err(|e| error::io_error(format!("cannot copy Codex resource: {e}")))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(
            target,
            fs::Permissions::from_mode(metadata.permissions().mode()),
        )
        .map_err(|e| error::io_error(format!("cannot preserve Codex resource mode: {e}")))?;
    }
    Ok(())
}

fn read_hooks_json(path: &Path) -> Result<HookMap, RpcError> {
    if !path.is_file() {
        return Ok(HookMap::new());
    }
    let raw = fs::read_to_string(path)
        .map_err(|e| error::io_error(format!("cannot read Codex hooks.json: {e}")))?;
    let value: Value = serde_json::from_str(raw.trim_start_matches('\u{feff}'))
        .map_err(|e| error::invalid_argument(format!("invalid Codex hooks.json: {e}")))?;
    let Some(root) = value.as_object() else {
        return Err(error::invalid_argument(
            "Codex hooks.json must contain an object",
        ));
    };
    let Some(hooks) = root.get("hooks") else {
        return Ok(HookMap::new());
    };
    let Some(hooks) = hooks.as_object() else {
        return Err(error::invalid_argument(
            "Codex hooks.json hooks must contain an object",
        ));
    };
    let mut result = HookMap::new();
    for (event, definitions) in hooks {
        let Some(definitions) = definitions.as_array() else {
            // Preserve no malformed event value: Codex itself rejects it, and
            // the managed file must remain a valid hooks object.
            continue;
        };
        result.insert(event.clone(), definitions.clone());
    }
    Ok(result)
}

fn build_hooks_json(
    mut user_hooks: HookMap,
    cli: &str,
    session_id: &str,
    incarnation: &str,
    install_hooks: bool,
) -> HookMap {
    // Sweep an older Drogon install before adding the current material.  This
    // is filename/command based rather than path based so an upgraded data
    // directory cannot accumulate stale per-session commands.
    for definitions in user_hooks.values_mut() {
        *definitions = remove_managed_definitions(std::mem::take(definitions));
    }
    if install_hooks {
        for event in CODEX_EVENTS {
            let definitions = user_hooks.remove(*event).unwrap_or_default();
            let command = hooks::hook_command(cli, session_id, incarnation, event);
            let managed = json!({
                "hooks": [{
                    "type": "command",
                    "command": command,
                    "timeout": MANAGED_HOOK_TIMEOUT_SECONDS
                }]
            });
            let mut next = Vec::with_capacity(definitions.len() + 1);
            next.push(managed);
            next.extend(definitions);
            user_hooks.insert((*event).to_string(), next);
        }
    }
    user_hooks.retain(|_, definitions| !definitions.is_empty());
    user_hooks
}

fn remove_managed_definitions(definitions: Vec<Value>) -> Vec<Value> {
    definitions
        .into_iter()
        .filter_map(|definition| {
            let Some(mut object) = definition.as_object().cloned() else {
                return Some(definition);
            };
            let has_managed_direct = ["command", "bash", "powershell"].iter().any(|key| {
                object
                    .get(*key)
                    .and_then(Value::as_str)
                    .is_some_and(is_managed_command)
            });
            let has_managed_nested =
                object
                    .get("hooks")
                    .and_then(Value::as_array)
                    .is_some_and(|entries| {
                        entries.iter().any(|entry| {
                            entry
                                .get("command")
                                .and_then(Value::as_str)
                                .is_some_and(is_managed_command)
                                || entry
                                    .get("args")
                                    .and_then(Value::as_array)
                                    .is_some_and(|args| {
                                        args.iter()
                                            .filter_map(Value::as_str)
                                            .any(is_managed_command)
                                    })
                        })
                    });
            // Preserve user definitions that do not look like command hooks;
            // Codex may add schema fields that this adapter does not know.
            if !has_managed_direct && !has_managed_nested {
                return Some(Value::Object(object));
            }
            for key in ["command", "bash", "powershell"] {
                if object
                    .get(key)
                    .and_then(Value::as_str)
                    .is_some_and(is_managed_command)
                {
                    object.remove(key);
                }
            }
            if let Some(nested) = object.get_mut("hooks")
                && let Some(entries) = nested.as_array_mut()
            {
                entries.retain(|entry| {
                    !(entry
                        .get("command")
                        .and_then(Value::as_str)
                        .is_some_and(is_managed_command)
                        || entry
                            .get("args")
                            .and_then(Value::as_array)
                            .is_some_and(|args| {
                                args.iter()
                                    .filter_map(Value::as_str)
                                    .any(is_managed_command)
                            }))
                });
                if entries.is_empty() {
                    object.remove("hooks");
                }
            }
            let has_direct = ["command", "bash", "powershell"]
                .iter()
                .any(|key| object.get(*key).and_then(Value::as_str).is_some());
            let has_nested = object
                .get("hooks")
                .and_then(Value::as_array)
                .is_some_and(|entries| !entries.is_empty());
            if has_direct || has_nested {
                Some(Value::Object(object))
            } else {
                None
            }
        })
        .collect()
}

fn is_managed_command(command: &str) -> bool {
    let normalized = command.replace('\\', "/");
    command.contains(MANAGED_HOOK_MARKER)
        || MANAGED_HOOK_SCRIPT_PATHS
            .iter()
            .any(|path| normalized.contains(path))
        || (command.contains("drogon-cli") && command.contains("hook-event"))
}

fn write_json_file(path: &Path, value: &Value) -> Result<(), RpcError> {
    let payload = serde_json::to_string_pretty(value)
        .map_err(|e| error::internal_error(format!("cannot encode Codex hooks.json: {e}")))?;
    write_text_file(path, &format!("{payload}\n"))
}

fn write_text_file(path: &Path, contents: &str) -> Result<(), RpcError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| error::io_error(format!("cannot create Codex config parent: {e}")))?;
    }
    fs::write(path, contents)
        .map_err(|e| error::io_error(format!("cannot write Codex managed config: {e}")))
}

/// Mirrors config.toml while changing the two pieces that are invalid after
/// relocation: relative asset paths continue to point at the user's source
/// home, and `[hooks.state]` keys point at the managed hooks.json.  Inserting
/// the managed hook at definition index 0 shifts user trust group indexes by
/// one for the eight managed events.
fn mirror_config(
    raw: &str,
    source_home: &Path,
    source_hooks_path: &Path,
    managed_hooks_path: &Path,
    install_hooks: bool,
) -> String {
    let rewritten = rewrite_relative_paths(raw, source_home);
    remap_trust_paths(
        &normalize_deprecated_hook_flag(&rewritten),
        source_hooks_path,
        managed_hooks_path,
        install_hooks,
    )
}

fn normalize_deprecated_hook_flag(raw: &str) -> String {
    let mut lines: Vec<String> = raw.split('\n').map(str::to_string).collect();
    let mut current = String::new();
    let mut seen_hooks = false;
    let mut scan = TomlScanState::default();
    for line in &mut lines {
        if scan.is_structural() {
            if let Some(header) = toml_header(line) {
                current = header;
                seen_hooks = false;
            }
            if current == "features" && toml_key(line) == Some("hooks") {
                if seen_hooks {
                    // A duplicate must not survive when codex_hooks appeared
                    // first and was renamed to hooks above.
                    *line = String::new();
                } else {
                    seen_hooks = true;
                }
            }
            if current == "features" && toml_key(line) == Some("codex_hooks") {
                if seen_hooks {
                    *line = String::new();
                } else if let Some(equal) = line.find('=') {
                    let key_start = line.find("codex_hooks").unwrap_or(0);
                    let key_end = key_start + "codex_hooks".len();
                    *line = format!(
                        "{}hooks{}{}",
                        &line[..key_start],
                        &line[key_end..equal],
                        &line[equal..]
                    );
                    seen_hooks = true;
                }
            }
        }
        scan = update_toml_scan_state(scan, line);
    }
    lines.join("\n")
}

fn rewrite_relative_paths(raw: &str, source_home: &Path) -> String {
    const EXACT_KEYS: &[&str] = &[
        "debug.config_lockfile.export_dir",
        "debug.config_lockfile.load_path",
        "experimental_compact_prompt_file",
        "experimental_instructions_file",
        "log_dir",
        "model_catalog_json",
        "model_instructions_file",
        "skills.config.path",
        "sqlite_home",
    ];
    let mut table = String::new();
    let mut scan = TomlScanState::default();
    let mut lines: Vec<String> = raw.split('\n').map(str::to_string).collect();
    for line in &mut lines {
        // A nested array item can begin with `[` too, but it is not a TOML
        // table header. Only inspect headers and assignments outside a
        // multiline array or string; this keeps a value such as
        // `notify = [\n  [..]\n]` from changing the table path for following
        // settings.
        if scan.is_structural() {
            if let Some(header) = toml_header(line) {
                table = header;
                scan = update_toml_scan_state(scan, line);
                continue;
            }
            if let Some((key, start, end, _quote, value)) = toml_string_assignment(line) {
                let key = normalize_toml_path_expression(&key);
                let table = normalize_toml_path_expression(&table);
                let full_key = if table.is_empty() {
                    key
                } else {
                    format!("{table}.{key}")
                };
                let path_key = EXACT_KEYS.contains(&full_key.as_str())
                    || full_key.starts_with("agents.") && full_key.ends_with(".config_file")
                    || full_key.starts_with("model_providers.") && full_key.ends_with(".auth.cwd")
                    || full_key.starts_with("profiles.")
                        && (full_key.ends_with(".model_catalog_json")
                            || full_key.ends_with(".model_instructions_file")
                            || full_key.ends_with(".experimental_compact_prompt_file"));
                if path_key && is_relative_config_path(&value) {
                    let absolute = join_source_path(source_home, &value);
                    let replacement = quote_toml_path(&absolute);
                    *line = format!("{}{}{}", &line[..start], replacement, &line[end..]);
                }
            }
        }
        scan = update_toml_scan_state(scan, line);
        continue;
    }
    lines.join("\n")
}

#[derive(Clone, Copy, Default)]
struct TomlScanState {
    multiline: Option<TomlMultilineString>,
    array_depth: usize,
}

#[derive(Clone, Copy)]
enum TomlMultilineString {
    Basic,
    Literal,
}

impl TomlScanState {
    fn is_structural(self) -> bool {
        self.multiline.is_none() && self.array_depth == 0
    }
}

fn update_toml_scan_state(mut state: TomlScanState, line: &str) -> TomlScanState {
    let mut index = 0usize;
    while index < line.len() {
        if let Some(multiline) = state.multiline {
            let delimiter = match multiline {
                TomlMultilineString::Basic => "\"\"\"",
                TomlMultilineString::Literal => "'''",
            };
            if line[index..].starts_with(delimiter) {
                state.multiline = None;
                index += delimiter.len();
                continue;
            }
            if matches!(multiline, TomlMultilineString::Basic) && line[index..].starts_with('\\') {
                index += line[index..]
                    .chars()
                    .next()
                    .map(char::len_utf8)
                    .unwrap_or(1);
                if index < line.len() {
                    index += line[index..]
                        .chars()
                        .next()
                        .map(char::len_utf8)
                        .unwrap_or(1);
                }
                continue;
            }
            index += line[index..]
                .chars()
                .next()
                .map(char::len_utf8)
                .unwrap_or(1);
            continue;
        }
        if line[index..].starts_with('#') {
            break;
        }
        if line[index..].starts_with("\"\"\"") {
            state.multiline = Some(TomlMultilineString::Basic);
            index += 3;
            continue;
        }
        if line[index..].starts_with("'''") {
            state.multiline = Some(TomlMultilineString::Literal);
            index += 3;
            continue;
        }
        let character = line[index..].chars().next().unwrap_or_default();
        match character {
            '"' => index = skip_toml_string(line, index + 1, '"'),
            '\'' => index = skip_toml_string(line, index + 1, '\''),
            '[' => {
                state.array_depth += 1;
                index += 1;
            }
            ']' => {
                state.array_depth = state.array_depth.saturating_sub(1);
                index += 1;
            }
            _ => index += character.len_utf8(),
        }
    }
    state
}

fn skip_toml_string(line: &str, mut index: usize, quote: char) -> usize {
    while index < line.len() {
        let character = line[index..].chars().next().unwrap_or_default();
        index += character.len_utf8();
        if quote == '"' && character == '\\' && index < line.len() {
            index += line[index..]
                .chars()
                .next()
                .map(char::len_utf8)
                .unwrap_or(1);
        } else if character == quote {
            break;
        }
    }
    index
}

fn join_source_path(source_home: &Path, relative: &str) -> String {
    let joined = source_home.join(relative).to_string_lossy().into_owned();
    // `Path::join` preserves dot segments. Codex's native path library
    // normalizes them while resolving a relative config value, so normalize
    // the copied spelling too and keep Windows drive/UNC semantics when the
    // source home is not POSIX-shaped.
    if source_home.to_string_lossy().starts_with('/') {
        normalize_posix_path(&joined)
    } else {
        normalize_windows_path(&joined)
    }
}

fn is_relative_config_path(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && !value.starts_with(['~', '$', '%', '/', '\\'])
        && !is_windows_absolute(value)
        && !has_uri_scheme(value)
}

fn has_uri_scheme(value: &str) -> bool {
    let Some(colon) = value.find(':') else {
        return false;
    };
    colon > 0
        && value[..colon]
            .chars()
            .enumerate()
            .all(|(index, character)| {
                character.is_ascii_alphabetic()
                    || index > 0 && (character.is_ascii_alphanumeric() || "+.-".contains(character))
            })
}

fn is_windows_absolute(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

fn toml_header(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.starts_with('#') || !trimmed.starts_with('[') {
        return None;
    }
    let end = trimmed.find(']')?;
    let header = trimmed[1..end].trim();
    if let Some(stripped) = header.strip_prefix('[') {
        Some(stripped.trim_end_matches(']').trim().to_string())
    } else {
        Some(header.to_string())
    }
}

fn toml_key(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    let equal = trimmed.find('=')?;
    let key = trimmed[..equal].trim();
    (!key.is_empty() && !key.starts_with('#')).then_some(key)
}

fn normalize_toml_path_expression(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn toml_string_assignment(line: &str) -> Option<(String, usize, usize, char, String)> {
    let equal = line.find('=')?;
    let key = line[..equal].trim();
    if key.is_empty() || key.starts_with('#') {
        return None;
    }
    let value_start = equal + 1 + line[equal + 1..].len() - line[equal + 1..].trim_start().len();
    let rest = &line[value_start..];
    let quote = rest.chars().next()?;
    if quote != '\'' && quote != '"' {
        return None;
    }
    // Triple-quoted TOML strings may span lines. This small line-preserving
    // adapter deliberately leaves them untouched rather than mistaking the
    // first pair of quotes for the complete path value.
    let triple = match quote {
        '\'' => "'''",
        '"' => "\"\"\"",
        _ => unreachable!(),
    };
    if rest.starts_with(triple) {
        return None;
    }
    let mut escaped = false;
    for (offset, character) in rest.char_indices().skip(1) {
        if quote == '"' && character == '\\' && !escaped {
            escaped = true;
            continue;
        }
        if character == quote && !escaped {
            let end = value_start + offset + character.len_utf8();
            let raw_value = &rest[1..offset];
            let value = if quote == '"' {
                decode_toml_basic(raw_value)?
            } else {
                raw_value.to_string()
            };
            return Some((key.to_string(), value_start, end, quote, value));
        }
        escaped = false;
    }
    None
}

fn decode_toml_basic(value: &str) -> Option<String> {
    let mut result = String::new();
    let mut chars = value.chars();
    while let Some(character) = chars.next() {
        if character != '\\' {
            result.push(character);
            continue;
        }
        let escaped = chars.next()?;
        let decoded = match escaped {
            'b' => '\u{0008}',
            't' => '\t',
            'n' => '\n',
            'f' => '\u{000c}',
            'r' => '\r',
            '"' => '"',
            '\\' => '\\',
            'u' => decode_toml_codepoint(&mut chars, 4)?,
            'U' => decode_toml_codepoint(&mut chars, 8)?,
            _ => return None,
        };
        result.push(decoded);
    }
    Some(result)
}

fn decode_toml_codepoint(chars: &mut std::str::Chars<'_>, digits: usize) -> Option<char> {
    let mut value = 0u32;
    for _ in 0..digits {
        value = value
            .checked_mul(16)?
            .checked_add(chars.next()?.to_digit(16)?)?;
    }
    char::from_u32(value)
}

fn quote_toml_path(value: &str) -> String {
    if value.chars().all(|character| {
        character != '\'' && (character == '\t' || !character.is_control()) && character != '\u{7f}'
    }) {
        format!("'{value}'")
    } else {
        format!("\"{}\"", escape_toml_basic(value))
    }
}

fn escape_toml_basic(value: &str) -> String {
    let mut escaped = String::new();
    for character in value.chars() {
        match character {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '\u{0008}' => escaped.push_str("\\u0008"),
            '\t' => escaped.push_str("\\t"),
            '\n' => escaped.push_str("\\n"),
            '\u{000c}' => escaped.push_str("\\u000C"),
            '\r' => escaped.push_str("\\r"),
            character if character.is_control() || character == '\u{7f}' => {
                let codepoint = character as u32;
                if codepoint <= 0xffff {
                    escaped.push_str(&format!("\\u{codepoint:04X}"));
                } else {
                    escaped.push_str(&format!("\\U{codepoint:08X}"));
                }
            }
            character => escaped.push(character),
        }
    }
    escaped
}

fn remap_trust_paths(
    raw: &str,
    source_hooks_path: &Path,
    managed_hooks_path: &Path,
    install_hooks: bool,
) -> String {
    let source = source_hooks_path.to_string_lossy();
    let managed = managed_hooks_path.to_string_lossy();
    let mut scan = TomlScanState::default();
    let mut lines: Vec<String> = raw.split('\n').map(str::to_string).collect();
    for line in &mut lines {
        if !scan.is_structural() {
            scan = update_toml_scan_state(scan, line);
            continue;
        }
        let Some((open, close, quote, key)) = trust_header_parts(line) else {
            scan = update_toml_scan_state(scan, line);
            continue;
        };
        let Some((path, event, group, handler)) = split_trust_key(&key) else {
            scan = update_toml_scan_state(scan, line);
            continue;
        };
        if !same_path(&path, &source) {
            scan = update_toml_scan_state(scan, line);
            continue;
        }
        let next_group = if install_hooks && is_managed_event_label(&event) {
            group.saturating_add(1)
        } else {
            group
        };
        let next = format!("{managed}:{event}:{next_group}:{handler}");
        let keep_literal = quote == '\'' && !next.contains('\'');
        let encoded = if keep_literal {
            next.clone()
        } else {
            escape_toml_basic(&next)
        };
        let next_quote = if keep_literal { '\'' } else { '"' };
        *line = format!(
            "{}{}{}{}{}",
            &line[..open],
            next_quote,
            encoded,
            next_quote,
            &line[close..]
        );
        scan = update_toml_scan_state(scan, line);
    }
    lines.join("\n")
}

fn trust_header_parts(line: &str) -> Option<(usize, usize, char, String)> {
    let prefix = "[hooks.state.";
    let trimmed = line.trim_start();
    let offset = line.len() - trimmed.len();
    let start = offset + prefix.len();
    let remainder = trimmed.strip_prefix(prefix)?;
    let quote = remainder.chars().next()?;
    if quote != '\'' && quote != '"' {
        return None;
    }
    let mut escaped = false;
    for (offset, character) in line[start + quote.len_utf8()..].char_indices() {
        if quote == '"' && character == '\\' && !escaped {
            escaped = true;
            continue;
        }
        if character == quote && !escaped {
            let close = start + quote.len_utf8() + offset + character.len_utf8();
            let key_end = start + quote.len_utf8() + offset;
            let raw_key = &line[start + quote.len_utf8()..key_end];
            let key = if quote == '"' {
                decode_toml_basic(raw_key)?
            } else {
                raw_key.to_string()
            };
            if !line[close..].trim_start().starts_with(']') {
                return None;
            }
            return Some((start, close, quote, key));
        }
        escaped = false;
    }
    None
}

fn split_trust_key(key: &str) -> Option<(String, String, usize, usize)> {
    let mut parts = key.rsplitn(4, ':');
    let handler = parts.next()?.parse().ok()?;
    let group = parts.next()?.parse().ok()?;
    let event = parts.next()?.to_string();
    let path = parts.next()?.to_string();
    if path.is_empty() || event.is_empty() {
        return None;
    }
    Some((path, event, group, handler))
}

fn same_path(left: &str, right: &str) -> bool {
    if is_windows_path(left) || is_windows_path(right) {
        return normalize_windows_path(left).eq_ignore_ascii_case(&normalize_windows_path(right));
    }
    normalize_posix_path(left) == normalize_posix_path(right)
}

fn is_windows_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
        || path.starts_with("\\\\")
}

fn normalize_posix_path(path: &str) -> String {
    let absolute = path.starts_with('/');
    let mut components = Vec::new();
    for component in path.split('/') {
        match component {
            "" | "." => {}
            ".." if components.last().is_some_and(|last| *last != "..") => {
                components.pop();
            }
            ".." if !absolute => components.push(".."),
            ".." => {}
            component => components.push(component),
        }
    }
    let joined = components.join("/");
    if absolute {
        if joined.is_empty() {
            "/".to_string()
        } else {
            format!("/{joined}")
        }
    } else {
        joined
    }
}

fn normalize_windows_path(path: &str) -> String {
    let mut value = path.replace('/', "\\");
    for prefix in ["\\\\?\\UNC\\", "\\\\.\\UNC\\"] {
        if value.len() >= prefix.len() && value[..prefix.len()].eq_ignore_ascii_case(prefix) {
            value = format!("\\\\{}", &value[prefix.len()..]);
            break;
        }
    }
    for prefix in ["\\\\?\\", "\\\\.\\"] {
        if value.len() >= prefix.len() && value[..prefix.len()].eq_ignore_ascii_case(prefix) {
            value = value[prefix.len()..].to_string();
            break;
        }
    }
    let is_unc = value.starts_with("\\\\");
    let drive = if value.len() >= 2 && value.as_bytes()[1] == b':' {
        Some(value[..2].to_string())
    } else {
        None
    };
    let absolute = is_unc
        || drive
            .as_ref()
            .is_some_and(|_| value.as_bytes().get(2) == Some(&b'\\'));
    let start = if is_unc || drive.is_some() {
        2
    } else if value.starts_with('\\') {
        1
    } else {
        0
    };
    let mut components = Vec::new();
    for component in value[start..].split('\\') {
        match component {
            "" | "." => {}
            ".." if components.last().is_some_and(|last| *last != "..") => {
                components.pop();
            }
            ".." if !absolute => components.push(".."),
            ".." => {}
            component => components.push(component),
        }
    }
    let joined = components.join("\\");
    if is_unc {
        if joined.is_empty() {
            "\\\\".to_string()
        } else {
            format!("\\\\{joined}")
        }
    } else if let Some(drive) = drive {
        if absolute {
            if joined.is_empty() {
                format!("{drive}\\")
            } else {
                format!("{drive}\\{joined}")
            }
        } else if joined.is_empty() {
            drive
        } else {
            format!("{drive}{joined}")
        }
    } else if value.starts_with('\\') {
        format!("\\{joined}")
    } else {
        joined
    }
}

fn is_managed_event_label(label: &str) -> bool {
    CODEX_EVENTS
        .iter()
        .any(|event| trust_event_label(event) == Some(label))
}

fn trust_event_label(event: &str) -> Option<&'static str> {
    match event {
        "SessionStart" => Some("session_start"),
        "UserPromptSubmit" => Some("user_prompt_submit"),
        "PreToolUse" => Some("pre_tool_use"),
        "PermissionRequest" => Some("permission_request"),
        "PostToolUse" => Some("post_tool_use"),
        "SubagentStart" => Some("subagent_start"),
        "SubagentStop" => Some("subagent_stop"),
        "Stop" => Some("stop"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_home_is_nonce_scoped_under_data_dir() {
        let dir = tempfile::tempdir().unwrap();
        let path = nonce_home_path(dir.path(), "nonce-1");
        assert_eq!(path, dir.path().join("harness-hooks/codex/nonce-1"));
        assert!(!path.starts_with(source_home_path()));
    }

    #[test]
    fn hook_events_match_codex_json_and_trust_spellings() {
        assert_eq!(CODEX_EVENTS.len(), 8);
        assert_eq!(
            trust_event_label("PermissionRequest"),
            Some("permission_request")
        );
        assert_eq!(trust_event_label("Stop"), Some("stop"));
        assert_eq!(trust_event_label("unknown"), None);
    }

    #[test]
    fn install_copies_resources_and_config_without_auth_or_history() {
        let source = tempfile::tempdir().unwrap();
        let managed = tempfile::tempdir().unwrap();
        fs::create_dir_all(source.path().join("skills/review")).unwrap();
        fs::write(source.path().join("skills/review/SKILL.md"), "skill\n").unwrap();
        fs::write(source.path().join("auth.json"), "secret\n").unwrap();
        fs::write(source.path().join("history.jsonl"), "history\n").unwrap();
        fs::write(source.path().join("config.toml"), "model = \"test\"\n").unwrap();
        fs::write(source.path().join("hooks.json"), r#"{"hooks":{}}"#).unwrap();

        install(
            managed.path(),
            source.path(),
            "/opt/drogon/bin/drogon-cli",
            "session-1",
            "inc-1",
            true,
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(managed.path().join("skills/review/SKILL.md")).unwrap(),
            "skill\n"
        );
        assert!(!managed.path().join("auth.json").exists());
        assert!(!managed.path().join("history.jsonl").exists());
        let hooks: Value =
            serde_json::from_str(&fs::read_to_string(managed.path().join("hooks.json")).unwrap())
                .unwrap();
        assert_eq!(hooks["hooks"]["Stop"].as_array().unwrap().len(), 1);
        let command = hooks["hooks"]["Stop"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        assert!(command.contains("internal hook-event"));
        assert!(command.contains("session-1"));
    }

    #[test]
    fn managed_config_remaps_trust_path_and_shifts_user_group() {
        let source = Path::new("/home/user/.codex/hooks.json");
        let managed = Path::new("/data/hooks/codex/hooks.json");
        let raw = concat!(
            "model = \"test\"\n",
            "[hooks.state.\"/home/user/.codex/hooks.json:stop:2:0\"]\n",
            "enabled = true\n",
            "trusted_hash = \"sha256:user\"\n"
        );
        let result = remap_trust_paths(raw, source, managed, true);
        assert!(result.contains("[hooks.state.\"/data/hooks/codex/hooks.json:stop:3:0\"]"));
        assert!(result.contains("trusted_hash = \"sha256:user\""));
        assert!(!result.contains("/home/user/.codex/hooks.json"));
    }

    #[test]
    fn trust_like_text_in_comments_and_values_is_not_rewritten() {
        let source = Path::new("/home/user/.codex/hooks.json");
        let managed = Path::new("/data/hooks/codex/hooks.json");
        let raw = concat!(
            "# [hooks.state.\"/home/user/.codex/hooks.json:stop:0:0\"]\n",
            "note = \"[hooks.state./home/user/.codex/hooks.json:stop:0:0]\"\n",
            "[hooks.state.\"/home/user/.codex/hooks.json:stop:0:0\"]\n",
            "enabled = true\n"
        );
        let result = remap_trust_paths(raw, source, managed, true);
        assert!(result.contains("# [hooks.state.\"/home/user/.codex/hooks.json:stop:0:0\"]"));
        assert!(result.contains("note = \"[hooks.state./home/user/.codex/hooks.json:stop:0:0]\""));
        assert!(result.contains("[hooks.state.\"/data/hooks/codex/hooks.json:stop:1:0\"]"));
    }

    #[test]
    fn user_hooks_survive_and_managed_entries_are_replaced() {
        let mut hooks = HookMap::new();
        hooks.insert(
            "Stop".to_string(),
            vec![
                json!({"hooks":[{"type":"command","command":"/usr/bin/my-hook"}]}),
                json!({"hooks":[{"type":"command","command":"/home/user/.orca/agent-hooks/codex-hook.sh"}]}),
            ],
        );
        let result = build_hooks_json(hooks, "drogon-cli", "s", "i", true);
        assert_eq!(result["Stop"].len(), 2);
        assert_eq!(result["Stop"][1]["hooks"][0]["command"], "/usr/bin/my-hook");
        assert!(
            result["Stop"][0]["hooks"][0]["command"]
                .as_str()
                .unwrap()
                .contains("--event Stop")
        );
    }

    #[test]
    fn relative_config_paths_stay_reachable_from_the_real_source_home() {
        let raw = "model_instructions_file = \"instructions.md\"\n";
        let result = rewrite_relative_paths(raw, Path::new("/home/user/.codex"));
        assert!(result.contains("'/home/user/.codex/instructions.md'"));
    }

    #[test]
    fn relative_config_paths_normalize_dot_segments() {
        let raw = "model_instructions_file = \"../instructions.md\"\n";
        let result = rewrite_relative_paths(raw, Path::new("/home/user/.codex"));
        assert!(result.contains("'/home/user/instructions.md'"));
    }

    #[test]
    fn config_rewrites_preserve_crlf_line_endings() {
        let raw = "model_instructions_file = \"instructions.md\"\r\nmodel = \"test\"\r\n";
        let result = rewrite_relative_paths(raw, Path::new("/home/user/.codex"));
        assert!(result.ends_with("model = \"test\"\r\n"));
        assert_eq!(result.matches('\r').count(), 2);
    }

    #[test]
    fn spaced_dotted_keys_still_match_path_settings() {
        let raw = concat!(
            "[model_providers . local . auth]\n",
            "cwd = \"credentials\"\n"
        );
        let result = rewrite_relative_paths(raw, Path::new("/home/user/.codex"));
        assert!(result.contains("cwd = '/home/user/.codex/credentials'"));
    }

    #[test]
    fn triple_quoted_values_are_left_untouched_and_do_not_hide_later_paths() {
        let raw = concat!(
            "model_instructions_file = \"\"\"\n",
            "a [fake.header]\n",
            "\"\"\"\n",
            "log_dir = \"logs\"\n"
        );
        let result = rewrite_relative_paths(raw, Path::new("/home/user/.codex"));
        assert!(result.contains("model_instructions_file = \"\"\"\n"));
        assert!(result.contains("a [fake.header]\n\"\"\"\n"));
        assert!(result.contains("log_dir = '/home/user/.codex/logs'\n"));
    }

    #[test]
    fn multiline_arrays_do_not_change_the_following_table_path() {
        let raw = concat!(
            "notify = [\n",
            "  [\"custom\", 1]\n",
            "]\n",
            "log_dir = \"logs\"\n"
        );
        let result = rewrite_relative_paths(raw, Path::new("/home/user/.codex"));
        assert!(result.contains("log_dir = '/home/user/.codex/logs'"));
        assert!(result.contains("  [\"custom\", 1]"));
    }

    #[test]
    fn stale_commands_are_removed_without_dropping_unknown_user_definitions() {
        let mut hooks = HookMap::new();
        hooks.insert(
            "Stop".to_string(),
            vec![
                json!({"matcher": "never", "future": true}),
                json!({
                    "hooks": [
                        {"type": "command", "args": ["/old/drogon-codex-hook.sh"]},
                        {"type": "command", "command": "/usr/bin/user-hook"}
                    ]
                }),
            ],
        );
        let result = build_hooks_json(hooks, "drogon-cli", "s", "i", false);
        assert_eq!(result["Stop"].len(), 2);
        assert_eq!(result["Stop"][0]["future"], true);
        assert_eq!(
            result["Stop"][1]["hooks"][0]["command"],
            "/usr/bin/user-hook"
        );
    }

    #[test]
    fn deprecated_codex_hook_flag_is_renamed_once_in_either_order() {
        for raw in [
            "[features]\ncodex_hooks = true\nhooks = false\n",
            "[features]\nhooks = false\ncodex_hooks = true\n",
        ] {
            let result = normalize_deprecated_hook_flag(raw);
            assert_eq!(
                result.matches("hooks =").count(),
                1,
                "{raw:?} normalized to {result:?}"
            );
            assert!(!result.contains("codex_hooks"));
        }
    }
}
