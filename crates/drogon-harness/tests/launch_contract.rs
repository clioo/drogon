use drogon_harness::{HarnessId, HarnessLaunchRequest, PermissionMode, plan_launch};
use std::path::Path;

fn request(id: HarnessId) -> HarnessLaunchRequest {
    HarnessLaunchRequest {
        harness_id: id,
        model: None,
        effort: None,
        provider: None,
        prompt: None,
        permission_mode: PermissionMode::Inherit,
        headless: false,
    }
}

fn executable() -> &'static Path {
    if cfg!(windows) {
        Path::new(r"C:\tools\agent.exe")
    } else {
        Path::new("/opt/agents/agent")
    }
}

#[test]
fn permission_bypass_is_explicit_per_invocation() {
    for (id, flag) in [
        (HarnessId::Claude, "--dangerously-skip-permissions"),
        (HarnessId::Antigravity, "--dangerously-skip-permissions"),
        (HarnessId::Opencode, "--auto"),
        (HarnessId::Pi, "--approve"),
        (
            HarnessId::Codex,
            "--dangerously-bypass-approvals-and-sandbox",
        ),
    ] {
        let mut req = request(id);
        assert!(plan_launch(&req, executable()).unwrap().args.is_empty());
        req.permission_mode = PermissionMode::Unattended;
        assert_eq!(plan_launch(&req, executable()).unwrap().args, [flag]);
    }
}

#[test]
fn claude_model_effort_and_prompt_stay_separate_argv() {
    let mut req = request(HarnessId::Claude);
    req.model = Some("claude-sonnet-5".into());
    req.effort = Some("medium".into());
    req.prompt = Some("--help; $(touch forbidden)\n@private-file".into());
    req.permission_mode = PermissionMode::Unattended;
    assert_eq!(
        plan_launch(&req, executable()).unwrap().args,
        [
            "--model",
            "claude-sonnet-5",
            "--effort",
            "medium",
            "--dangerously-skip-permissions",
            "--",
            req.prompt.as_deref().unwrap()
        ]
    );
}

#[test]
fn pi_preserves_exact_provider_model_and_prevents_file_expansion() {
    let mut req = request(HarnessId::Pi);
    req.provider = Some("dgx-spark".into());
    req.model = Some("served/model:variant".into());
    req.effort = Some("off".into());
    req.prompt = Some("@secret-file".into());
    assert_eq!(
        plan_launch(&req, executable()).unwrap().args,
        [
            "--provider",
            "dgx-spark",
            "--model",
            "served/model:variant",
            "--thinking",
            "off",
            "Drogon task:\n@secret-file"
        ]
    );
}

#[test]
fn codex_interactive_prompt_and_model_stay_separate_argv() {
    let mut req = request(HarnessId::Codex);
    req.model = Some("gpt-5.4".into());
    req.prompt = Some("--help $(touch forbidden)".into());
    assert_eq!(
        plan_launch(&req, executable()).unwrap().args,
        ["-m", "gpt-5.4", "--help $(touch forbidden)"]
    );
}

#[test]
fn opencode_prompt_that_looks_like_a_flag_is_one_option_value() {
    let mut req = request(HarnessId::Opencode);
    req.prompt = Some("--model another-model".into());
    assert_eq!(
        plan_launch(&req, executable()).unwrap().args,
        ["--prompt=--model another-model"]
    );
}

#[test]
fn headless_runs_use_each_harness_noninteractive_entrypoint() {
    let mut pi = request(HarnessId::Pi);
    pi.prompt = Some("do the thing".into());
    pi.headless = true;
    assert_eq!(
        plan_launch(&pi, executable()).unwrap().args,
        ["-p", "Drogon task:\ndo the thing"]
    );

    let mut claude = request(HarnessId::Claude);
    claude.prompt = Some("do the thing".into());
    claude.headless = true;
    assert_eq!(
        plan_launch(&claude, executable()).unwrap().args,
        ["-p", "--", "do the thing"]
    );

    let mut opencode = request(HarnessId::Opencode);
    opencode.prompt = Some("do the thing".into());
    opencode.headless = true;
    assert_eq!(
        plan_launch(&opencode, executable()).unwrap().args,
        ["run", "do the thing"]
    );

    let mut agy = request(HarnessId::Antigravity);
    agy.prompt = Some("do the thing".into());
    agy.headless = true;
    assert_eq!(
        plan_launch(&agy, executable()).unwrap().args,
        ["-p", "do the thing"]
    );

    let mut codex = request(HarnessId::Codex);
    codex.model = Some("gpt-5.4".into());
    codex.effort = Some("high".into());
    codex.permission_mode = PermissionMode::Unattended;
    codex.prompt = Some("do the thing".into());
    codex.headless = true;
    assert_eq!(
        plan_launch(&codex, executable()).unwrap().args,
        [
            "exec",
            "-m",
            "gpt-5.4",
            "-c",
            "model_reasoning_effort=high",
            "--dangerously-bypass-approvals-and-sandbox",
            "do the thing"
        ]
    );
}

