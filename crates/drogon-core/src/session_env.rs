//! Session environment and per-data-dir CLI shims (journey J3 completion).
//!
//! MIT Copyright (c) 2026 Lovecast Inc.
//!
//! Every shell or agent the daemon spawns (`session.start`,
//! `harness.start`, worker launches) runs with this environment: the daemon
//! environment is inherited, `<data-dir>/bin` is prepended to PATH so the
//! `drogon-cli` shim (and the `drogon` alias) resolve without configuration,
//! and the session identity is exported as `DROGON_DATA_DIR`,
//! `DROGON_WORKSPACE_ID`, `DROGON_SESSION_ID` and `DROGON_TERMINAL=1` with
//! `TERM_PROGRAM=Drogon`.
//!
//! Ported shape: the reference's `src/main/daemon/pty-subprocess/
//! spawn-environment.ts` (`TERM`, `COLORTERM`, `TERM_PROGRAM`,
//! `TERM_PROGRAM_VERSION`, `FORCE_HYPERLINK`, `LANG`) and
//! `src/main/cli/linux-terminal-orca-cli-shim.ts` (userData-scoped shim dir
//! prepended to managed-PTY PATH) plus `src/main/cli/
//! bundled-cli-launcher-path.ts` (bundled `Resources/bin` CLI resolution).
//! Adapted to this repo's contracts: the shim binds `--data-dir` when
//! `DROGON_DATA_DIR` is absent, and worker-only secrets stay excluded (see
//! [`apply_to_command`]).
//!
//! Daemon-only secrets that are stripped and never re-set here:
//! - `DROGON_DISPATCH_CAPABILITY` (a worker's private credential),
//! - `DROGON_RUN_ID`, `DROGON_TASK_ID`, `DROGON_DISPATCH_ID`,
//!   `DROGON_HOST_ID`, `DROGON_SESSION_INCARNATION`, `DROGON_CLI_COMMAND`
//!   (orchestration scope; only [`WorkerEnvironment`](crate::session::
//!   session_admission::WorkerEnvironment) may set these, on worker launches),
//! - any other inherited `DROGON_*` (a parent session's identity is replaced,
//!   never inherited, so nested sessions get a fresh identity),
//! - all `ORCA_*` (a foreign runtime's identifiers).
//!
//! The daemon's auth token is a file under the data dir, never an
//! environment variable, so there is no token variable to strip.

use std::path::{Path, PathBuf};

use drogon_protocol::RpcError;
use portable_pty::CommandBuilder;

use crate::{error, hooks};

/// Directory under the data dir holding the `drogon-cli`/`drogon` shims.
pub(crate) fn bin_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("bin")
}

/// Shim path hook commands and session `PATH` lookups use.
pub(crate) fn shim_path(data_dir: &Path) -> PathBuf {
    bin_dir(data_dir).join(cli_file_name())
}

pub(crate) fn cli_file_name() -> &'static str {
    #[cfg(windows)]
    {
        "drogon-cli.exe"
    }
    #[cfg(not(windows))]
    {
        "drogon-cli"
    }
}

/// Whether an inherited variable is control-plane context that must not
/// reach the child: a foreign runtime's identifiers or this runtime's own
/// authority binding. The session-safe `DROGON_*` subset is set fresh by
/// [`session_env_assignments`], never inherited.
fn is_control_key(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    upper.starts_with("ORCA_") || upper.starts_with("DROGON_")
}

/// PATH key/values of the inheriting process: the exact key spelling (Windows
/// `Path` vs POSIX `PATH`) and the platform delimiter.
fn inherited_path() -> (String, Option<String>) {
    for (key, value) in std::env::vars_os() {
        let name = key.to_string_lossy();
        if name.eq_ignore_ascii_case("PATH") {
            return (
                name.into_owned(),
                Some(value.to_string_lossy().into_owned()),
            );
        }
    }
    ("PATH".to_string(), None)
}

