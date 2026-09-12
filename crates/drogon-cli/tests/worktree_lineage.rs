//! Real `drogond` + real `drogon-cli`, no mock: a worktree that an agent
//! creates from inside its Drogon session must nest under that session's
//! worktree, because that is how a subagent's worktree belongs under its
//! coordinator in the sidebar.
//!
//! The exact user flow is exercised end to end: a PTY session started in
//! the coordinator's worktree runs `drogon-cli worktree create` with only
//! the environment the daemon exports into every session
//! (`DROGON_WORKSPACE_ID`, `DROGON_DATA_DIR`), and the daemon's own
//! `worktree.list` is the oracle for the recorded `parentWorktreeId`. The
//! cwd, `--parent` and `--no-parent` paths run against the same daemon.

#![cfg(unix)]

mod common;

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;

use common::{run_cli, run_cli_in, stderr, stdout};

const READY_TIMEOUT: Duration = Duration::from_secs(15);
const SESSION_TIMEOUT: Duration = Duration::from_secs(30);
const POLL_INTERVAL: Duration = Duration::from_millis(50);

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crates/drogon-cli has a parent")
        .parent()
        .expect("crates/ has a parent")
        .to_path_buf()
}

/// Builds the real `drogond` (a sibling crate's binary, so not available as
/// `CARGO_BIN_EXE_*` here) next to the already-built `drogon-cli`.
fn build_drogond() -> PathBuf {
    let output = Command::new("cargo")
        .args(["build", "--locked", "-p", "drogond"])
        .current_dir(workspace_root())
        .stdin(Stdio::null())
        .output()
        .expect("spawn cargo build -p drogond");
    assert!(
        output.status.success(),
        "cargo build -p drogond --locked failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let drogond = Path::new(env!("CARGO_BIN_EXE_drogon-cli"))
        .parent()
        .expect("drogon-cli binary has a parent directory")
        .join("drogond");
    assert!(drogond.is_file(), "expected {}", drogond.display());
    drogond
}

struct Daemon {
    data_dir: PathBuf,
    child: Child,
}

impl Daemon {
    fn start(drogond: &Path, data_dir: &Path) -> Daemon {
        let child = Command::new(drogond)
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
        let start = Instant::now();
        loop {
            if daemon.data_dir.join("runtime-v1.sock").exists()
                && daemon.data_dir.join("auth.token").exists()
                && run_cli(&daemon.data_dir, &["--json", "status"])
                    .status
                    .success()
            {
                return daemon;
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
        // Exact release of the one process this test owns; sessions it
        // spawned have already been waited to `exited` above.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args([
            "-c",
            "user.name=Drogon",
            "-c",
            "user.email=drogon@example.invalid",
        ])
        .args(args)
        .current_dir(dir)
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .status()
        .expect("spawn git");
    assert!(status.success(), "git {args:?} failed");
}

fn init_repo(dir: &Path) {
    std::fs::create_dir_all(dir).expect("repo dir");
    git(dir, &["init", "-q", "-b", "main"]);
    std::fs::write(dir.join("README.md"), "lineage fixture\n").expect("seed file");
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-q", "-m", "init"]);
}

/// Runs the CLI outside any session context: a cwd that is no worktree
/// and an empty `DROGON_WORKSPACE_ID`, whatever the test runner's own
/// shell exported.
fn outside(data_dir: &Path, cwd: &Path, args: &[&str]) -> std::process::Output {
    let mut full = vec!["--json"];
    full.extend_from_slice(args);
    run_cli_in(data_dir, cwd, &full, &[("DROGON_WORKSPACE_ID", "")])
}

fn ok_result(output: &std::process::Output, what: &str) -> Value {
    assert_eq!(
        output.status.code(),
        Some(0),
        "{what}: stdout={} stderr={}",
        stdout(output),
        stderr(output)
    );
    let envelope: Value = serde_json::from_str(&stdout(output))
        .unwrap_or_else(|err| panic!("{what}: not JSON ({err}): {}", stdout(output)));
    assert_eq!(envelope["ok"], true, "{what}: {envelope}");
    envelope["result"].clone()
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key]
        .as_str()
        .unwrap_or_else(|| panic!("missing {key} in {value}"))
}

fn wait_for_file(path: &Path, timeout: Duration) {
    let start = Instant::now();
    while !path.is_file() {
        assert!(
            start.elapsed() <= timeout,
            "{} did not appear within {timeout:?}",
            path.display()
        );
        std::thread::sleep(POLL_INTERVAL);
    }
}

fn shell_quote(path: &Path) -> String {
    format!("'{}'", path.to_str().unwrap().replace('\'', "'\\''"))
}

#[test]
fn a_worktree_created_from_inside_a_session_nests_under_that_sessions_worktree() {
    let drogond = build_drogond();
    // Short prefix on purpose: the daemon socket lives under this
    // directory and macOS caps unix socket paths at 104 bytes.
    let scratch = tempfile::Builder::new()
        .prefix("dl-")
        .tempdir()
        .expect("scratch tempdir");
    let data_dir = scratch.path().join("data");
    let elsewhere = scratch.path().join("elsewhere");
    std::fs::create_dir_all(&elsewhere).unwrap();
    let repo = scratch.path().join("repo");
    init_repo(&repo);
    let daemon = Daemon::start(&drogond, &data_dir);

    let project = ok_result(
        &outside(
            &data_dir,
            &elsewhere,
            &[
                "project",
                "add",
                repo.to_str().unwrap(),
                "--name",
                "lineage",
            ],
        ),
        "project add",
    );
    let project_id = text(&project, "id").to_string();

    // The coordinator's own worktree: top-level on purpose.
    let coordinator = ok_result(
        &outside(
            &data_dir,
            &elsewhere,
            &[
                "worktree",
                "create",
                "--project",
                &project_id,
                "--name",
                "coordinator",
                "--no-parent",
            ],
        ),
        "worktree create coordinator",
    );
    // The daemon reports a top-level worktree as an explicit null.
    assert!(coordinator["parentWorktreeId"].is_null(), "{coordinator}");
    let coordinator_id = text(&coordinator, "id").to_string();
    let coordinator_workspace = text(&coordinator, "workspaceId").to_string();
    let coordinator_path = PathBuf::from(text(&coordinator, "path"));
    assert!(coordinator_path.is_dir());

    // --- The user's flow: a session in the coordinator worktree creates
    // the subagent's worktree with nothing but the daemon-exported env. ---
    let out = scratch.path().join("subagent.json");
    let err = scratch.path().join("subagent.stderr");
    let done = scratch.path().join("subagent.done");
    let script = format!(
        "{cli} --json worktree create --project {project_id} --name subagent > {out} 2> {err}; echo $? > {out}.code; touch {done}",
        cli = shell_quote(Path::new(env!("CARGO_BIN_EXE_drogon-cli"))),
        out = shell_quote(&out),
        err = shell_quote(&err),
        done = shell_quote(&done),
    );
    let session = ok_result(
        &outside(
            &data_dir,
            &elsewhere,
            &[
                "terminal",
                "create",
                "--workspace",
                &coordinator_workspace,
                "--",
                "sh",
                "-c",
                &script,
            ],
        ),
        "terminal create",
    );
    wait_for_file(&done, SESSION_TIMEOUT);
    let session_stdout = std::fs::read_to_string(&out).expect("session stdout capture");
    let session_stderr = std::fs::read_to_string(&err).unwrap_or_default();
    let created: Value = serde_json::from_str(&session_stdout).unwrap_or_else(|e| {
        panic!(
            "session create output is not JSON ({e}): {session_stdout}\nstderr: {session_stderr}"
        )
    });
    assert_eq!(created["ok"], true, "{created}\nstderr: {session_stderr}");
    assert_eq!(
        created["result"]["parentWorktreeId"], coordinator_id,
        "a worktree created from inside the session nests under its worktree: {created}"
    );
    assert_eq!(created["result"]["creator"], "cli");
    assert!(
        session_stderr.trim().is_empty(),
        "a resolved parent is not a warning: {session_stderr}"
    );
    let subagent_path = PathBuf::from(text(&created["result"], "path"));
    assert!(subagent_path.join("README.md").is_file(), "real checkout");
    // The session's shell exits on its own once the script is done; wait
    // for the daemon to prove that before tearing anything down.
    ok_result(
        &outside(
            &data_dir,
            &elsewhere,
            &[
                "terminal",
                "wait",
                "--session",
                text(&session, "id"),
                "--incarnation",
                text(&session, "incarnation"),
                "--for",
                "exited",
                "--timeout-ms",
                "15000",
            ],
        ),
        "terminal wait exited",
    );

    // --- cwd inside the coordinator checkout, no session env: nests too. ---
    let from_cwd = ok_result(
        &outside(
            &data_dir,
            &coordinator_path,
            &[
                "worktree",
                "create",
                "--project",
                &project_id,
                "--name",
                "from-cwd",
            ],
        ),
        "worktree create from cwd",
    );
    assert_eq!(from_cwd["parentWorktreeId"], coordinator_id, "{from_cwd}");

    // --- explicit --parent by workspace id, from nowhere in particular. ---
    let explicit = ok_result(
        &outside(
            &data_dir,
            &elsewhere,
            &[
                "worktree",
                "create",
                "--project",
                &project_id,
                "--name",
                "explicit",
                "--parent",
                &coordinator_workspace,
            ],
        ),
        "worktree create --parent",
    );
    assert_eq!(explicit["parentWorktreeId"], coordinator_id, "{explicit}");

    // --- --no-parent from inside the checkout stays top-level. ---
    let standalone = ok_result(
        &outside(
            &data_dir,
            &coordinator_path,
            &[
                "worktree",
                "create",
                "--project",
                &project_id,
                "--name",
                "standalone",
                "--no-parent",
            ],
        ),
        "worktree create --no-parent",
    );
    assert!(standalone["parentWorktreeId"].is_null(), "{standalone}");

    // --- a parent the project does not have is refused before any checkout. ---
    let refused = outside(
        &data_dir,
        &elsewhere,
        &[
            "worktree",
            "create",
            "--project",
            &project_id,
            "--name",
            "orphan",
            "--parent",
            "not-a-worktree",
        ],
    );
    assert_eq!(
        refused.status.code(),
        Some(1),
        "stderr: {}",
        stderr(&refused)
    );
    let envelope: Value = serde_json::from_str(&stdout(&refused)).expect("failure envelope");
    assert_eq!(envelope["ok"], false);
    assert_eq!(envelope["error"]["code"], "invalid_argument");

    // --- The daemon's rows are the sidebar's source of truth. ---
    let listed = ok_result(
        &outside(
            &data_dir,
            &elsewhere,
            &["worktree", "list", "--project", &project_id],
        ),
        "worktree list",
    );
    let rows = listed["worktrees"].as_array().expect("worktrees array");
    let parent_of = |branch: &str| -> Option<String> {
        let row = rows
            .iter()
            .find(|row| row["branch"] == branch)
            .unwrap_or_else(|| panic!("worktree {branch} is listed: {listed}"));
        row["parentWorktreeId"].as_str().map(str::to_string)
    };
    assert_eq!(parent_of("coordinator"), None);
    assert_eq!(
        parent_of("subagent").as_deref(),
        Some(coordinator_id.as_str())
    );
    assert_eq!(
        parent_of("from-cwd").as_deref(),
        Some(coordinator_id.as_str())
    );
    assert_eq!(
        parent_of("explicit").as_deref(),
        Some(coordinator_id.as_str())
    );
    assert_eq!(parent_of("standalone"), None);
    assert!(
        !rows.iter().any(|row| row["branch"] == "orphan"),
        "a refused create checks nothing out: {listed}"
    );

    drop(daemon);
}