#[test]
fn unsupported_preferences_fail_instead_of_falling_back() {
    for id in HarnessId::ALL {
        let mut req = request(id);
        req.effort = Some("invented".into());
        assert!(plan_launch(&req, executable()).is_err());
    }
    let mut req = request(HarnessId::Claude);
    req.provider = Some("local".into());
    assert!(plan_launch(&req, executable()).is_err());
}

#[test]
fn malformed_values_and_relative_executables_are_refused() {
    let mut req = request(HarnessId::Pi);
    assert!(plan_launch(&req, Path::new("pi")).is_err());
    for value in ["", "--api-key", "bad\0model", "line\nbreak"] {
        req.model = Some(value.into());
        assert!(plan_launch(&req, executable()).is_err());
    }
    req.model = None;
    for value in [
        String::new(),
        " ".into(),
        "bad\0prompt".into(),
        "x".repeat(32769),
    ] {
        req.prompt = Some(value);
        assert!(plan_launch(&req, executable()).is_err());
    }
}

#[test]
fn persisted_harness_ids_are_explicit_and_agy_is_only_an_alias() {
    assert_eq!(
        serde_json::from_str::<HarnessId>("\"agy\"").unwrap(),
        HarnessId::Antigravity
    );
    assert_eq!(
        serde_json::to_string(&HarnessId::Antigravity).unwrap(),
        "\"antigravity\""
    );
    assert!(serde_json::from_str::<HarnessId>("\"unknown\"").is_err());
}

/// Was `batch_launchers_require_windows_argv_adapter`, asserting
/// `unsupported_platform` — stale since `launch.rs`'s Windows batch-launcher
/// adapter landed: `plan_launch` now accepts a `.cmd`/`.bat` executable and
/// wraps it as `cmd.exe /d /c <script> <args...>` instead of refusing it.
#[cfg(windows)]
#[test]
fn batch_launchers_get_the_cmd_exe_argv_adapter() {
    let req = request(HarnessId::Pi);
    let plan = plan_launch(&req, Path::new(r"C:\tools\pi.cmd")).unwrap();
    assert!(plan.command.to_lowercase().ends_with("cmd.exe"));
    assert_eq!(plan.args[..3], ["/d", "/c", r"C:\tools\pi.cmd"]);
}

/// Host-gated (only runs on an actual Windows test runner, e.g. V5's — this
/// vertical has no Windows toolchain and cannot execute it): fidelity of a
/// `.cmd` launcher path carrying the characters `windows_batch_adapter`
/// explicitly treats as *safe* (spaces, parens, Unicode) versus ones it must
/// refuse (a literal quote). Never spawns `cmd.exe` or the script — every
/// assertion is against the computed `HarnessLaunchPlan` alone, so a
/// maliciously-crafted fixture path can never actually be executed by this
/// test.
#[cfg(windows)]
#[test]
fn cmd_fixture_path_preserves_safe_character_fidelity_and_refuses_a_quote() {
    let safe_path = Path::new(r"C:\Program Files (x86)\tools café 日本語\pi.cmd");
    let req = request(HarnessId::Pi);
    let plan = plan_launch(&req, safe_path).unwrap();
    assert!(plan.command.to_lowercase().ends_with("cmd.exe"));
    assert_eq!(
        plan.args[..3],
        [
            "/d",
            "/c",
            r"C:\Program Files (x86)\tools café 日本語\pi.cmd"
        ],
        "spaces, parens and non-ASCII must survive byte-for-byte, unescaped and unmangled"
    );

    let quoted_path = Path::new(r#"C:\tools\pi "quoted".cmd"#);
    assert!(
        plan_launch(&req, quoted_path).is_err(),
        "a literal quote is a cmd.exe metacharacter this adapter must refuse, not pass through"
    );
}

/// Host-gated for the same reason as above. A newline-bearing prompt must
/// still be refused for a `.cmd` launcher (there is no safe argv escape for
/// it), but with a message scoped to the prompt and its real fix — stdin
/// delivery post-spawn — rather than the generic per-token safety message,
/// per this vertical's rationale in `launch.rs`.
#[cfg(windows)]
#[test]
fn cmd_launcher_refuses_a_newline_bearing_prompt_with_a_scoped_rationale() {
    let mut req = request(HarnessId::Pi);
    req.prompt = Some("line one\nline two".into());
    let err = plan_launch(&req, Path::new(r"C:\tools\pi.cmd")).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    assert!(
        err.message.contains("session.write"),
        "the error must name the real fix (post-spawn stdin delivery), not just say \
         'unsafe characters': got {:?}",
        err.message
    );
}