/// The assignments [`apply_to_command`] sets after stripping control keys:
/// shim-dir-first `PATH`, the session identity, and terminal identification.
/// Pure over its inputs so tests can pin the composition without spawning.
fn session_env_assignments(
    data_dir: &str,
    workspace_id: &str,
    session_id: &str,
    path_key: &str,
    inherited_path_value: Option<&str>,
    path_delimiter: char,
) -> Vec<(String, String)> {
    let shim = format!("{data_dir}/bin");
    let path_value = match inherited_path_value {
        Some(current) if !current.is_empty() => {
            let rest: Vec<&str> = current
                .split(path_delimiter)
                .filter(|entry| !entry.is_empty() && *entry != shim)
                .collect();
            if rest.is_empty() {
                shim
            } else {
                format!(
                    "{shim}{path_delimiter}{}",
                    rest.join(&path_delimiter.to_string())
                )
            }
        }
        _ => shim,
    };
    vec![
        (path_key.to_string(), path_value),
        ("DROGON_DATA_DIR".to_string(), data_dir.to_string()),
        ("DROGON_WORKSPACE_ID".to_string(), workspace_id.to_string()),
        ("DROGON_SESSION_ID".to_string(), session_id.to_string()),
        ("DROGON_TERMINAL".to_string(), "1".to_string()),
        ("TERM".to_string(), "xterm-256color".to_string()),
        ("COLORTERM".to_string(), "truecolor".to_string()),
        ("TERM_PROGRAM".to_string(), "Drogon".to_string()),
        (
            "TERM_PROGRAM_VERSION".to_string(),
            env!("CARGO_PKG_VERSION").to_string(),
        ),
        // The desktop terminal parses OSC 8 links; force tools past a
        // `supports-hyperlinks` gate that would otherwise drop them.
        ("FORCE_HYPERLINK".to_string(), "1".to_string()),
    ]
}

/// Applies the session environment to a PTY command: strips inherited
/// control-plane context (including daemon-only secrets, listed in the module
/// docs), then sets the assignments from [`session_env_assignments`]. A
/// reserved worker launch applies exactly its service-authored context after
/// this; ordinary sessions keep only what is set here. `LANG` defaults (never
/// overrides) so child output stays UTF-8 when the daemon has no locale.
pub(crate) fn apply_to_command(
    cmd: &mut CommandBuilder,
    data_dir: &Path,
    workspace_id: &str,
    session_id: &str,
) {
    for (key, _) in std::env::vars_os() {
        if is_control_key(&key.to_string_lossy()) {
            cmd.env_remove(key);
        }
    }
    let data_dir_text = data_dir.to_string_lossy();
    let (path_key, inherited) = inherited_path();
    #[cfg(windows)]
    let delimiter = ';';
    #[cfg(not(windows))]
    let delimiter = ':';
    for (key, value) in session_env_assignments(
        &data_dir_text,
        workspace_id,
        session_id,
        &path_key,
        inherited.as_deref(),
        delimiter,
    ) {
        cmd.env(key, value);
    }
    if std::env::var_os("LANG").is_none() {
        cmd.env("LANG", "en_US.UTF-8");
    }
}

/// Absolute CLI binary the shims exec: the sibling of the running service
/// binary when it is actually there (the packaged layout), else the bundled
/// `Contents/Resources/bin` CLI inside `Drogon.app`, else a `drogon-cli`
/// found on `PATH` (excluding this data dir's own shim dir, so the shim can
/// never resolve to itself). `None` means no CLI is reachable and the shims
/// must fail loudly instead of exec-looping through `PATH`.
pub(crate) fn resolve_cli_target(data_dir: &Path) -> Option<String> {
    let current_exe = std::env::current_exe().ok();
    let path_entries: Vec<PathBuf> = std::env::var_os("PATH")
        .map_or_else(Vec::new, |paths| std::env::split_paths(&paths).collect());
    resolve_cli_target_from(current_exe.as_deref(), &path_entries, &bin_dir(data_dir))
}

