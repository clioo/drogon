//! The daemon-level downgrade refusal (R16-BP): when a data dir was written
//! by a newer build, `drogond`'s engine-open path must fail with a message
//! that carries the uniform "is newer than" marker *and* names the data
//! dir — that one stderr line is what the desktop bootstrap classifies into
//! the renderer's downgrade dialog. Unix-only like the engine suites.

#![cfg(unix)]

use std::path::PathBuf;

use drogond::ServeError;
use rusqlite::Connection;

#[test]
fn engine_open_refusal_names_the_data_dir() {
    let dir = tempfile::Builder::new()
        .prefix("drogond-refusal-")
        .tempdir()
        .unwrap();
    Connection::open(dir.path().join("drogon.sqlite3"))
        .unwrap()
        .execute_batch(
            "CREATE TABLE schema_versions (component TEXT PRIMARY KEY, version INTEGER NOT NULL);
             INSERT INTO schema_versions(component, version) VALUES ('bots', 99);",
        )
        .unwrap();
    let error = drogond::open_engine_naming_data_dir(dir.path())
        .err()
        .expect("a data dir written by a newer build must be refused");
    let ServeError::Engine(rpc) = error else {
        panic!("expected the engine error variant, got {error:?}");
    };
    let expected_dir: PathBuf = dir.path().to_path_buf();
    assert!(
        rpc.message.contains("is newer than"),
        "uniform refusal copy missing: {}",
        rpc.message
    );
    assert!(
        rpc.message
            .contains(expected_dir.to_string_lossy().as_ref()),
        "refusal must name the data dir: {}",
        rpc.message
    );
}

#[test]
fn engine_open_success_is_untouched_by_the_wrapper() {
    let dir = tempfile::Builder::new()
        .prefix("drogond-open-ok-")
        .tempdir()
        .unwrap();
    drogond::open_engine_naming_data_dir(dir.path()).expect("a fresh data dir opens fine");
}

#[allow(dead_code)]
fn _shape(error: &drogond::ServeError) -> String {
    format!("{error}")
}
