use std::path::Path;

use drogon_protocol::RpcError;
use serde::{Deserialize, Serialize};

use crate::{HarnessId, discovery::is_script_launcher};

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionMode {
    #[default]
    Inherit,
    Unattended,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessLaunchRequest {
    pub harness_id: HarnessId,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub provider: Option<String>,
    pub prompt: Option<String>,
    #[serde(default)]
    pub permission_mode: PermissionMode,
    /// Daemon-run mode (bot/automation runs): consume the prompt
    /// non-interactively and exit, instead of opening the interactive TUI
    /// a user-facing tab gets. Absent (user tabs) means interactive.
    #[serde(default)]
    pub headless: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessLaunchPlan {
    pub harness_id: HarnessId,
    pub command: String,
    pub args: Vec<String>,
    pub permission_mode: PermissionMode,
}

/// The service supplies a discovered absolute executable, not a client-provided command override.
pub fn plan_launch(
    request: &HarnessLaunchRequest,
    executable: &Path,
) -> Result<HarnessLaunchPlan, RpcError> {
    if !executable.is_absolute() {
        return Err(invalid("Harness executable must be an absolute host path"));
    }
    let command = executable
        .to_str()
        .ok_or_else(|| invalid("Harness executable path is not UTF-8"))?
        .to_owned();
    let is_batch_launcher = is_script_launcher(executable);
    let mut args = Vec::new();
    for (name, value) in [
        ("model", &request.model),
        ("provider", &request.provider),
        ("effort", &request.effort),
    ] {
        if let Some(value) = value
            && (value.is_empty()
                || value.len() > 512
                || value.chars().any(char::is_control)
                || value.starts_with('-'))
        {
            return Err(invalid(format!("Invalid {name}")));
        }
    }
    // `opencode run` is a subcommand: it must lead the argv line, ahead of
    // the shared `--model`/`--auto` flags below (both exist on `run` too).
    if request.headless && request.harness_id == HarnessId::Opencode {
        args.push("run".into());
    }
    if let Some(provider) = &request.provider {
        if request.harness_id != HarnessId::Pi {
            return Err(invalid("Provider selection is available only for Pi"));
        }
        args.extend(["--provider".into(), provider.clone()]);
    }
    if let Some(model) = &request.model {
        args.extend(["--model".into(), model.clone()]);
    }
    if let Some(effort) = &request.effort {
        let (flag, allowed): (&str, &[&str]) = match request.harness_id {
            HarnessId::Claude => ("--effort", &["low", "medium", "high", "xhigh", "max"]),
            HarnessId::Pi => (
                "--thinking",
                &["off", "minimal", "low", "medium", "high", "xhigh", "max"],
            ),
            HarnessId::Antigravity => ("--effort", &["low", "medium", "high"]),
            HarnessId::Opencode => {
                return Err(invalid(
                    "OpenCode effort selection is not advertised by this adapter",
                ));
            }
        };
        if !allowed.contains(&effort.as_str()) {
            return Err(invalid("Unsupported effort for this harness"));
        }
        args.extend([flag.into(), effort.clone()]);
    }
    if request.permission_mode == PermissionMode::Unattended {
        match request.harness_id {
            HarnessId::Claude | HarnessId::Antigravity => {
                args.push("--dangerously-skip-permissions".into())
            }
            HarnessId::Opencode => args.push("--auto".into()),
            // Pi has no per-tool approval flag; trust only this invocation's project files.
            HarnessId::Pi => args.push("--approve".into()),
        }
    }
    if let Some(prompt) = &request.prompt {
        if prompt.trim().is_empty() || prompt.len() > 32768 || prompt.contains('\0') {
            return Err(invalid(
                "Prompt must contain 1..32768 UTF-8 bytes without NUL",
            ));
        }
        // A `.cmd`/`.bat` launcher runs through `windows_batch_adapter` below,
        // which folds the prompt into the same `cmd.exe /d /c <script>
        // <args...>` command line as everything else and refuses any
        // argv entry cmd.exe would re-parse — including the newline a
        // realistic multi-line prompt very often contains. That refusal is
        // correct (there is no safe way to *escape* those characters on
        // this argv-only delivery path), but folding it into the same
        // generic "must not contain any of: ..." message as an unsafe
        // `--model`/`--effort` value understates why: a real fix needs the
        // prompt delivered over the session's stdin after spawn
        // (`session.write`, following `session.start`) instead of via argv
        // at all, which is a call-site change in `drogon-core::harness`
        // (`resolve_launch`/`do_harness_start`), outside this adapter's file
        // scope. Refuse early here, scoped to the prompt specifically, with
        // that rationale, rather than let it fall through to the generic
        // per-argv-token refusal below.
        if let Some(err) = scoped_batch_prompt_error(request.harness_id, prompt, is_batch_launcher)
        {
            return Err(err);
        }
        // Headless (daemon-run) delivery: each harness's own
        // non-interactive entrypoint, which consumes the prompt and exits
        // so the session's exit is the run's completion signal. The
        // interactive TUI entrypoints below stay for user-facing tabs.
        // (`-p` is the short alias every harness documents: `pi -p`,
        // `claude -p`/`--print`, `agy -p`/`--print`.)
        if request.headless {
            match request.harness_id {
                HarnessId::Opencode => args.push(prompt.clone()),
                HarnessId::Antigravity => args.extend(["-p".into(), prompt.clone()]),
                HarnessId::Claude => args.extend(["-p".into(), "--".into(), prompt.clone()]),
                // Pi interprets @file and command-shaped positional arguments before messages.
                HarnessId::Pi => {
                    args.push("-p".into());
                    args.push(format!("Drogon task:\n{prompt}"));
                }
            }
        } else {
            match request.harness_id {
                HarnessId::Opencode => args.push(format!("--prompt={prompt}")),
                HarnessId::Antigravity => {
                    args.extend(["--prompt-interactive".into(), prompt.clone()])
                }
                HarnessId::Claude => args.extend(["--".into(), prompt.clone()]),
                // Pi interprets @file and command-shaped positional arguments before messages.
                HarnessId::Pi => args.push(format!("Drogon task:\n{prompt}")),
            }
        }
    }
    let (command, args) = if is_batch_launcher {
        windows_batch_adapter(&command, args)?
    } else {
        (command, args)
    };
    Ok(HarnessLaunchPlan {
        harness_id: request.harness_id,
        command,
        args,
        permission_mode: request.permission_mode,
    })
}

/// Characters cmd.exe re-parses out of a `.cmd`/`.bat` invocation's command
/// line (window redirection, pipes, conditional execution, variable
/// expansion, its own escape character and quote). cmd.exe's escaping rules
/// for these are notoriously inconsistent depending on quoting context, so
/// — following the source implementation's `windows-batch-spawn.ts`
/// (`getSpawnArgsForWindows`/`assertWindowsCmdSafeTokens`) — this adapter
/// refuses any token that contains one rather than attempting to escape it.
/// `(` and `)` are deliberately absent: they only group commands and cannot
/// chain anything without one of the characters below, so rejecting them
/// would merely break paths like `C:\Program Files (x86)\...`.
const WINDOWS_BATCH_UNSAFE_CHARACTERS: [char; 8] = ['&', '|', '<', '>', '^', '"', '%', '!'];

fn has_unsafe_windows_batch_syntax(value: &str) -> bool {
    value.contains(['\r', '\n']) || value.contains(WINDOWS_BATCH_UNSAFE_CHARACTERS)
}

/// Checked against the argv value each harness actually delivers, not the
/// raw prompt: Pi's delivered argv is always `"Drogon task:\n{prompt}"`
/// (the match arm below), so it always carries a newline independent of the
/// raw prompt's content — checking `prompt` itself would miss that and let a
/// "safe" single-line Pi prompt fall through to the generic per-token
/// refusal instead of this scoped one. `is_batch_launcher` is taken as a
/// plain bool rather than recomputed from a path here, so this stays
/// unit-testable on any host, including Linux where `is_script_launcher` is
/// always false.
fn scoped_batch_prompt_error(
    harness_id: HarnessId,
    prompt: &str,
    is_batch_launcher: bool,
) -> Option<RpcError> {
    if !is_batch_launcher {
        return None;
    }
    let pi_prompt_argv;
    let delivered = match harness_id {
        HarnessId::Pi => {
            pi_prompt_argv = format!("Drogon task:\n{prompt}");
            pi_prompt_argv.as_str()
        }
        _ => prompt,
    };
    has_unsafe_windows_batch_syntax(delivered).then(|| {
        invalid(
            "This prompt is not supported for a .cmd/.bat launcher yet: it contains a \
             newline or a cmd.exe metacharacter (& | < > ^ \" % !), and today's argv-only \
             delivery has no way to escape those safely. Real support needs the prompt \
             written to the session's stdin after spawn (`session.write`, once \
             `session.start` has started the process) instead of folded into the \
             cmd.exe command line — unimplemented pending a Windows end-to-end run. Use a \
             single-line prompt without those characters, or a harness installed as a \
             native executable, until then.",
        )
    })
}

/// `ComSpec`, then `%SystemRoot%\System32\cmd.exe`, then the documented
/// default install location — the same resolution order as the source
/// implementation's `getCmdExePath`. `env_value` is injected so the pure
/// resolution order is unit-testable on any host without mutating real
/// process environment state.
fn cmd_exe_path(env_value: impl Fn(&str) -> Option<String>) -> String {
    if let Some(comspec) = env_value("ComSpec").filter(|value| !value.is_empty()) {
        return comspec;
    }
    let system_root = env_value("SystemRoot")
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| r"C:\Windows".to_string());
    format!(r"{system_root}\System32\cmd.exe")
}

/// The validated Windows argv adapter for `.cmd`/`.bat` launchers, ported
/// from the source implementation's `getSpawnArgsForWindows`: rather than
/// invoking the script directly (which `CreateProcess` cannot do — batch
/// files are not independently executable images), the plan runs
/// `cmd.exe /d /c <script> <args...>` with every argument kept as its own
/// argv entry so the process spawner's own quoting protects embedded
/// spaces, and cmd.exe metacharacters are refused rather than escaped.
fn windows_batch_adapter(
    command: &str,
    args: Vec<String>,
) -> Result<(String, Vec<String>), RpcError> {
    if has_unsafe_windows_batch_syntax(command)
        || args.iter().any(|arg| has_unsafe_windows_batch_syntax(arg))
    {
        let unsafe_chars: String = WINDOWS_BATCH_UNSAFE_CHARACTERS.iter().collect();
        return Err(invalid(format!(
            "Windows batch launcher arguments must not contain any of: {unsafe_chars}"
        )));
    }
    let mut wrapped = vec!["/d".to_string(), "/c".to_string(), command.to_string()];
    wrapped.extend(args);
    Ok((cmd_exe_path(|key| std::env::var(key).ok()), wrapped))
}

fn invalid(message: impl Into<String>) -> RpcError {
    RpcError::new("invalid_argument", message)
}

/// Pure quoting/escaping logic for the Windows batch-launcher adapter,
/// unit-tested here so it runs on any host (this module's actual Windows
/// invocation only ever happens when `is_script_launcher` sees a `.cmd`/
/// `.bat` path on a Windows build — see V5's isolated Windows runner for
/// that exercise, not this vertical).
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_tokens_are_left_alone() {
        for value in [
            "plain",
            "with space",
            r"C:\Program Files (x86)\pi\pi.cmd",
            "--model=served/model:variant",
            "unicode-\u{1F600}",
        ] {
            assert!(
                !has_unsafe_windows_batch_syntax(value),
                "expected {value:?} to be safe"
            );
        }
    }

    #[test]
    fn every_documented_unsafe_character_is_caught() {
        for ch in WINDOWS_BATCH_UNSAFE_CHARACTERS {
            let value = format!("before{ch}after");
            assert!(
                has_unsafe_windows_batch_syntax(&value),
                "expected {ch:?} to be flagged unsafe"
            );
        }
        assert!(has_unsafe_windows_batch_syntax("line\nbreak"));
        assert!(has_unsafe_windows_batch_syntax("carriage\rreturn"));
    }

    #[test]
    fn parens_are_deliberately_not_flagged() {
        assert!(!has_unsafe_windows_batch_syntax(
            r"C:\Program Files (x86)\tools\pi.cmd"
        ));
    }

    /// Portable regression test for the Pi-prefix bug: runs on any host,
    /// including Linux where `is_script_launcher` is always `false`, by
    /// passing `is_batch_launcher` in directly rather than deriving it from
    /// a path. A safe single-line prompt must still be refused for Pi with
    /// the scoped, `session.write`-naming message, because the delivered
    /// argv gets the `"Drogon task:\n"` prefix regardless of the raw
    /// prompt's content.
    #[test]
    fn pi_safe_single_line_prompt_is_scoped_refused_for_batch_launcher() {
        let safe_prompt = "do the thing, no metacharacters here";
        assert!(!has_unsafe_windows_batch_syntax(safe_prompt));

        let err = scoped_batch_prompt_error(HarnessId::Pi, safe_prompt, true)
            .expect("Pi + batch launcher must refuse even a safe prompt");
        assert_eq!(err.code, "invalid_argument");
        assert!(
            err.message.contains("session.write"),
            "must name the real fix (post-spawn stdin delivery): got {:?}",
            err.message
        );

        // Same prompt, not a batch launcher: no refusal at all.
        assert!(scoped_batch_prompt_error(HarnessId::Pi, safe_prompt, false).is_none());
        // Same batch launcher, a harness without the prefix: raw prompt decides.
        assert!(scoped_batch_prompt_error(HarnessId::Claude, safe_prompt, true).is_none());
    }

    #[test]
    fn cmd_exe_path_prefers_comspec() {
        let env = |key: &str| match key {
            "ComSpec" => Some(r"D:\Custom\cmd.exe".to_string()),
            "SystemRoot" => Some(r"C:\Windows".to_string()),
            _ => None,
        };
        assert_eq!(cmd_exe_path(env), r"D:\Custom\cmd.exe");
    }

    #[test]
    fn cmd_exe_path_falls_back_to_system_root_then_default() {
        let system_root_only = |key: &str| match key {
            "SystemRoot" => Some(r"E:\Windows".to_string()),
            _ => None,
        };
        assert_eq!(
            cmd_exe_path(system_root_only),
            r"E:\Windows\System32\cmd.exe"
        );

        let nothing_set = |_: &str| None;
        assert_eq!(cmd_exe_path(nothing_set), r"C:\Windows\System32\cmd.exe");

        let empty_values = |key: &str| match key {
            "ComSpec" => Some(String::new()),
            "SystemRoot" => Some(String::new()),
            _ => None,
        };
        assert_eq!(
            cmd_exe_path(empty_values),
            r"C:\Windows\System32\cmd.exe",
            "empty env values must count as unset"
        );
    }

    #[test]
    fn windows_batch_adapter_wraps_safe_invocations_with_cmd_exe() {
        let (command, args) = windows_batch_adapter(
            r"C:\tools\pi.cmd",
            vec!["--model".to_string(), "served/model:variant".to_string()],
        )
        .unwrap();
        assert!(command.ends_with(r"System32\cmd.exe") || command.ends_with("cmd.exe"));
        assert_eq!(
            args,
            [
                "/d",
                "/c",
                r"C:\tools\pi.cmd",
                "--model",
                "served/model:variant",
            ]
        );
    }

    fn request(harness_id: HarnessId, prompt: &str, headless: bool) -> HarnessLaunchRequest {
        HarnessLaunchRequest {
            harness_id,
            model: None,
            effort: None,
            provider: None,
            prompt: Some(prompt.to_string()),
            permission_mode: PermissionMode::Inherit,
            headless,
        }
    }

    fn plan(request: &HarnessLaunchRequest) -> Vec<String> {
        let exe = Path::new(match request.harness_id {
            HarnessId::Claude => "/usr/local/bin/claude",
            HarnessId::Pi => "/usr/local/bin/pi",
            HarnessId::Opencode => "/usr/local/bin/opencode",
            HarnessId::Antigravity => "/usr/local/bin/agy",
        });
        plan_launch(request, exe).unwrap().args
    }

    #[test]
    fn headless_defaults_to_false_when_absent() {
        let request: HarnessLaunchRequest = serde_json::from_value(serde_json::json!({
            "harnessId": "pi",
            "prompt": "hello",
        }))
        .unwrap();
        assert!(!request.headless);
    }

    #[test]
    fn pi_interactive_keeps_the_tui_positional_prompt() {
        let args = plan(&request(HarnessId::Pi, "do the thing", false));
        assert_eq!(args, ["Drogon task:\ndo the thing"]);
    }

    #[test]
    fn pi_headless_answers_through_print_mode() {
        let mut base = request(HarnessId::Pi, "do the thing", true);
        base.provider = Some("dgx-spark".to_string());
        base.model = Some("qwen3.8-flash-next-nvidia-nvfp4".to_string());
        base.permission_mode = PermissionMode::Unattended;
        let args = plan(&base);
        assert_eq!(
            args,
            [
                "--provider",
                "dgx-spark",
                "--model",
                "qwen3.8-flash-next-nvidia-nvfp4",
                "--approve",
                "-p",
                "Drogon task:\ndo the thing",
            ]
        );
    }

    #[test]
    fn claude_interactive_and_headless_prompt_delivery() {
        assert_eq!(plan(&request(HarnessId::Claude, "hi", false)), ["--", "hi"]);
        assert_eq!(
            plan(&request(HarnessId::Claude, "hi", true)),
            ["-p", "--", "hi"]
        );
    }

    #[test]
    fn claude_headless_keeps_unattended_permissions() {
        let mut base = request(HarnessId::Claude, "hi", true);
        base.permission_mode = PermissionMode::Unattended;
        assert_eq!(
            plan(&base),
            ["--dangerously-skip-permissions", "-p", "--", "hi"]
        );
    }

    #[test]
    fn opencode_interactive_uses_the_prompt_flag_headless_uses_run() {
        assert_eq!(
            plan(&request(HarnessId::Opencode, "hi", false)),
            ["--prompt=hi"]
        );
        assert_eq!(
            plan(&request(HarnessId::Opencode, "hi", true)),
            ["run", "hi"]
        );
    }

    #[test]
    fn opencode_headless_run_leads_with_model_and_auto() {
        let mut base = request(HarnessId::Opencode, "hi", true);
        base.model = Some("provider/model".to_string());
        base.permission_mode = PermissionMode::Unattended;
        assert_eq!(
            plan(&base),
            ["run", "--model", "provider/model", "--auto", "hi"]
        );
    }

    #[test]
    fn antigravity_interactive_and_headless_prompt_delivery() {
        assert_eq!(
            plan(&request(HarnessId::Antigravity, "hi", false)),
            ["--prompt-interactive", "hi"]
        );
        assert_eq!(
            plan(&request(HarnessId::Antigravity, "hi", true)),
            ["-p", "hi"]
        );
    }

    /// Interactive (menu-row) launches carry no prompt: the argv is just
    /// the stored model/effort plus the permission-mode flag. Covers #231:
    /// every harness row launches with its Settings → Agents defaults.
    fn interactive(harness_id: HarnessId) -> HarnessLaunchRequest {
        HarnessLaunchRequest {
            harness_id,
            model: None,
            effort: None,
            provider: None,
            prompt: None,
            permission_mode: PermissionMode::Inherit,
            headless: false,
        }
    }

    fn unattended(harness_id: HarnessId) -> HarnessLaunchRequest {
        HarnessLaunchRequest {
            permission_mode: PermissionMode::Unattended,
            ..interactive(harness_id)
        }
    }

    #[test]
    fn interactive_unattended_flags_match_the_fork_yolo_defaults() {
        // Claude Code and Antigravity: `--dangerously-skip-permissions`
        // (the fork's YOLO_TUI_AGENT_ARGS).
        assert_eq!(
            plan(&unattended(HarnessId::Claude)),
            ["--dangerously-skip-permissions"]
        );
        assert_eq!(
            plan(&unattended(HarnessId::Antigravity)),
            ["--dangerously-skip-permissions"]
        );
        // Pi trusts this run's project files; OpenCode takes `--auto`.
        assert_eq!(plan(&unattended(HarnessId::Pi)), ["--approve"]);
        assert_eq!(plan(&unattended(HarnessId::Opencode)), ["--auto"]);
    }

    #[test]
    fn interactive_inherit_mode_passes_no_permission_flag() {
        for harness_id in HarnessId::ALL {
            assert_eq!(
                plan(&interactive(harness_id)),
                Vec::<String>::new(),
                "{harness_id:?} must launch bare in inherit mode"
            );
        }
    }

    #[test]
    fn interactive_model_and_provider_flags() {
        let mut pi = interactive(HarnessId::Pi);
        pi.provider = Some("dgx-spark".to_string());
        pi.model = Some("qwen3.8-flash-next-nvidia-nvfp4".to_string());
        assert_eq!(
            plan(&pi),
            [
                "--provider",
                "dgx-spark",
                "--model",
                "qwen3.8-flash-next-nvidia-nvfp4"
            ]
        );
        // `pi --model` also accepts the combined `provider/id` pattern the
        // Settings Model field stores (verified against `pi --help`).
        let mut combined = interactive(HarnessId::Pi);
        combined.model = Some("dgx-spark/qwen3.8-flash-next-nvidia-nvfp4".to_string());
        assert_eq!(
            plan(&combined),
            ["--model", "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4"]
        );
        let mut claude = interactive(HarnessId::Claude);
        claude.model = Some("sonnet".to_string());
        assert_eq!(plan(&claude), ["--model", "sonnet"]);
    }

    #[test]
    fn interactive_effort_flags_per_harness() {
        let mut claude = interactive(HarnessId::Claude);
        claude.effort = Some("high".to_string());
        assert_eq!(plan(&claude), ["--effort", "high"]);
        let mut pi = interactive(HarnessId::Pi);
        pi.effort = Some("max".to_string());
        assert_eq!(plan(&pi), ["--thinking", "max"]);
        let mut agy = interactive(HarnessId::Antigravity);
        agy.effort = Some("low".to_string());
        assert_eq!(plan(&agy), ["--effort", "low"]);
    }

    #[test]
    fn interactive_rejections() {
        // OpenCode advertises no effort flag on its interactive entrypoint.
        let mut opencode = interactive(HarnessId::Opencode);
        opencode.effort = Some("high".to_string());
        assert!(plan_launch(&opencode, Path::new("/usr/local/bin/opencode")).is_err());
        // Provider selection is Pi-only.
        let mut claude = interactive(HarnessId::Claude);
        claude.provider = Some("dgx-spark".to_string());
        assert!(plan_launch(&claude, Path::new("/usr/local/bin/claude")).is_err());
        // Unknown effort values never reach the harness.
        let mut pi = interactive(HarnessId::Pi);
        pi.effort = Some("turbo".to_string());
        assert!(plan_launch(&pi, Path::new("/usr/local/bin/pi")).is_err());
    }

    #[test]
    fn windows_batch_adapter_refuses_unsafe_command_or_arguments() {
        assert!(windows_batch_adapter(r"C:\tools\pi & calc.cmd", vec![]).is_err());
        assert!(
            windows_batch_adapter(
                r"C:\tools\pi.cmd",
                vec!["--prompt".to_string(), "safe & unsafe".to_string()]
            )
            .is_err()
        );
        assert!(
            windows_batch_adapter(r"C:\tools\pi.cmd", vec!["embedded\nnewline".to_string()])
                .is_err()
        );
    }
}
