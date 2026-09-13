#![cfg(windows)]

use std::io;

fn assert_lock_held(error: io::Error) {
    assert_eq!(error.kind(), io::ErrorKind::AddrInUse);
    assert!(
        error
            .to_string()
            .contains("another drogond instance already holds")
    );
}

#[test]
fn daemon_and_restore_locks_interoperate_in_both_orders() {
    let dir = tempfile::tempdir().unwrap();

    let daemon = drogond::lock::acquire_exclusive(dir.path()).unwrap();
    assert_lock_held(
        drogon_core::backups::lock::acquire_exclusive(dir.path())
            .err()
            .expect("restore lock must refuse the daemon holder"),
    );
    drop(daemon);

    let restore = drogon_core::backups::lock::acquire_exclusive(dir.path()).unwrap();
    assert_lock_held(
        drogond::lock::acquire_exclusive(dir.path())
            .err()
            .expect("daemon lock must refuse the restore holder"),
    );
    drop(restore);
}

#[test]
fn neither_windows_lock_follows_a_symlinked_lock_file() {
    use std::os::windows::fs::symlink_file;

    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("unrelated");
    std::fs::write(&target, "preserve").unwrap();
    symlink_file(&target, dir.path().join(drogond::lock::LOCK_FILE_NAME)).unwrap();

    assert!(drogond::lock::acquire_exclusive(dir.path()).is_err());
    assert!(drogon_core::backups::lock::acquire_exclusive(dir.path()).is_err());
    assert_eq!(std::fs::read_to_string(target).unwrap(), "preserve");
}
