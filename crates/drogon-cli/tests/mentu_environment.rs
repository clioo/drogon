//! `drogon-cli mentu status` against a real `drogond` in a temp data dir.
//! No mocks: the CLI binary drives the real daemon binary, so the verdict
//! comes from the daemon's own filesystem probe of the pinned runtime. A
//! host without a provisioned runtime must answer `not_installed` — the
//! whole point of the verb is that it never guesses.

#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;

const READY_TIMEOUT: Duration = Duration::from_secs(15);
const POLL_INTERVAL: Duration = Duration::from_millis(25);

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crates/drogon-cli has a parent")
        .parent()
        .expect("crates/ has a parent")
        .to_path_buf()
}

/// Builds `drogond` (already built by sibling tests in a normal run) and
/// returns its path next to the CLI binary.
fn build_drogond() -> PathBuf {
    let cli_path = PathBuf::from(env!("CARGO_BIN_EXE_drogon-cli"));
    let target_dir = cli_path
        .parent()
        .expect("drogon-cli binary path has a parent directory")
        .to_path_buf();
    let drogond_path = target_dir.join("drogond");
    // The sibling terminal_wait suite builds this; only build when absent so
    // a lone `--test mentu_environment` run still works.
    if !drogond_path.is_file() {
        let status = Command::new("cargo")
            .args(["build", "--locked", "-p", "drogond"])
            .current_dir(workspace_root())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("spawn cargo build -p drogond");
        assert!(status.success(), "cargo build -p drogond --locked failed");
    }
    assert!(
        drogond_path.is_file(),
        "expected drogond at {}",
        drogond_path.display()
    );
    drogond_path
}

struct Daemon {
    data_dir: PathBuf,
    child: Child,
}

impl Daemon {
    fn start(drogond_path: &Path, data_dir: &Path) -> Daemon {
        let child = Command::new(drogond_path)
            .arg("--data-dir")
            .arg(data_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn drogond");
        let daemon = Daemon {
            data_dir: data_dir.to_path_buf(),
            child,
        };
        daemon.wait_ready();
        daemon
    }

    fn wait_ready(&self) {
        let start = Instant::now();
        loop {
            let probe = run_cli(&self.data_dir, &["--json", "status"]);
            if probe.status.success() {
                return;
            }
            assert!(
                start.elapsed() <= READY_TIMEOUT,
                "drogond did not become ready within {READY_TIMEOUT:?}"
            );
            std::thread::sleep(POLL_INTERVAL);
        }
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        // Teardown on success, failure and timeout alike.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn run_cli(data_dir: &Path, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_drogon-cli"))
        .args(args)
        .env("DROGON_DATA_DIR", data_dir)
        .env_remove("DROGON_DISPATCH_CAPABILITY")
        .env_remove("DROGON_MENTU_RUNTIME")
        .output()
        .expect("spawn drogon-cli")
}

#[test]
fn mentu_status_reports_the_real_daemon_verdict_and_never_guesses() {
    let hold = tempfile::tempdir().expect("tempdir");
    let data_dir = hold.path().join("data");
    let daemon = Daemon::start(&build_drogond(), &data_dir);

    let out = run_cli(&data_dir, &["--json", "mentu", "status"]);
    assert!(
        out.status.success(),
        "mentu status failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let envelope: Value = serde_json::from_slice(&out.stdout).expect("mentu status JSON envelope");
    assert_eq!(envelope["ok"], true);
    let verdict = envelope["result"]["verdict"]
        .as_str()
        .expect("verdict string");

    // The runtime is pinned by sha256: whatever this checkout has staged,
    // the verdict must agree with the daemon's own digest report rather
    // than with an assumption about the host.
    let runtime = &envelope["result"]["runtime"];
    match verdict {
        "installed" => {
            assert_eq!(runtime["available"], true, "{envelope:#}");
            assert_eq!(runtime["lockMatches"], true, "{envelope:#}");
            assert!(runtime["version"].is_string(), "{envelope:#}");
        }
        "not_installed" => {
            assert_eq!(runtime["actualSha256"], Value::Null, "{envelope:#}");
            assert_eq!(runtime["available"], false, "{envelope:#}");
        }
        "partially_available" => {
            assert!(
                runtime["actualSha256"].is_string(),
                "partially available means bytes exist: {envelope:#}"
            );
        }
        other => panic!("unexpected verdict {other}: {envelope:#}"),
    }

    // A workspace with no `.mentu/recipes` must report zero recipes — not an
    // error and not an invented count.
    let workspace_dir = hold.path().join("plain");
    std::fs::create_dir_all(&workspace_dir).expect("create workspace dir");
    let added = run_cli(
        &data_dir,
        &[
            "--json",
            "workspace",
            "add",
            workspace_dir.to_str().expect("utf8"),
        ],
    );
    assert!(added.status.success());
    let added: Value = serde_json::from_slice(&added.stdout).expect("workspace add envelope");
    let workspace_id = added["result"]["id"].as_str().expect("workspace id");

    let scoped = run_cli(
        &data_dir,
        &["--json", "mentu", "status", "--workspace", workspace_id],
    );
    assert!(
        scoped.status.success(),
        "scoped mentu status failed: {}",
        String::from_utf8_lossy(&scoped.stderr)
    );
    let scoped: Value = serde_json::from_slice(&scoped.stdout).expect("scoped envelope");
    assert_eq!(scoped["result"]["verdict"], verdict);
    assert_eq!(scoped["result"]["workspace"]["id"], workspace_id);
    assert_eq!(scoped["result"]["workspace"]["recipes"]["total"], 0);
    assert_eq!(scoped["result"]["workspace"]["recipes"]["valid"], 0);

    // Human output leads with the verdict word.
    let human = run_cli(&data_dir, &["mentu", "status"]);
    let text = String::from_utf8_lossy(&human.stdout);
    assert!(
        text.starts_with(&format!("Mentu environment: {verdict}")),
        "stdout: {text}"
    );

    drop(daemon);
}
