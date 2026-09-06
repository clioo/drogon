use drogon_harness::{HarnessAvailability, HarnessId, discover};

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
