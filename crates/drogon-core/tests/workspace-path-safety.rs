// APFS refuses these names at creation; Linux exercises the real non-UTF-8 target.
#![cfg(target_os = "linux")]

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::json;
use std::ffi::OsString;
use std::os::unix::{ffi::OsStringExt, fs::symlink};

#[test]
fn valid_utf8_alias_cannot_register_a_lossy_non_utf8_target() {
    let fixture = tempfile::tempdir().unwrap();
    let data = fixture.path().join("data");
    let engine = Engine::open(&data).unwrap();
    let target = fixture
        .path()
        .join(OsString::from_vec(b"workspace-\xff".to_vec()));
    std::fs::create_dir(&target).unwrap();
    let alias = fixture.path().join("workspace-alias");
    symlink(&target, &alias).unwrap();
    let response = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: "registration".into(),
        auth: None,
        method: "workspace.register".into(),
        params: json!({"path":alias}),
    });
    assert_eq!(response.error.unwrap().code, "invalid_argument");
    let rows = engine
        .dispatch(Request {
            protocol: PROTOCOL_VERSION,
            request_id: "list".into(),
            auth: None,
            method: "workspace.list".into(),
            params: json!({}),
        })
        .result
        .unwrap();
    assert!(rows["workspaces"].as_array().unwrap().is_empty());
}
