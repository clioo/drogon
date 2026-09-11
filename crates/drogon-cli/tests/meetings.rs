//! Meetings (the owner's own Write That Down notes) end to end, through the
//! real `drogond` daemon and the real `drogon-cli` binary — the exact path a
//! Bot takes to discover the owner's conversations.
//!
//! Why macOS-gated: Write That Down is a macOS app, and the "installed"
//! signal is the app bundle under `/Applications` or `~/Applications`. The
//! fixtures below build a fixture `HOME` with a real (empty) bundle so the
//! installation state is deterministic instead of depending on whatever this
//! machine happens to have installed.
//!
//! What this file proves, and nothing weaker:
//! 1. Discovery: `drogon-cli meeting list --json` returns the fixture notes
//!    newest-first, with paging, and never invents meetings.
//! 2. Honest states: the same daemon answers "the folder does not exist",
//!    "the folder is empty" and "these are the meetings" as three different
//!    answers while the directory is created and filled underneath it.
//! 3. Read-only: every note's bytes and mtime are unchanged after list+read,
//!    and an id outside the notes folder is refused.
//! 4. The Bot path: a fixture "harness" (an agent process in a real Drogon
//!    session) discovers meetings ONLY through `drogon-cli`, turns them into
//!    a morning brief with recommended actions, and that brief lands in the
//!    automation run the owner sees.

#![cfg(target_os = "macos")]

mod common;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;

use common::{stderr, stdout};

const BUILD_TIMEOUT: Duration = Duration::from_secs(300);
const READY_TIMEOUT: Duration = Duration::from_secs(30);

/// The fixture "morning brief" harness. It is a normal process launched into
/// a real Drogon session by the daemon's own session admission, so it sees
/// exactly what an agent sees: `DROGON_CLI_COMMAND` and `DROGON_DATA_DIR`.
/// It uses no model, no network and no credential — it reads the owner's
/// notes through the public CLI and prints a brief.
const FIXTURE_HARNESS: &str = r#"#!/bin/sh
set -eu
cli="${DROGON_CLI_COMMAND:-drogon-cli}"
meetings=$("$cli" --data-dir "$DROGON_DATA_DIR" --json meeting list --limit 20)
count=$(printf '%s' "$meetings" | grep -c '"id": "write-that-down:' || true)
first_id=$(printf '%s' "$meetings" | grep -o 'write-that-down:[^"]*' | head -1)
note=$("$cli" --data-dir "$DROGON_DATA_DIR" --json meeting read --id "$first_id")
echo "MORNING BRIEF"
echo "INDEXED=$count"
printf '%s' "$meetings" | grep -o '"title": "[^"]*"' | sed 's/.*"title": "//;s/"$//' | sed 's/^/MEETING /'
printf '%s' "$note" | grep -o '"title": "[^"]*"' | head -1 | sed 's/.*"title": "//;s/"$//' | sed 's/^/OPENED /'
printf '%s' "$note" | grep -o 'hola desde la reunion de hoy' | head -1 | sed 's/^/TRANSCRIPT /'
echo "RECOMMENDED ACTION: follow up on the action items from the latest meeting"
"#;

