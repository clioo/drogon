#![cfg(unix)]

use drogon_core::{DB_FILE_NAME, Engine};
use std::os::unix::fs::{PermissionsExt, symlink};

#[test]
fn directory_alias_is_resolved_without_allowing_a_symlinked_data_directory() {
    let fixture = tempfile::tempdir().unwrap();
    let parent = fixture.path().join("parent");
    std::fs::create_dir(&parent).unwrap();
    let alias = fixture.path().join("parent-alias");
    symlink(&parent, &alias).unwrap();
    assert!(Engine::open(&alias.join("data")).is_ok());
    assert!(parent.join("data").join(DB_FILE_NAME).is_file());
}

#[test]
fn database_symlinks_and_sidecars_cannot_mutate_an_external_target() {
    for name in [
        DB_FILE_NAME,
        "drogon.sqlite3-wal",
        "drogon.sqlite3-shm",
        "drogon.sqlite3-journal",
    ] {
        let fixture = tempfile::tempdir().unwrap();
        let data = fixture.path().join("data");
        std::fs::create_dir(&data).unwrap();
        let external = fixture.path().join("external");
        std::fs::write(&external, b"untouched fixture").unwrap();
        std::fs::set_permissions(&external, std::fs::Permissions::from_mode(0o644)).unwrap();
        symlink(&external, data.join(name)).unwrap();
        assert!(Engine::open(&data).is_err(), "must refuse {name}");
        assert_eq!(std::fs::read(&external).unwrap(), b"untouched fixture");
        assert_eq!(
            std::fs::metadata(&external).unwrap().permissions().mode() & 0o777,
            0o644
        );
        if name != DB_FILE_NAME {
            assert!(
                !data.join(DB_FILE_NAME).exists(),
                "validate before opening SQLite"
            );
        }
    }
}

#[test]
fn hard_linked_database_and_non_file_path_are_refused() {
    let fixture = tempfile::tempdir().unwrap();
    let data = fixture.path().join("data");
    std::fs::create_dir(&data).unwrap();
    let external = fixture.path().join("external");
    std::fs::write(&external, b"untouched fixture").unwrap();
    std::fs::hard_link(&external, data.join(DB_FILE_NAME)).unwrap();
    assert!(Engine::open(&data).is_err());
    assert_eq!(std::fs::read(&external).unwrap(), b"untouched fixture");
    let second = fixture.path().join("other-data");
    std::fs::create_dir_all(second.join(DB_FILE_NAME)).unwrap();
    assert!(Engine::open(&second).is_err());
}
