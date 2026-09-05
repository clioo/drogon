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
fn opencode_prompt_that_looks_like_a_flag_is_one_option_value() {
    let mut req = request(HarnessId::Opencode);
    req.prompt = Some("--model another-model".into());
    assert_eq!(
        plan_launch(&req, executable()).unwrap().args,
        ["--prompt=--model another-model"]
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

#[cfg(windows)]
#[test]
fn batch_launchers_require_windows_argv_adapter() {
    let req = request(HarnessId::Pi);
    assert_eq!(
        plan_launch(&req, Path::new(r"C:\tools\pi.cmd"))
            .err()
            .unwrap()
            .code,
        "unsupported_platform"
    );
}
