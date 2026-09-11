use drogon_harness::{HarnessAvailability, HarnessId, discover};
#[cfg(windows)]
use drogon_harness::{HarnessLaunchRequest, PermissionMode, plan_launch};

#[test]
fn absent_path_does_not_search_current_directory() {
    assert!(
        discover(None)
            .iter()
            .all(|item| item.availability == HarnessAvailability::Missing)
    );
    assert!(
        discover(Some(std::ffi::OsStr::new(".")))
            .iter()
            .all(|item| item.availability == HarnessAvailability::Missing)
    );
}

#[cfg(unix)]
#[test]
fn executable_discovery_never_runs_or_installs_the_harness() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let fake = temp.path().join("pi");
    std::fs::write(&fake, "#!/bin/sh\nexit 99\n").unwrap();
    let search = std::env::join_paths([temp.path()]).unwrap();
    assert_eq!(
        discover(Some(&search))[1].availability,
        HarnessAvailability::Missing
    );
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o700)).unwrap();
    let entries = discover(Some(&search));
    let pi = entries
        .iter()
        .find(|item| item.harness_id == HarnessId::Pi)
        .unwrap();
    assert_eq!(pi.availability, HarnessAvailability::Available);
    assert_eq!(
        pi.executable.as_ref().unwrap(),
        &std::fs::canonicalize(fake).unwrap()
    );
    assert_eq!(
        entries
            .iter()
            .filter(|item| item.availability == HarnessAvailability::Available)
            .count(),
        1
    );
}

/// Pins the held gate: discovery must keep tagging a `.cmd`/`.bat` shim
/// `UnsupportedLauncher` (fail-closed) even though `launch.rs`'s adapter can
/// build it a plan on its own — `drogon-core::resolve_launch` (out of this
/// crate's scope) is what actually refuses `UnsupportedLauncher` before ever
/// calling `plan_launch`. Do not read `plan_launch(..).is_ok()` below as
/// "the gate is lifted": it's the opposite lesson — the fail-closed
/// behavior lives entirely in discovery's availability tag, so this test
/// exists to catch anyone tempted to flip it to `Available`.
#[cfg(windows)]
#[test]
fn cmd_shim_is_unsupported_at_discovery_though_plan_launch_alone_would_wrap_it() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("pi.cmd"), "@echo off\r\n").unwrap();
    let search = std::env::join_paths([temp.path()]).unwrap();

    let entries = discover(Some(&search));
    let pi = entries
        .iter()
        .find(|item| item.harness_id == HarnessId::Pi)
        .unwrap();
    assert_eq!(pi.availability, HarnessAvailability::UnsupportedLauncher);

    let executable = pi.executable.clone().unwrap();
    let req = HarnessLaunchRequest {
        harness_id: HarnessId::Pi,
        model: None,
        effort: None,
        provider: None,
        prompt: None,
        permission_mode: PermissionMode::Inherit,
        headless: false,
        resume: false,
        agent_session_id: None,
        agent_session_transcript_path: None,
    };
    assert!(plan_launch(&req, &executable).is_ok());
}

#[cfg(unix)]
#[test]
fn directory_named_like_harness_is_not_an_executable() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::create_dir(temp.path().join("claude")).unwrap();
    let search = std::env::join_paths([temp.path()]).unwrap();
    assert!(
        discover(Some(&search))
            .iter()
            .all(|item| item.availability == HarnessAvailability::Missing)
    );
}