struct Fixture {
    root: tempfile::TempDir,
    data_dir: PathBuf,
    home: PathBuf,
    notes: PathBuf,
    bin: PathBuf,
    daemon: Option<Child>,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().expect("temp root");
        let data_dir = root.path().join("data");
        let home = root.path().join("home");
        let notes = root.path().join("notes");
        let bin = root.path().join("bin");
        for dir in [&data_dir, &home, &bin] {
            std::fs::create_dir_all(dir).expect("fixture dir");
        }
        // A fixture Write That Down install (empty executable, never run):
        // the daemon only checks that the bundle and its executable exist.
        let bundle = home
            .join("Applications")
            .join("WriteThatDown.app")
            .join("Contents")
            .join("MacOS")
            .join("WriteThatDown");
        std::fs::create_dir_all(bundle.parent().unwrap()).expect("bundle dir");
        std::fs::write(&bundle, b"fixture").expect("bundle executable");
        // The fixture harness, named `pi` so the daemon's own harness
        // discovery finds it on PATH exactly like a real install.
        let harness = bin.join("pi");
        std::fs::write(&harness, FIXTURE_HARNESS).expect("harness script");
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&harness, std::fs::Permissions::from_mode(0o755))
            .expect("harness mode");
        // Write That Down's own configuration: `outputDir` is the notes
        // directory, resolved through the tool's documented precedence.
        let config = home
            .join("Library")
            .join("Application Support")
            .join("WriteThatDown");
        std::fs::create_dir_all(&config).expect("config dir");
        std::fs::write(
            config.join("config.json"),
            format!("{{\"outputDir\":\"{}\"}}\n", notes.display()),
        )
        .expect("config file");
        Self {
            root,
            data_dir,
            home,
            notes,
            bin,
            daemon: None,
        }
    }

    fn home_str(&self) -> String {
        self.home.to_string_lossy().into_owned()
    }

    fn notes_str(&self) -> String {
        self.notes.to_string_lossy().into_owned()
    }

    /// Writes one conversation document exactly as Write That Down writes it
    /// (`TranscriptWriter`): `# title`, `**Date:** YYYY-MM-DD HH:MM`,
    /// `**Duration:** N min` (or `recording…`), `## Transcript`, then
    /// timestamped lines.
    fn write_note(&self, date: &str, time_dash: &str, duration: &str, title: &str, body: &str) {
        let time_colon = format!("{}:{}", &time_dash[0..2], &time_dash[3..5]);
        let file = match duration {
            "recording…" => format!("{time_dash}_recording_.md"),
            other => format!("{time_dash}_{}.md", other.replace(" min", "min")),
        };
        let dir = self.notes.join(date);
        std::fs::create_dir_all(&dir).expect("date folder");
        std::fs::write(
            dir.join(&file),
            format!(
                "# {title}\n**Date:** {date} {time_colon}\n**Duration:** {duration}\n\n## Transcript\n\n{body}\n"
            ),
        )
        .expect("note");
    }

    fn start_daemon(&mut self, extra_env: &[(&str, &str)]) {
        let drogond = drogond_binary();
        let mut path_entries = vec![self.bin.clone()];
        path_entries.extend(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
        ));
        let mut command = Command::new(&drogond);
        command
            .arg("--data-dir")
            .arg(&self.data_dir)
            .env("HOME", &self.home)
            .env("PATH", std::env::join_paths(path_entries).expect("path"))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        for (key, value) in extra_env {
            command.env(key, value);
        }
        let child = command.spawn().expect("spawn drogond");
        self.daemon = Some(child);
        let deadline = Instant::now() + READY_TIMEOUT;
        while Instant::now() < deadline {
            let status = self.cli(&["status", "--json"]);
            if status.is_ok() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        panic!("drogond did not become ready within {READY_TIMEOUT:?}");
    }

    fn cli(&self, args: &[&str]) -> Result<Value, (i32, String, String)> {
        let mut command = Command::new(env!("CARGO_BIN_EXE_drogon-cli"));
        command.args(args).env("DROGON_DATA_DIR", &self.data_dir);
        let home = self.home_str();
        command.env("HOME", &home);
        let output = command.output().expect("spawn drogon-cli");
        let code = output.status.code().unwrap_or(-1);
        if !output.status.success() {
            return Err((code, stdout(&output), stderr(&output)));
        }
        let text = stdout(&output);
        let value = serde_json::from_str::<Value>(&text).unwrap_or_else(|err| {
            panic!(
                "drogon-cli {} did not print JSON: {err}\nstdout={text}",
                args.join(" ")
            )
        });
        Ok(value)
    }

    /// The `--json` form prints the whole validated wire envelope, so every
    /// assertion below reads `result` through this one accessor.
    fn cli_ok(&self, args: &[&str]) -> Value {
        let envelope = match self.cli(args) {
            Ok(value) => value,
            Err((code, out, err)) => {
                panic!(
                    "drogon-cli {} failed ({code}): {out}\n{err}",
                    args.join(" ")
                )
            }
        };
        assert_eq!(envelope["ok"], true, "expected ok for {args:?}: {envelope}");
        envelope["result"].clone()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(mut child) = self.daemon.take() {
            // Graceful first: the daemon shuts down on SIGTERM, which also
            // reaps the fixture sessions it spawned. Bounded wait, then a
            // confirmed kill of only this child.
            unsafe {
                libc_kill(child.id() as i32, 15);
            }
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) if Instant::now() < deadline => {
                        std::thread::sleep(Duration::from_millis(20))
                    }
                    _ => {
                        let _ = child.kill();
                        let _ = child.wait();
                        break;
                    }
                }
            }
        }
        let _ = &self.root;
    }
}

// SIGTERM without pulling in a signal crate.
unsafe extern "C" {
    #[link_name = "kill"]
    fn libc_kill(pid: i32, signal: i32) -> i32;
}