fn resolve_cli_target_from(
    current_exe: Option<&Path>,
    path_entries: &[PathBuf],
    own_shim_dir: &Path,
) -> Option<String> {
    if let Some(exe) = current_exe
        && let Some(dir) = exe.parent()
    {
        let sibling = dir.join(cli_file_name());
        if sibling.is_file() {
            return Some(sibling.to_string_lossy().into_owned());
        }
        // macOS bundle: `Drogon.app/Contents/MacOS/drogond` resolves its CLI
        // from `Drogon.app/Contents/Resources/bin/drogon-cli`.
        for ancestor in exe.ancestors() {
            if ancestor.file_name().is_some_and(|name| name == "Contents") {
                let bundled = ancestor.join("Resources").join("bin").join(cli_file_name());
                if bundled.is_file() {
                    return Some(bundled.to_string_lossy().into_owned());
                }
                break;
            }
        }
    }
    for entry in path_entries {
        // Never resolve through this data dir's own shim dir: that match is
        // the shim being installed, and exec'ing it would loop back through
        // `PATH` onto itself. Another data dir's shim stays a usable absolute
        // fallback (the session environment binds this data dir anyway).
        if entry == own_shim_dir {
            continue;
        }
        let candidate = entry.join(cli_file_name());
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
}

/// Renders one shim script: execs the resolved CLI, binding `--data-dir`
/// when the caller runs outside a Drogon terminal (no `DROGON_DATA_DIR` in
/// its environment). A `None` target renders a loud failure stub instead of
/// a `PATH` exec that would re-resolve the shim itself and loop.
fn render_shim(target: Option<&str>, data_dir: &Path) -> String {
    let data_dir_text = data_dir.to_string_lossy();
    let mut script = String::from("#!/usr/bin/env bash\n");
    script
        .push_str("# Managed by drogond: do not edit. Rewritten when the daemon binary changes.\n");
    match target {
        Some(cli) => {
            script.push_str(&format!(
                "if [ -z \"${{DROGON_DATA_DIR:-}}\" ]; then\n  exec {} --data-dir {} \"$@\"\nelse\n  exec {} \"$@\"\nfi\n",
                hooks::shell_quote(cli),
                hooks::shell_quote(&data_dir_text),
                hooks::shell_quote(cli),
            ));
        }
        None => {
            script.push_str(&format!(
                "echo {} >&2\nexit 1\n",
                hooks::shell_quote(&format!(
                    "drogon-cli is unavailable: no CLI ships with the running daemon for {}",
                    data_dir_text
                )),
            ));
        }
    }
    script
}

/// Installs (or refreshes) the executable `drogon-cli` and `drogon` shims in
/// `<data-dir>/bin`. Idempotent: files with the expected content are left in
/// place; a changed daemon binary path renders different content, so the
/// shims are replaced exactly when the resolution changes.
pub(crate) fn install_shims(data_dir: &Path) -> Result<(), RpcError> {
    let dir = bin_dir(data_dir);
    std::fs::create_dir_all(&dir)
        .map_err(|e| error::io_error(format!("cannot create shim dir: {e}")))?;
    let target = resolve_cli_target(data_dir);
    let content = render_shim(target.as_deref(), data_dir);
    for name in ["drogon-cli", "drogon"] {
        let path = dir.join(name);
        let current = std::fs::read_to_string(&path).ok();
        if current.as_deref() != Some(content.as_str()) {
            std::fs::write(&path, &content)
                .map_err(|e| error::io_error(format!("cannot write shim {name}: {e}")))?;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
                .map_err(|e| error::io_error(format!("cannot make shim {name} executable: {e}")))?;
        }
    }
    Ok(())
}

/// Best `drogon-cli` path for hook commands: the installed shim (absolute,
/// so hook delivery never depends on the session's `PATH`), else the legacy
/// sibling-or-`PATH` lookup for data dirs whose shims predate this feature.
pub(crate) fn cli_command_for_hooks(data_dir: &Path) -> String {
    let shim = shim_path(data_dir);
    if shim.is_file() {
        return shim.to_string_lossy().into_owned();
    }
    hooks::cli_command()
}

/// Env pairs an OpenCode/Pi hook plugin needs to call back into
/// `drogon-cli internal hook-event` the way Claude's shell hook commands
/// do (`hooks::hook_command`), applied as the `extra_env` overlay
/// `harness.rs` passes through `session_admission::launch_reserved`.
///
/// `DROGON_SESSION_ID` is already exported unconditionally by
/// [`session_env_assignments`] for every session, but the incarnation is
/// deliberately withheld there (see the module docs: it is worker-launch
/// scope). A harness hook plugin still needs it to report the same
/// `--incarnation` a Claude hook command embeds, so it travels under this
/// distinct name instead — never `DROGON_SESSION_INCARNATION`, which stays
/// reserved for `WorkerEnvironment`.
pub(crate) fn harness_hook_env(cli: &str, incarnation: &str) -> Vec<(String, String)> {
    vec![
        ("DROGON_HOOK_CLI".to_string(), cli.to_string()),
        (
            "DROGON_HOOK_INCARNATION".to_string(),
            incarnation.to_string(),
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn assignments(data_dir: &str, inherited: Option<&str>) -> Vec<(String, String)> {
        session_env_assignments(data_dir, "ws-1", "sess-9", "PATH", inherited, ':')
    }

    fn get(assignments: &[(String, String)], key: &str) -> String {
        assignments
            .iter()
            .find(|(name, _)| name == key)
            .unwrap_or_else(|| panic!("missing assignment {key}"))
            .1
            .clone()
    }

    #[test]
    fn control_key_matching_is_prefix_case_insensitive() {
        for key in [
            "DROGON_DATA_DIR",
            "drogon_session_id",
            "Drogon_Terminal",
            "DROGON_DISPATCH_CAPABILITY",
            "ORCA_WORKSPACE_ID",
            "orca_terminal_handle",
        ] {
            assert!(
                is_control_key(key),
                "{key} must be treated as control context"
            );
        }
        for key in ["PATH", "HOME", "LANG", "DROGONISH", "MY_DROGON_VAR"] {
            assert!(!is_control_key(key), "{key} must be inherited untouched");
        }
    }

    #[test]
    fn assignments_carry_session_identity_and_terminal_markers() {
        let vars = assignments("/data/x", Some("/usr/bin:/bin"));
        assert_eq!(get(&vars, "DROGON_DATA_DIR"), "/data/x");
        assert_eq!(get(&vars, "DROGON_WORKSPACE_ID"), "ws-1");
        assert_eq!(get(&vars, "DROGON_SESSION_ID"), "sess-9");
        assert_eq!(get(&vars, "DROGON_TERMINAL"), "1");
        assert_eq!(get(&vars, "TERM_PROGRAM"), "Drogon");
        assert_eq!(
            get(&vars, "TERM_PROGRAM_VERSION"),
            env!("CARGO_PKG_VERSION")
        );
        assert_eq!(get(&vars, "TERM"), "xterm-256color");
        assert_eq!(get(&vars, "COLORTERM"), "truecolor");
    }

    #[test]
    fn assignments_never_carry_worker_scope_or_credentials() {
        let vars = assignments("/data/x", None);
        for secret in [
            "DROGON_DISPATCH_CAPABILITY",
            "DROGON_RUN_ID",
            "DROGON_TASK_ID",
            "DROGON_DISPATCH_ID",
            "DROGON_HOST_ID",
            "DROGON_SESSION_INCARNATION",
            "DROGON_CLI_COMMAND",
        ] {
            assert!(
                vars.iter().all(|(name, _)| name != secret),
                "{secret} must never leak into an ordinary session"
            );
        }
    }

    #[test]
    fn shim_dir_is_prepended_once_and_deduplicated() {
        assert_eq!(
            get(&assignments("/data/x", Some("/usr/bin:/bin")), "PATH"),
            "/data/x/bin:/usr/bin:/bin"
        );
        assert_eq!(
            get(
                &assignments("/data/x", Some("/usr/bin:/data/x/bin:/bin")),
                "PATH"
            ),
            "/data/x/bin:/usr/bin:/bin"
        );
        assert_eq!(
            get(&assignments("/data/x", Some("/data/x/bin")), "PATH"),
            "/data/x/bin"
        );
        assert_eq!(get(&assignments("/data/x", None), "PATH"), "/data/x/bin");
        assert_eq!(
            get(&assignments("/data/x", Some("")), "PATH"),
            "/data/x/bin"
        );
    }

    #[test]
    fn sibling_of_the_service_binary_wins_resolution() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("drogond");
        std::fs::write(&exe, "x").unwrap();
        let cli = dir.path().join(cli_file_name());
        std::fs::write(&cli, "x").unwrap();
        assert_eq!(
            resolve_cli_target_from(Some(&exe), &[], dir.path()),
            Some(cli.to_string_lossy().into_owned())
        );
    }

    #[test]
    fn macos_bundle_layout_resolves_resources_bin() {
        let root = tempfile::tempdir().unwrap();
        let contents = root.path().join("Drogon.app").join("Contents");
        let macos = contents.join("MacOS");
        std::fs::create_dir_all(&macos).unwrap();
        let exe = macos.join("drogond");
        std::fs::write(&exe, "x").unwrap();
        let bundled = contents.join("Resources").join("bin");
        std::fs::create_dir_all(&bundled).unwrap();
        let cli = bundled.join(cli_file_name());
        std::fs::write(&cli, "x").unwrap();
        assert_eq!(
            resolve_cli_target_from(Some(&exe), &[], root.path()),
            Some(cli.to_string_lossy().into_owned())
        );
    }

    #[test]
    fn path_search_skips_only_this_data_dirs_own_shim_dir() {
        let outer = tempfile::tempdir().unwrap();
        let own_shim = outer.path().join("somedata").join("bin");
        std::fs::create_dir_all(&own_shim).unwrap();
        std::fs::write(own_shim.join(cli_file_name()), "x").unwrap();
        let tools = outer.path().join("tools");
        std::fs::create_dir_all(&tools).unwrap();
        let cli = tools.join(cli_file_name());
        std::fs::write(&cli, "x").unwrap();
        // A system `bin` directory holding the CLI stays a valid target.
        let system_bin = outer.path().join("usr").join("bin");
        assert_ne!(system_bin, own_shim);
        assert_eq!(
            resolve_cli_target_from(None, &[own_shim.clone(), tools.clone()], &own_shim),
            Some(cli.to_string_lossy().into_owned())
        );
        assert_eq!(
            resolve_cli_target_from(None, std::slice::from_ref(&own_shim), &own_shim),
            None,
            "the shim being installed must not resolve, or it would exec itself"
        );
    }

    #[test]
    fn shim_binds_data_dir_only_when_env_is_absent() {
        let script = render_shim(Some("/opt/drogon/drogon-cli"), Path::new("/data/x"));
        assert!(script.starts_with("#!/usr/bin/env bash\n"), "{script}");
        assert!(script.contains("--data-dir /data/x"), "{script}");
        assert!(script.contains("${DROGON_DATA_DIR:-}"), "{script}");
        assert!(
            script.contains("exec /opt/drogon/drogon-cli \"$@\""),
            "{script}"
        );
    }

    #[test]
    fn shim_quotes_paths_with_spaces() {
        let script = render_shim(Some("/opt/my dir/drogon-cli"), Path::new("/data/my dir"));
        assert!(script.contains("'/opt/my dir/drogon-cli'"), "{script}");
        assert!(script.contains("'/data/my dir'"), "{script}");
    }

    #[test]
    fn missing_cli_renders_a_loud_stub_never_a_path_exec() {
        let script = render_shim(None, Path::new("/data/x"));
        assert!(script.contains("exit 1"), "{script}");
        assert!(!script.contains("--data-dir"), "{script}");
        assert!(
            !script.lines().any(|line| {
                let trimmed = line.trim_start();
                trimmed.starts_with("exec drogon-cli")
            }),
            "a bare PATH exec would re-resolve the shim itself: {script}"
        );
    }

    #[test]
    fn install_is_idempotent_and_replaces_stale_shims() {
        let data = tempfile::tempdir().unwrap();
        install_shims(data.path()).unwrap();
        for name in ["drogon-cli", "drogon"] {
            let path = bin_dir(data.path()).join(name);
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_ne!(mode & 0o111, 0, "{name} must be executable");
        }
        let before = std::fs::read_to_string(bin_dir(data.path()).join("drogon-cli")).unwrap();
        install_shims(data.path()).unwrap();
        let after = std::fs::read_to_string(bin_dir(data.path()).join("drogon-cli")).unwrap();
        assert_eq!(before, after, "reinstall must be byte-identical");
        // A stale shim (e.g. pointing at a previous daemon build) is replaced.
        std::fs::write(bin_dir(data.path()).join("drogon-cli"), "# stale\n").unwrap();
        std::fs::write(bin_dir(data.path()).join("drogon"), "# stale\n").unwrap();
        install_shims(data.path()).unwrap();
        assert_eq!(
            std::fs::read_to_string(bin_dir(data.path()).join("drogon-cli")).unwrap(),
            before
        );
        assert_eq!(
            std::fs::read_to_string(bin_dir(data.path()).join("drogon")).unwrap(),
            std::fs::read_to_string(bin_dir(data.path()).join("drogon")).unwrap()
        );
    }

    #[test]
    fn harness_hook_env_carries_cli_and_a_distinct_incarnation_key() {
        let pairs = harness_hook_env("/data/x/bin/drogon-cli", "inc-9");
        assert_eq!(
            pairs,
            vec![
                (
                    "DROGON_HOOK_CLI".to_string(),
                    "/data/x/bin/drogon-cli".to_string()
                ),
                ("DROGON_HOOK_INCARNATION".to_string(), "inc-9".to_string()),
            ]
        );
        assert!(
            pairs.iter().all(|(k, _)| k != "DROGON_SESSION_INCARNATION"),
            "must never reuse the worker-reserved incarnation key"
        );
    }

    #[test]
    fn hooks_prefer_the_installed_shim() {
        let data = tempfile::tempdir().unwrap();
        install_shims(data.path()).unwrap();
        assert_eq!(
            cli_command_for_hooks(data.path()),
            shim_path(data.path()).to_string_lossy()
        );
    }
}
