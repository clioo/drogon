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
# Analysis mode (`meeting analyze`): the daemon runs this same binary as its
# one-shot local model, with the extraction prompt on `-p`. The fixture
# answers with one quote copied OUT of the prompt it was handed (so the
# daemon's verification finds it verbatim) and one invented quote (so the
# discard path is exercised for real). No model, no network, no credential.
case "$*" in
  *"You extract commitments from ONE meeting transcript"*)
    line=$(printf '%s' "$*" | grep -o '\[00:0[0-9]\].*' | head -1)
    quote=$(printf '%s' "$line" | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf '{"summary":"Fixture summary of the meeting.","decisions":[{"text":"Fixture decision from the note","quote":"%s"}],"actions":[{"text":"Fixture action the note states","owner":"Carlos","quote":"%s","confidence":"high"},{"text":"Invented migration action","quote":"I will migrate the database tonight","confidence":"high"}],"openQuestions":[]}\n' "$quote" "$quote"
    exit 0
    ;;
esac
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

impl Fixture {
    /// Stops the fixture daemon and does not come back until it is gone.
    /// Shared by `Drop` and by the restart leg, so every path reaps the same
    /// way: graceful SIGTERM, bounded wait, then a confirmed kill of only
    /// this child.
    fn stop_daemon(&mut self) {
        if let Some(mut child) = self.daemon.take() {
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
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.stop_daemon();
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

// ---------------------------------------------------------------------------
// The working half: search and filters over the corpus, extraction through the
// local model, and the commitment ledger — all through the real daemon and the
// real CLI, with a fixture `pi` instead of a model.
// ---------------------------------------------------------------------------

/// Search and filters, against a corpus big enough that a reverse-chronological
/// list on its own would be useless.
#[test]
fn a_large_corpus_is_searched_and_filtered_rather_than_scrolled() {
    let mut fixture = Fixture::new();
    // 40 real dates, so the date and duration filters have something to bite
    // on, plus the two query targets.
    for day in 1..=28 {
        let date = format!("2026-08-{day:02}");
        fixture.write_note(
            &date,
            "08-00",
            "30 min",
            &format!("Standup {day}"),
            "[00:00] routine status",
        );
    }
    for day in 1..=12 {
        let date = format!("2026-09-{day:02}");
        fixture.write_note(
            &date,
            "14-00",
            "95 min",
            &format!("Deep dive {day}"),
            "[00:00] we agreed to ship the budget report\n[00:10] Raul owns MR 142",
        );
    }
    fixture.start_daemon(&[]);

    let all = fixture.cli_ok(&["meeting", "list", "--limit", "200", "--json"]);
    assert_eq!(all["total"], 40);
    assert_eq!(all["searched"], false);

    let searched = fixture.cli_ok(&["meeting", "list", "--query", "budget", "--json"]);
    assert_eq!(searched["searched"], true);
    assert_eq!(searched["total"], 12);
    assert_eq!(searched["filters"]["query"], "budget");
    assert!(
        searched["scanned"].as_u64().unwrap_or(0) >= 12,
        "a search must report how many notes it read: {searched}"
    );
    let first = &searched["meetings"][0];
    assert_eq!(first["dateFolder"], "2026-09-12");
    assert!(first["matchCount"].as_u64().unwrap_or(0) >= 1);
    let hit = &first["matches"][0];
    // The line the match came from, verbatim, with its number in the note.
    assert_eq!(hit["line"], 7);
    assert_eq!(hit["text"], "[00:00] we agreed to ship the budget report");

    let range = fixture.cli_ok(&[
        "meeting",
        "list",
        "--from",
        "2026-09-05",
        "--to",
        "2026-09-08",
        "--json",
    ]);
    assert_eq!(range["total"], 4);
    assert_eq!(range["meetings"][0]["dateFolder"], "2026-09-08");

    let long = fixture.cli_ok(&["meeting", "list", "--min-minutes", "60", "--json"]);
    assert_eq!(long["total"], 12);

    let combined = fixture.cli_ok(&[
        "meeting",
        "list",
        "--query",
        "budget",
        "--from",
        "2026-09-10",
        "--json",
    ]);
    assert_eq!(combined["total"], 3);

    // A search that matches nothing is not an empty folder.
    let nothing = fixture.cli_ok(&["meeting", "list", "--query", "zzz-nothing", "--json"]);
    assert_eq!(nothing["total"], 0);
    assert_eq!(nothing["availability"]["reason"], "ready");
    assert!(
        nothing["scanned"].as_u64().unwrap_or(0) >= 40,
        "a fruitless search must report what it read: {nothing}"
    );

    // And the filters are refused, not clamped, when they are nonsense.
    let failure = fixture
        .cli(&["meeting", "list", "--from", "2026-02-30", "--json"])
        .unwrap_err();
    assert_eq!(failure.0, 1);
    assert!(
        failure.1.contains("YYYY-MM-DD"),
        "the refusal must name the rule: {}",
        failure.1
    );
}

/// Extraction end to end: a real one-shot subprocess run through the daemon's
/// own harness planner, verified quotes, a discarded invention, and nothing
/// created.
#[test]
fn the_local_model_suggests_only_what_the_note_supports() {
    let mut fixture = Fixture::new();
    fixture.write_note(
        "2026-09-10",
        "08-05",
        "42 min",
        "Weekly sync",
        "[00:00] we agreed to ship the budget report\n[00:10] Raul owns MR 142",
    );
    fixture.start_daemon(&[]);

    let list = fixture.cli_ok(&["meeting", "list", "--json"]);
    // The desktop surface reads this to decide whether to offer extraction at
    // all; the CLI reports the same fact.
    assert_eq!(list["availability"]["analysis"]["available"], true);
    assert_eq!(list["availability"]["analysis"]["reason"], "ready");
    assert_eq!(list["availability"]["analysis"]["harness"], "pi");
    assert_eq!(
        list["availability"]["analysis"]["model"],
        "qwen3.8-flash-next-nvidia-nvfp4"
    );
    assert_eq!(list["availability"]["analysis"]["provider"], "dgx-spark");
    assert_eq!(list["availability"]["analysis"]["freeLocalModel"], true);

    let id = list["meetings"][0]["id"].as_str().unwrap().to_string();
    let analysis = fixture.cli_ok(&["meeting", "analyze", "--id", &id, "--json"]);

    // The run names the free local model and nothing else.
    assert_eq!(analysis["model"], "qwen3.8-flash-next-nvidia-nvfp4");
    assert_eq!(analysis["provider"], "dgx-spark");
    assert_eq!(analysis["harness"], "pi");
    assert_eq!(analysis["meeting"]["id"], id);

    // One decision and one action were verified against the note...
    assert_eq!(analysis["decisions"].as_array().unwrap().len(), 1);
    assert_eq!(analysis["actions"].as_array().unwrap().len(), 1);
    let decision = &analysis["decisions"][0];
    assert_eq!(decision["line"], 7);
    assert_eq!(
        decision["quote"],
        "[00:00] we agreed to ship the budget report"
    );
    assert_eq!(analysis["actions"][0]["owner"], "Carlos");
    assert_eq!(analysis["actions"][0]["line"], 7);

    // ...and the invented one was discarded, with its reason, rather than
    // presented as a finding.
    assert_eq!(analysis["discardedCount"], 1);
    let discarded = &analysis["discarded"][0];
    assert_eq!(discarded["reason"], "quote-not-found");
    assert!(
        discarded["text"]
            .as_str()
            .unwrap()
            .contains("Invented migration action"),
        "the discarded suggestion keeps its text so the owner can see it: {discarded}"
    );
    let actionable: Vec<&str> = analysis["actions"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|item| item["text"].as_str())
        .collect();
    assert!(
        !actionable.iter().any(|text| text.contains("Invented")),
        "an unverifiable suggestion must never reach the findings: {actionable:?}"
    );

    // Nothing was created by the analysis: the ledger is still empty.
    let ledger = fixture.cli_ok(&["meeting", "actions", "list", "--json"]);
    assert_eq!(ledger["total"], 0);
    assert!(!fixture.data_dir.join("meeting-commitments.json").exists());
}

/// The acceptance step: only an explicit, quote-verified act puts work in the
/// ledger, and the ledger is Drogon's own file — the notes are untouched.
#[test]
fn accepting_a_suggestion_records_it_and_writes_nothing_to_the_notes() {
    let mut fixture = Fixture::new();
    fixture.write_note(
        "2026-09-10",
        "08-05",
        "42 min",
        "Weekly sync",
        "[00:00] we agreed to ship the budget report\n[00:10] Raul owns MR 142",
    );
    fixture.write_note(
        "2026-09-09",
        "09-00",
        "12 min",
        "Yesterday retro",
        "[00:00] I will write the migration notes",
    );
    fixture.start_daemon(&[]);
    let before = tree_snapshot(&fixture.notes);

    let list = fixture.cli_ok(&["meeting", "list", "--json"]);
    let sync_id = list["meetings"][0]["id"].as_str().unwrap().to_string();
    let retro_id = list["meetings"][1]["id"].as_str().unwrap().to_string();

    // (1) A claim the transcript does not support is refused, and nothing is
    // written — including when the owner types it himself.
    let failure = fixture
        .cli(&[
            "meeting",
            "actions",
            "add",
            "--meeting-id",
            &sync_id,
            "--text",
            "Migrate the database tonight",
            "--quote",
            "I will migrate the database tonight",
            "--json",
        ])
        .unwrap_err();
    assert_eq!(failure.0, 1);
    assert!(
        failure.1.contains("commitment_quote_not_found"),
        "the refusal must carry its own code: {}",
        failure.1
    );
    assert!(!fixture.data_dir.join("meeting-commitments.json").exists());

    // (2) An accepted suggestion is recorded with the line it came from.
    let accepted = fixture.cli_ok(&[
        "meeting",
        "actions",
        "add",
        "--meeting-id",
        &sync_id,
        "--text",
        "Ship the budget report",
        "--quote",
        "we agreed to ship the budget report",
        "--owner",
        "Carlos",
        "--source",
        "suggested",
        "--confidence",
        "high",
        "--json",
    ]);
    assert_eq!(accepted["status"], "open");
    assert_eq!(accepted["source"], "suggested");
    assert_eq!(accepted["confidence"], "high");
    assert_eq!(accepted["line"], 7);
    assert_eq!(
        accepted["quote"],
        "[00:00] we agreed to ship the budget report"
    );
    assert_eq!(accepted["meetingTitle"], "Weekly sync");
    assert_eq!(accepted["meetingDate"], "2026-09-10");
    let commitment_id = accepted["id"].as_str().unwrap().to_string();

    // (3) A second, owner-written commitment from an older meeting.
    let second = fixture.cli_ok(&[
        "meeting",
        "actions",
        "add",
        "--meeting-id",
        &retro_id,
        "--text",
        "Write the migration notes",
        "--quote",
        "I will write the migration notes",
        "--source",
        "owner",
        "--json",
    ]);
    assert_eq!(second["confidence"], "low");
    assert_eq!(second["line"], 7);

    // (4) The ledger answers "what is still open" across the corpus.
    let open = fixture.cli_ok(&["meeting", "actions", "list", "--open", "--json"]);
    assert_eq!(open["total"], 2);
    assert_eq!(open["open"], 2);
    // Newest meeting first.
    assert_eq!(open["commitments"][0]["id"], commitment_id);

    let searched = fixture.cli_ok(&[
        "meeting",
        "actions",
        "list",
        "--query",
        "MIGRATION",
        "--json",
    ]);
    assert_eq!(searched["total"], 1);

    // (5) Closing one is an explicit state change, and done and dismissed are
    // different answers.
    let done = fixture.cli_ok(&[
        "meeting",
        "actions",
        "done",
        "--id",
        &commitment_id,
        "--json",
    ]);
    assert_eq!(done["status"], "done");
    assert!(done["resolvedAt"].is_string());
    let dismissed = fixture.cli_ok(&[
        "meeting",
        "actions",
        "dismiss",
        "--id",
        second["id"].as_str().unwrap(),
        "--json",
    ]);
    assert_eq!(dismissed["status"], "dismissed");
    assert_eq!(
        fixture.cli_ok(&["meeting", "actions", "list", "--open", "--json"])["total"],
        0
    );
    assert!(
        fixture
            .cli_ok(&["meeting", "actions", "list", "--query", "", "--json"])
            .is_object(),
        "an empty action search is a page, not an error"
    );

    // (6) The ledger is Drogon's own file, and the notes are byte-identical.
    assert!(fixture.data_dir.join("meeting-commitments.json").is_file());
    assert_eq!(tree_snapshot(&fixture.notes), before);

    // (7) The ledger survives a daemon restart (it is a file, not memory).
    fixture.stop_daemon();
    fixture.start_daemon(&[]);
    let reopened = fixture.cli_ok(&["meeting", "actions", "list", "--json"]);
    assert_eq!(reopened["total"], 2);
    assert_eq!(reopened["open"], 0);
}

/// The local model missing is a first-class state: the transcripts stay
/// fully usable, and the extraction verb says why it cannot run instead of
/// substituting a model.
#[test]
fn extraction_is_unavailable_without_the_local_model() {
    let mut fixture = Fixture::new();
    fixture.write_note(
        "2026-09-10",
        "08-05",
        "42 min",
        "Weekly sync",
        "[00:00] we agreed to ship the budget report",
    );
    // A PATH without the fixture harness: the daemon cannot resolve `pi`.
    fixture.start_daemon(&[("PATH", "/usr/bin:/bin")]);

    let list = fixture.cli_ok(&["meeting", "list", "--json"]);
    assert_eq!(list["availability"]["analysis"]["available"], false);
    assert_eq!(
        list["availability"]["analysis"]["reason"],
        "harness-missing"
    );
    // The transcripts themselves are unaffected.
    assert_eq!(list["total"], 1);
    assert_eq!(list["availability"]["reason"], "ready");

    let id = list["meetings"][0]["id"].as_str().unwrap().to_string();
    let failure = fixture
        .cli(&["meeting", "analyze", "--id", &id, "--json"])
        .unwrap_err();
    assert_eq!(failure.0, 1);
    assert!(
        failure.1.contains("meeting_analysis_unavailable"),
        "the refusal must carry its own code: {}",
        failure.1
    );
    assert!(
        failure.1.contains("pi"),
        "the refusal must name the missing harness: {}",
        failure.1
    );

    // Reading and searching still work with no model at all.
    let searched = fixture.cli_ok(&["meeting", "list", "--query", "budget", "--json"]);
    assert_eq!(searched["total"], 1);
    fixture.cli_ok(&["meeting", "read", "--id", &id, "--json"]);
}
