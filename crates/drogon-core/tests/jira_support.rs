//! Shared support for the Jira fixture integration tests (R17-A): spawns
//! the committed fake Jira server (`scripts/fixtures/jira/fake-jira-server.mjs`)
//! on an ephemeral port and drives an `Engine` in a temp data dir.
//!
//! HARD RULE: every test here talks ONLY to the fixture. No real Atlassian
//! site is ever contacted, and no real credential is read or written — the
//! fixture token is the literal string `fixture-token`.
#![allow(dead_code)]

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use drogon_core::Engine;
use drogon_protocol::{Request, Response, RpcError};
use serde_json::{Value, json};
use tempfile::TempDir;

pub const FIXTURE_TOKEN: &str = "fixture-token";
pub const FIXTURE_EMAIL: &str = "carlos@example.com";

/// Guard that kills the fixture child on drop (process hygiene: every
/// fixture a test starts dies with it).
pub struct FixtureServer {
    child: Child,
    pub port: u16,
    /// The fixture appends one JSON line per handled request; tests read
    /// it back to assert the exact endpoint/JQL/fields the daemon sent.
    log_dir: TempDir,
}

impl Default for FixtureServer {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for FixtureServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn node_bin() -> String {
    std::env::var("DROGON_TEST_NODE").unwrap_or_else(|_| "node".to_string())
}

pub fn fixture_server() -> FixtureServer {
    FixtureServer::new()
}

impl FixtureServer {
    pub fn new() -> Self {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let script = manifest
            .join("../..")
            .canonicalize()
            .expect("repo root")
            .join("scripts/fixtures/jira/fake-jira-server.mjs");
        let log_dir = TempDir::new().expect("fixture log dir");
        let log_path = log_dir.path().join("requests.jsonl");
        let mut child = Command::new(node_bin())
            .arg(&script)
            .arg("--port")
            .arg("0")
            .arg("--log")
            .arg(&log_path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn fake jira server (node must be on PATH or DROGON_TEST_NODE)");
        let stdout = child.stdout.take().expect("fixture stdout");
        let mut lines = BufReader::new(stdout).lines();
        let line = lines
            .next()
            .expect("fixture LISTEN line")
            .expect("fixture LISTEN line read");
        let port: u16 = line
            .trim()
            .strip_prefix("LISTEN ")
            .expect("LISTEN prefix")
            .parse()
            .expect("port number");
        FixtureServer {
            child,
            port,
            log_dir,
        }
    }
}

impl FixtureServer {
    pub fn site_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// Every request line the fixture has logged (oldest first).
    pub fn request_log(&self) -> Vec<serde_json::Value> {
        let path = self.log_dir.path().join("requests.jsonl");
        let Ok(text) = std::fs::read_to_string(&path) else {
            return Vec::new();
        };
        text.lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| serde_json::from_str(line).expect("log line json"))
            .collect()
    }

    /// The most recent search request line ({path, jql, maxResults, fields}).
    pub fn last_search_request(&self) -> serde_json::Value {
        self.request_log()
            .into_iter()
            .rev()
            .find(|entry| entry.get("jql").is_some())
            .expect("at least one search request logged")
    }
}

pub struct TestContext {
    pub engine: Engine,
    pub dir: TempDir,
}

impl TestContext {
    pub fn open() -> Self {
        let dir = TempDir::new().expect("temp data dir");
        let engine = Engine::open(dir.path()).expect("open engine");
        Self { engine, dir }
    }

    pub fn jira_dir(&self) -> PathBuf {
        self.dir.path().join("integrations").join("jira")
    }

    pub fn call(&self, method: &str, params: Value) -> Response {
        self.engine.dispatch(Request {
            protocol: 1,
            request_id: "test-1".to_string(),
            auth: None,
            method: method.to_string(),
            params,
        })
    }

    pub fn ok(&self, method: &str, params: Value) -> Value {
        let response = self.call(method, params);
        assert!(
            response.ok,
            "{method} should succeed, got {:?}",
            response.error
        );
        response.result.expect("success result")
    }

    pub fn err(&self, method: &str, params: Value) -> RpcError {
        let response = self.call(method, params);
        assert!(
            !response.ok,
            "{method} should fail, got {:?}",
            response.result
        );
        response.error.expect("failure error")
    }

    /// Connect to the fixture exactly like the renderer would.
    pub fn connect(&self, server: &FixtureServer) -> Value {
        self.ok(
            "jira.connect",
            json!({
                "siteUrl": server.site_url(),
                "email": FIXTURE_EMAIL,
                "apiToken": FIXTURE_TOKEN,
            }),
        )
    }
}

/// True when the token file on disk is sealed (not plaintext).
pub fn token_files_sealed(jira_dir: &Path) -> bool {
    let tokens = jira_dir.join("tokens");
    let entries: Vec<_> = std::fs::read_dir(&tokens)
        .expect("token dir")
        .map(|entry| entry.expect("entry").path())
        .collect();
    assert!(!entries.is_empty(), "at least one token file must exist");
    entries.iter().all(|path| {
        let raw = std::fs::read(path).expect("token file");
        raw.starts_with(b"v1.")
    })
}