/// The daemon binary sits next to this test's own CLI binary once the
/// workspace has been built; build it on demand (bounded) exactly like
/// `native_dogfood.rs` does, so `cargo test -p drogon-cli` is self-contained.
fn drogond_binary() -> PathBuf {
    let cli_path = PathBuf::from(env!("CARGO_BIN_EXE_drogon-cli"));
    let target_dir = cli_path
        .parent()
        .expect("drogon-cli binary path has a parent directory")
        .to_path_buf();
    let drogond_path = target_dir.join("drogond");
    if drogond_path.is_file() {
        return drogond_path;
    }
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("workspace root")
        .to_path_buf();
    let mut child = Command::new(env!("CARGO"))
        .args(["build", "-p", "drogond", "--locked"])
        .current_dir(&repo_root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn cargo build -p drogond");
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait().expect("poll cargo build") {
            assert!(status.success(), "cargo build -p drogond --locked failed");
            break;
        }
        assert!(
            start.elapsed() < BUILD_TIMEOUT,
            "cargo build -p drogond --locked did not finish within {BUILD_TIMEOUT:?}"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(
        drogond_path.is_file(),
        "expected drogond at {}",
        drogond_path.display()
    );
    drogond_path
}

/// Recursive map of relative path -> (bytes, mtime) for the whole fixture
/// notes tree. The read-only leg compares two of these.
fn tree_snapshot(root: &Path) -> BTreeMap<String, (usize, std::time::SystemTime)> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, (usize, std::time::SystemTime)>) {
        for entry in std::fs::read_dir(dir).expect("read_dir") {
            let entry = entry.expect("entry");
            let path = entry.path();
            if path.is_dir() {
                walk(root, &path, out);
                continue;
            }
            let meta = std::fs::metadata(&path).expect("metadata");
            out.insert(
                path.strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                (meta.len() as usize, meta.modified().expect("mtime")),
            );
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

fn titles(list: &Value) -> Vec<String> {
    list["meetings"]
        .as_array()
        .expect("meetings array")
        .iter()
        .map(|meeting| meeting["title"].as_str().expect("title").to_string())
        .collect()
}

#[test]
fn meetings_are_indexed_honestly_and_never_written_to() {
    let mut fixture = Fixture::new();
    fixture.start_daemon(&[]);

    // The capability the desktop surface and the CLI both gate on.
    let status = fixture.cli_ok(&["status", "--json"]);
    let capabilities = status["capabilities"].as_array().expect("capabilities");
    assert!(
        capabilities.iter().any(|cap| cap == "meetings.v1"),
        "status must advertise meetings.v1: {capabilities:?}"
    );

    // (1) The notes directory does not exist yet. The honest answer names
    // the path; it is never an empty list implying "no meetings".
    let missing = fixture.cli_ok(&["meeting", "list", "--json"]);
    assert_eq!(
        missing["availability"]["transcriptRoot"],
        fixture.notes_str()
    );
    assert_eq!(missing["availability"]["transcriptRootSource"], "config");
    assert_eq!(missing["availability"]["transcriptRootState"], "missing");
    assert_eq!(missing["availability"]["installation"], "installed");
    assert_eq!(missing["availability"]["readOnly"], true);
    assert_eq!(missing["availability"]["reason"], "transcript-root-missing");
    assert_eq!(missing["total"], 0);
    assert_eq!(missing["meetings"].as_array().unwrap().len(), 0);

    // (2) The folder now exists and is empty: a different truth, and the
    // only one where "no meetings" is correct.
    std::fs::create_dir_all(&fixture.notes).expect("notes dir");
    let empty = fixture.cli_ok(&["meeting", "list", "--json"]);
    assert_eq!(empty["availability"]["reason"], "empty");
    assert_eq!(empty["availability"]["status"], "available");
    assert_eq!(empty["availability"]["transcriptRootState"], "readable");

    // (3) Populate it exactly as Write That Down does, including one file
    // that is not a conversation and one that fails to parse.
    fixture.write_note(
        "2026-09-09",
        "09-00",
        "12 min",
        "Yesterday retro",
        "[00:00] hola desde la reunion de ayer",
    );
    fixture.write_note(
        "2026-09-10",
        "08-05",
        "42 min",
        "Weekly sync",
        "[00:00] hola desde la reunion de hoy",
    );
    fixture.write_note(
        "2026-09-10",
        "15-30",
        "recording…",
        "Design review",
        "[00:00] hola desde la reunion en vivo",
    );
    std::fs::write(
        fixture.notes.join("2026-09-10").join("16-00_5min.md"),
        "# Broken\nno header at all\n",
    )
    .expect("malformed note");
    std::fs::write(
        fixture
            .notes
            .join("2026-09-10")
            .join("weekly-sync-summary.md"),
        "# Summary\nnot a conversation\r\n",
    )
    .expect("summary sidecar");
    std::fs::write(fixture.notes.join("README.md"), "# not a date folder\n").expect("readme");

    let before = tree_snapshot(&fixture.notes);

    let page = fixture.cli_ok(&["meeting", "list", "--json", "--limit", "2"]);
    assert_eq!(page["availability"]["reason"], "ready");
    assert_eq!(page["total"], 4);
    assert_eq!(page["limit"], 2);
    assert_eq!(page["offset"], 0);
    assert_eq!(page["hasMore"], true);
    assert_eq!(page["scanTruncated"], false);
    // Newest first: 16:00 failed, then the live 15:30 recording.
    assert_eq!(titles(&page), vec!["5min", "Design review"]);
    let failed = &page["meetings"][0];
    assert_eq!(failed["status"], "failed");
    assert_eq!(failed["failureReason"], "malformed-transcript");
    assert_eq!(failed["fileName"], "16-00_5min.md");
    assert!(
        failed["filePath"]
            .as_str()
            .unwrap()
            .starts_with(&fixture.notes_str()),
        "a failed file must be named by path: {failed:?}"
    );
    let live = &page["meetings"][1];
    assert_eq!(live["status"], "recording");
    assert!(live["durationMinutes"].is_null());
    assert_eq!(live["dateFolder"], "2026-09-10");

    let next = fixture.cli_ok(&["meeting", "list", "--json", "--limit", "2", "--offset", "2"]);
    assert_eq!(titles(&next), vec!["Weekly sync", "Yesterday retro"]);
    assert_eq!(next["hasMore"], false);

    let past_end = fixture.cli_ok(&["meeting", "list", "--json", "--offset", "50"]);
    assert_eq!(past_end["meetings"].as_array().unwrap().len(), 0);
    assert_eq!(past_end["availability"]["reason"], "ready");
    assert_eq!(past_end["total"], 4);

    // (4) Read one: the returned content is the file's content, byte for
    // byte, and the metadata matches the list row.
    let weekly = next["meetings"][0].clone();
    let weekly_id = weekly["id"].as_str().unwrap().to_string();
    let read = fixture.cli_ok(&["meeting", "read", "--json", "--id", &weekly_id]);
    let on_disk = std::fs::read_to_string(weekly["filePath"].as_str().unwrap()).unwrap();
    assert_eq!(read["content"], on_disk);
    assert_eq!(read["truncated"], false);
    assert_eq!(read["meeting"]["title"], "Weekly sync");
    assert_eq!(read["meeting"]["durationMinutes"], 42);
    assert!(
        read["meeting"]["excerpt"]
            .as_str()
            .unwrap()
            .contains("hola desde la reunion de hoy"),
        "the list excerpt must come from the transcript body: {read:?}"
    );

    // (5) Records still have their date and time.
    assert_eq!(read["meeting"]["startedAt"], "2026-09-10 08:05");

    // (6) An id outside the notes folder is refused: the id is not a
    // general-purpose file read.
    let outside = fixture
        .cli(&[
            "meeting",
            "read",
            "--json",
            "--id",
            "write-that-down:/etc/hosts",
        ])
        .expect_err("an id outside the notes folder must fail");
    assert_eq!(outside.0, 1);
    assert!(
        outside.1.contains("meeting_outside_root") || outside.1.contains("unknown_meeting"),
        "expected an honest refusal, got: {}",
        outside.1
    );

    // (7) Nothing was written: same paths, same sizes, same mtimes.
    let after = tree_snapshot(&fixture.notes);
    assert_eq!(before, after, "indexing must never touch the notes");
}

#[test]
fn an_environment_output_dir_overrides_the_tool_configuration() {
    let mut fixture = Fixture::new();
    let elsewhere = fixture.root.path().join("from-env");
    std::fs::create_dir_all(elsewhere.join("2026-09-10")).expect("env notes dir");
    std::fs::write(
        elsewhere
            .join("2026-09-10")
            .join("10-00_5min.md"),
        "# Env meeting\n**Date:** 2026-09-10 10:00\n**Duration:** 5 min\n\n## Transcript\n\nonly here\n",
    )
    .expect("env note");
    let elsewhere_str = elsewhere.to_string_lossy().into_owned();
    fixture.start_daemon(&[("WTD_OUTPUT_DIR", elsewhere_str.as_str())]);

    let list = fixture.cli_ok(&["meeting", "list", "--json"]);
    assert_eq!(list["availability"]["transcriptRoot"], elsewhere_str);
    assert_eq!(list["availability"]["transcriptRootSource"], "environment");
    assert_eq!(list["availability"]["reason"], "ready");
    assert_eq!(titles(&list), vec!["Env meeting"]);
}

#[test]
fn a_bot_discovers_meetings_and_ships_a_morning_brief() {
    let mut fixture = Fixture::new();
    fixture.write_note(
        "2026-09-09",
        "09-00",
        "12 min",
        "Yesterday retro",
        "[00:00] hola desde la reunion de ayer",
    );
    fixture.write_note(
        "2026-09-10",
        "08-05",
        "42 min",
        "Weekly sync",
        "[00:00] hola desde la reunion de hoy",
    );
    fixture.start_daemon(&[]);

    // A workspace for the automation to run in.
    let work = fixture.root.path().join("work");
    std::fs::create_dir_all(&work).expect("work dir");
    let workspace = fixture.cli_ok(&[
        "workspace",
        "add",
        work.to_string_lossy().as_ref(),
        "--json",
    ]);
    let workspace_id = workspace["id"].as_str().unwrap().to_string();

    // The owner's own example: a morning brief of yesterday's meetings with
    // recommended actions, scheduled daily. `--harness pi` resolves to the
    // fixture harness the daemon finds on PATH.
    let automation = fixture.cli_ok(&[
        "automation",
        "create",
        "--name",
        "Morning meeting brief",
        "--cron",
        "0 8 * * *",
        "--workspace",
        &workspace_id,
        "--harness",
        "pi",
        "--prompt",
        "Read yesterday's meetings with `drogon-cli meeting list --json` and `drogon-cli meeting read --id <ID>`, then write a brief with recommended actions.",
        "--json",
    ]);
    let automation_id = automation["id"].as_str().unwrap().to_string();
    assert_eq!(automation["cron"], "0 8 * * *");
    assert_eq!(automation["harness"], "pi");

    let run = fixture.cli_ok(&["automation", "run", "--id", &automation_id, "--json"]);
    assert_eq!(run["outcome"], "dispatched");
    let run_id = run["runId"].as_str().unwrap().to_string();

    // The run is dispatched into a real session; its completion advance
    // records the output snapshot the owner reads in Automations. The run
    // detail lives behind its own RPC (the Automations run page's data
    // layer), so this leg uses the documented `rpc` passthrough rather than
    // inventing a second CLI verb for it.
    let run_params = format!("{{\"runId\":\"{run_id}\"}}");
    let deadline = Instant::now() + Duration::from_secs(60);
    let snapshot = loop {
        let detail = fixture.cli_ok(&["rpc", "automation.run", "--params", &run_params, "--json"]);
        if detail["status"] == "completed" || detail["status"] == "failed" {
            break detail;
        }
        assert!(
            Instant::now() < deadline,
            "automation run never settled: {detail}"
        );
        std::thread::sleep(Duration::from_millis(200));
    };
    assert_eq!(snapshot["status"], "completed", "{snapshot}");
    // The snapshot is the plain-text capture the Automations run page shows.
    let output = snapshot["outputSnapshot"]["content"]
        .as_str()
        .unwrap_or_else(|| panic!("the run must carry an output snapshot: {snapshot}"));
    assert_eq!(snapshot["outputSnapshot"]["format"], "plain_text");
    assert!(
        output.contains("MORNING BRIEF"),
        "the brief must reach the run the owner reads: {snapshot}"
    );
    assert!(
        output.contains("INDEXED=2"),
        "the brief must be built from the indexed meetings: {output}"
    );
    assert!(
        output.contains("MEETING Weekly sync") && output.contains("MEETING Yesterday retro"),
        "the brief must name the meetings the CLI returned: {output}"
    );
    assert!(
        output.contains("OPENED Weekly sync"),
        "the brief must have opened a transcript through the CLI: {output}"
    );
    assert!(
        output.contains("TRANSCRIPT hola desde la reunion de hoy"),
        "the brief must carry transcript text read through the CLI: {output}"
    );
    assert!(
        output.contains("RECOMMENDED ACTION"),
        "the brief must carry recommended actions: {output}"
    );

    // The same run is visible in the automation's history, which is the
    // delivery/observability path the owner's Automations page reads.
    let history = fixture.cli_ok(&[
        "automation",
        "history",
        "--id",
        &automation_id,
        "--limit",
        "5",
        "--json",
    ]);
    let runs = history["runs"].as_array().expect("runs");
    assert!(
        runs.iter()
            .any(|entry| entry["id"].as_str() == Some(run_id.as_str())),
        "the run must appear in history: {history}"
    );
}
