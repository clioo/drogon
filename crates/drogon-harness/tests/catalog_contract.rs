//! C01-A catalog contract tests: the probe/parse/freshness pipeline against
//! deterministic fixture executables — no real harness CLIs, no user
//! configuration, no credentials. Public-API contract tests against
//! `drogon_harness::catalog`.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use drogon_harness::{
    CatalogEntry, EnumerationStatus, HarnessId, HostCatalog, PROBE_OUTPUT_CAP, ProbeProvenance,
    freshness_token, probe_host_catalog, probe_host_catalog_with_budget,
};

#[cfg(unix)]
/// The fixture scripts under test record their background children's real
/// PIDs next to the fixture executable. Verifying each recorded identity
/// with `ps` is descendant-exit evidence; unlike `pgrep -f` it does not
/// depend on argv contents (a `sleep` carries no launcher path) and a
/// `ps` error is never read as "absent" without a bounded retry.
fn assert_recorded_children_reaped(log: &Path) {
    let content = std::fs::read_to_string(log).expect("children log written by fixture");
    let deadline = Instant::now() + Duration::from_secs(10);
    for pid in content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        loop {
            let output = Command::new("/bin/ps")
                .args(["-p", pid, "-o", "stat="])
                .output()
                .expect("run ps");
            let stat = String::from_utf8_lossy(&output.stdout);
            // `ps` exits nonzero and prints nothing once the pid is gone;
            // empty output is the identity-exit evidence. A 'Z' stat is a
            // zombie awaiting reap, not a live descendant.
            let alive = stat.trim().chars().next().is_some_and(|state| state != 'Z');
            if !alive {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "recorded child {pid} survived cleanup"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

/// A fixture bin dir with deterministic fake CLIs. Nothing here touches a
/// real harness or the user's config.
struct FixtureBin {
    dir: tempfile::TempDir,
}

impl FixtureBin {
    fn new() -> Self {
        Self {
            dir: tempfile::tempdir().expect("fixture bin dir"),
        }
    }

    /// `script` becomes an executable named `name` in the fixture bin.
    fn add(&self, name: &str, script: &str) -> PathBuf {
        let path = self.dir.path().join(name);
        std::fs::write(&path, script).expect("write fixture script");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
                .expect("chmod fixture");
        }
        path
    }
}

/// The exact fixed-column shape `pi --list-models` prints on Pi 0.85.1
/// (captured live during C01-A discovery), reduced to three rows.
const FAKE_PI_TABLE: &str = "\
provider      model                            context  max-out  thinking  images
dgx-spark     qwen3.8-flash-next-nvidia-nvfp4  131.1K   4.1K     no        no
kimi-coding   kimi-for-coding                  262.1K   32.8K    yes       yes
zai           glm-5.3-flash                    1M       131.1K   yes       yes
";

fn fake_pi(list_models_body: &str) -> String {
    format!(
        "#!/bin/sh\n\
         case \"$1\" in\n\
         \x20 --version) echo '0.85.1'; exit 0 ;;\n\
         \x20 --list-models) cat <<'PIEOF'\n{list_models_body}PIEOF\n\
         \x20 exit 0 ;;\n\
         *) echo \"unexpected argv: $1\" >&2; exit 2 ;;\n\
         esac\n"
    )
}

fn fake_opencode(models_body: &str) -> String {
    format!(
        "#!/bin/sh\n\
         case \"$1\" in\n\
         \x20 --version) echo '1.18.30'; exit 0 ;;\n\
         \x20 models) cat <<'OCEOF'\n{models_body}OCEOF\n\
         \x20 exit 0 ;;\n\
         *) echo \"unexpected argv: $1\" >&2; exit 2 ;;\n\
         esac\n"
    )
}

#[test]
fn pi_probe_enumerates_entries_with_provenance() {
    let bin = FixtureBin::new();
    let pi = bin.add("pi", &fake_pi(FAKE_PI_TABLE));

    let catalog = probe_host_catalog(HarnessId::Pi, Some(&pi));
    assert_eq!(catalog.harness, HarnessId::Pi);
    assert_eq!(catalog.status, EnumerationStatus::Enumerated);
    assert_eq!(catalog.entries.len(), 3);

    let kimi = catalog
        .entries
        .iter()
        .find(|entry| entry.provider.as_deref() == Some("kimi-coding"))
        .expect("kimi-coding entry");
    assert_eq!(kimi.id, "kimi-for-coding");
    assert_eq!(kimi.context.as_deref(), Some("262.1K"));
    assert_eq!(kimi.max_output.as_deref(), Some("32.8K"));
    assert_eq!(kimi.thinking, Some(true));
    assert_eq!(kimi.images, Some(true));

    let dgx = catalog
        .entries
        .iter()
        .find(|entry| entry.provider.as_deref() == Some("dgx-spark"))
        .expect("dgx-spark entry");
    assert_eq!(dgx.thinking, Some(false));

    let provenance = catalog.provenance.as_ref().expect("provenance");
    assert_eq!(provenance.version.as_deref(), Some("0.85.1"));
    assert_eq!(provenance.argv, ["--list-models"]);
    assert!(
        provenance.config_scope.contains("credential-free"),
        "scope must record the isolated credential-free probe: {provenance:?}"
    );
    assert!(
        catalog
            .note
            .as_deref()
            .is_some_and(|note| note.contains("auth-gated"))
    );
}

#[test]
fn pi_probe_auth_empty_answer_is_an_honest_empty_enumeration() {
    let bin = FixtureBin::new();
    let pi = bin.add(
        "pi",
        &fake_pi("No models available. Use /login to log into a provider via OAuth or API key.\n"),
    );
    let catalog = probe_host_catalog(HarnessId::Pi, Some(&pi));
    assert_eq!(catalog.status, EnumerationStatus::Enumerated);
    assert!(catalog.entries.is_empty());
    assert!(
        catalog
            .note
            .as_deref()
            .is_some_and(|note| note.contains("unverified"))
    );
}

#[test]
fn pi_probe_malformed_output_is_parse_failed_with_a_bounded_sample() {
    let bin = FixtureBin::new();
    let body = "<!DOCTYPE html><html><body>oauth redirect</body></html>\n";
    let pi = bin.add("pi", &fake_pi(body));
    let catalog = probe_host_catalog(HarnessId::Pi, Some(&pi));
    assert_eq!(catalog.status, EnumerationStatus::ParseFailed);
    let sample = catalog.note.expect("parse sample note");
    assert!(sample.len() <= 240, "sample stays bounded: {sample}");
}

#[test]
fn missing_executable_is_not_installed() {
    let catalog = probe_host_catalog(HarnessId::Pi, Some(Path::new("/no/such/pi-here")));
    assert_eq!(catalog.status, EnumerationStatus::NotInstalled);
}

#[cfg(unix)]
#[test]
fn timed_out_probe_is_killed_within_its_budget() {
    // The fixture records its own PID before hanging; cleanup evidence is
    // the recorded identity exiting, never an argv-based grep.
    let bin = FixtureBin::new();
    let log = bin.dir.path().join("timeout.children");
    let pi = bin.add(
        "pi",
        "#!/bin/sh\n\
         if [ \"$1\" = \"--version\" ]; then echo 0.85.1; exit 0; fi\n\
         echo $$ >> \"$(dirname \"$0\")/timeout.children\"\n\
         sleep 60\n",
    );
    let start = Instant::now();
    let catalog =
        probe_host_catalog_with_budget(HarnessId::Pi, Some(&pi), Duration::from_millis(300));
    let elapsed = start.elapsed();
    assert_eq!(catalog.status, EnumerationStatus::TimedOut);
    assert!(
        elapsed < Duration::from_secs(15),
        "kill+reap must stay far below the 60s child sleep: {elapsed:?}"
    );
    let note = catalog.note.expect("timeout evidence note");
    assert!(note.contains("leader still running"), "{note}");
    assert!(note.contains("group-empty"), "{note}");
    assert_recorded_children_reaped(&log);
}

#[test]
fn opencode_probe_parses_provider_id_lines() {
    let bin = FixtureBin::new();
    let opencode = bin.add(
        "opencode",
        &fake_opencode("opencode/claude-sonnet-5\nopencode/glm-5\nbare-id\n"),
    );
    let catalog = probe_host_catalog(HarnessId::Opencode, Some(&opencode));
    assert_eq!(catalog.status, EnumerationStatus::Enumerated);
    assert_eq!(catalog.entries.len(), 3);
    assert_eq!(catalog.entries[0].provider.as_deref(), Some("opencode"));
    assert_eq!(catalog.entries[0].id, "claude-sonnet-5");
    assert_eq!(catalog.entries[2].provider, None);
    assert_eq!(catalog.entries[2].id, "bare-id");
    let provenance = catalog.provenance.as_ref().expect("provenance");
    assert_eq!(provenance.version.as_deref(), Some("1.18.30"));
    assert!(provenance.config_scope.contains("isolated"));
}

#[test]
fn claude_has_no_enumeration_surface_and_reports_version_only() {
    let bin = FixtureBin::new();
    let claude = bin.add("claude", "#!/bin/sh\necho '2.1.266 (Claude Code)'\n");
    let catalog = probe_host_catalog(HarnessId::Claude, Some(&claude));
    assert_eq!(catalog.status, EnumerationStatus::UnsupportedSurface);
    assert!(catalog.entries.is_empty());
    assert_eq!(
        catalog
            .provenance
            .as_ref()
            .and_then(|p| p.version.as_deref()),
        Some("2.1.266 (Claude Code)")
    );
}

#[test]
fn codex_and_antigravity_report_unsupported_surface() {
    let bin = FixtureBin::new();
    let codex = bin.add("codex", "#!/bin/sh\necho 'codex-cli 1.2.3'\n");
    let catalog = probe_host_catalog(HarnessId::Codex, Some(&codex));
    assert_eq!(catalog.status, EnumerationStatus::UnsupportedSurface);

    let absent = probe_host_catalog(HarnessId::Antigravity, None);
    assert_eq!(absent.status, EnumerationStatus::NotInstalled);
}

#[test]
fn freshness_token_changes_when_the_model_set_or_version_changes() {
    let bin = FixtureBin::new();
    let pi = bin.add("pi", &fake_pi(FAKE_PI_TABLE));
    let catalog = probe_host_catalog(HarnessId::Pi, Some(&pi));
    let token = freshness_token(&catalog);
    assert!(
        token.starts_with("pi|0.85.1|"),
        "token carries executable and version: {token}"
    );
    assert!(token.contains("kimi-coding/kimi-for-coding"));

    // Same executable, one more model -> different token (catalog refresh
    // or model-set change invalidates stored selections).
    let changed = HostCatalog {
        entries: {
            let mut entries = catalog.entries.clone();
            entries.push(CatalogEntry {
                provider: Some("zai".to_string()),
                id: "glm-5.4".to_string(),
                context: None,
                max_output: None,
                thinking: None,
                images: None,
            });
            entries
        },
        ..catalog.clone()
    };
    assert_ne!(token, freshness_token(&changed));

    // Same model set, different version -> different token.
    let upgraded = HostCatalog {
        provenance: Some(ProbeProvenance {
            version: Some("0.86.0".to_string()),
            ..catalog.provenance.clone().expect("provenance")
        }),
        ..catalog.clone()
    };
    assert_ne!(token, freshness_token(&upgraded));
}

#[test]
fn probe_output_beyond_the_cap_is_drained_not_kept() {
    // Many rows beyond PROBE_OUTPUT_CAP: the capped reader retains only the
    // cap while draining the rest, and the probe still completes.
    let mut body = String::from(
        "provider      model                            context  max-out  thinking  images\n",
    );
    while body.len() < PROBE_OUTPUT_CAP + 8192 {
        body.push_str(
            "zai           glm-5.3-flash                    1M       131.1K   yes       yes\n",
        );
    }
    let bin = FixtureBin::new();
    let pi = bin.add("pi", &fake_pi(&body));
    let start = Instant::now();
    let catalog = probe_host_catalog_with_budget(HarnessId::Pi, Some(&pi), Duration::from_secs(20));
    assert_eq!(catalog.status, EnumerationStatus::Enumerated);
    assert!(!catalog.entries.is_empty());
    assert!(
        start.elapsed() < Duration::from_secs(20),
        "a chatty child must still be drained and reaped promptly"
    );
}

#[cfg(unix)]
#[test]
fn leader_exits_but_grandchild_holds_pipes_is_bounded_and_reported() {
    // The leader prints the table and exits zero, but a background child
    // inherits stdout and sleeps: the drain must not hang on the open
    // pipe, must escalate the GROUP after the post-exit grace, and must
    // report the cleanup in the catalog note. The fixture records the
    // child's real PID; the test verifies that identity exits.
    let bin = FixtureBin::new();
    let log = bin.dir.path().join("leader-exits.children");
    let pi = bin.add(
        "pi",
        "#!/bin/sh\n\
         if [ \"$1\" = \"--version\" ]; then echo 0.85.1; exit 0; fi\n\
         cat <<'PIEOF'\n\
provider      model                            context  max-out  thinking  images\n\
kimi-coding   kimi-for-coding                  262.1K   32.8K    yes       yes\n\
PIEOF\n\
         sleep 30 & echo $! >> \"$(dirname \"$0\")/leader-exits.children\"\n\
         exit 0\n",
    );
    let start = Instant::now();
    let catalog = probe_host_catalog(HarnessId::Pi, Some(&pi));
    assert!(
        start.elapsed() < Duration::from_secs(20),
        "drain must stay bounded with a pipe-holding grandchild"
    );
    assert_eq!(catalog.status, EnumerationStatus::Enumerated);
    assert_eq!(catalog.entries.len(), 1);
    let note = catalog.note.expect("cleanup note");
    assert!(
        note.contains("leader exited but pipes stayed open past the post-exit grace"),
        "{note}"
    );
    assert!(
        note.contains("group-empty after SIGTERM"),
        "evidence must record verified group exit, not assumed: {note}"
    );
    assert!(
        !note.contains("probe root retained"),
        "verified cleanup must not retain the root: {note}"
    );
    assert_recorded_children_reaped(&log);
}

#[cfg(unix)]
#[test]
fn term_resistant_descendant_is_sigkilled_and_evidence_recorded() {
    // A grandchild that traps and ignores TERM must be escalated to
    // SIGKILL, and the note must say the group survived TERM rather than
    // claiming signal success as verified exit.
    let bin = FixtureBin::new();
    let log = bin.dir.path().join("term-resistant.children");
    let pi = bin.add(
        "pi",
        "#!/bin/sh\n\
         if [ \"$1\" = \"--version\" ]; then echo 0.85.1; exit 0; fi\n\
         cat <<'PIEOF'\n\
provider      model                            context  max-out  thinking  images\n\
kimi-coding   kimi-for-coding                  262.1K   32.8K    yes       yes\n\
PIEOF\n\
         ( trap '' TERM; sleep 60 ) & echo $! >> \"$(dirname \"$0\")/term-resistant.children\"\n\
         exit 0\n",
    );
    let start = Instant::now();
    let catalog = probe_host_catalog(HarnessId::Pi, Some(&pi));
    assert!(
        start.elapsed() < Duration::from_secs(25),
        "TERM-resistant descendant must be KILL-escalated within bounds"
    );
    assert_eq!(catalog.status, EnumerationStatus::Enumerated);
    let note = catalog.note.expect("cleanup note");
    assert!(
        note.contains("group survived SIGTERM"),
        "the TERM survival must be recorded: {note}"
    );
    assert!(note.contains("group after SIGKILL: group-empty"), "{note}");
    assert_recorded_children_reaped(&log);
}

#[cfg(unix)]
#[test]
fn redirected_stdio_survivor_is_caught_after_eof_and_leader_exit() {
    // A background child with stdio redirected to /dev/null holds no pipe,
    // so pipe EOF plus a clean leader exit is NOT proof of cleanup: the
    // post-leader group check must catch it, escalate, and report it.
    let bin = FixtureBin::new();
    let log = bin.dir.path().join("redirected.children");
    let pi = bin.add(
        "pi",
        "#!/bin/sh\n\
         if [ \"$1\" = \"--version\" ]; then echo 0.85.1; exit 0; fi\n\
         cat <<'PIEOF'\n\
provider      model                            context  max-out  thinking  images\n\
kimi-coding   kimi-for-coding                  262.1K   32.8K    yes       yes\n\
PIEOF\n\
         sleep 45 </dev/null >/dev/null 2>&1 & echo $! >> \"$(dirname \"$0\")/redirected.children\"\n\
         exit 0\n",
    );
    let start = Instant::now();
    let catalog = probe_host_catalog(HarnessId::Pi, Some(&pi));
    assert!(
        start.elapsed() < Duration::from_secs(20),
        "redirected-stdio survivor must be caught within bounds"
    );
    assert_eq!(catalog.status, EnumerationStatus::Enumerated);
    let note = catalog.note.expect("cleanup note");
    assert!(
        note.contains("surviving group members after leader exit and pipe EOF"),
        "the invisible survivor must be recorded: {note}"
    );
    assert!(
        !note.contains("probe root retained"),
        "verified cleanup must not retain the root: {note}"
    );
    assert_recorded_children_reaped(&log);
}

#[cfg(unix)]
#[test]
fn continuous_producer_respects_the_deadline_and_is_fully_reaped() {
    // A child that produces output forever must hit the wall-clock budget
    // (drain fairness caps prevent stdout from starving the deadline), be
    // group-killed, and leave checked evidence.
    let bin = FixtureBin::new();
    let log = bin.dir.path().join("continuous.children");
    let pi = bin.add(
        "pi",
        "#!/bin/sh\n\
         if [ \"$1\" = \"--version\" ]; then echo 0.85.1; exit 0; fi\n\
         echo $$ >> \"$(dirname \"$0\")/continuous.children\"\n\
         while :; do echo 'provider      model                            context  max-out  thinking  images'; done\n",
    );
    let start = Instant::now();
    let catalog =
        probe_host_catalog_with_budget(HarnessId::Pi, Some(&pi), Duration::from_millis(300));
    assert_eq!(catalog.status, EnumerationStatus::TimedOut);
    assert!(
        start.elapsed() < Duration::from_secs(15),
        "continuous output must not delay the deadline: {:?}",
        start.elapsed()
    );
    let note = catalog.note.expect("timeout evidence note");
    assert!(note.contains("leader still running"), "{note}");
    assert!(note.contains("group-empty"), "{note}");
    assert_recorded_children_reaped(&log);
}

#[test]
fn nonzero_exit_is_probe_failed_never_model_rows() {
    // A failing enumeration (e.g. an auth error) must not parse partial
    // stdout into catalog rows.
    let bin = FixtureBin::new();
    let pi = bin.add(
        "pi",
        "#!/bin/sh\n\
         if [ \"$1\" = \"--version\" ]; then echo 0.85.1; exit 0; fi\n\
         echo 'provider      model'\n\
         echo 'kimi-coding   should-not-appear' \n\
         echo 'token refresh failed' >&2\n\
         exit 1\n",
    );
    let catalog = probe_host_catalog(HarnessId::Pi, Some(&pi));
    assert_eq!(catalog.status, EnumerationStatus::ProbeFailed);
    assert!(catalog.entries.is_empty(), "no rows from a failed probe");
    let note = catalog.note.expect("failure note");
    assert!(note.contains("exited"), "{note}");
    assert!(note.contains("token refresh failed"), "{note}");
}

#[cfg(unix)]
#[test]
fn isolation_setup_failure_fails_closed_without_probing() {
    // Seeded child: TMPDIR points at a read-only dir, so the private probe
    // root cannot be created. The probe must fail closed
    // (IsolationFailed) and never spawn the executable.
    const SEED: &str = "DROGON_CATALOG_TEST_ISOLATION_FAIL";
    if std::env::var_os(SEED).is_none() {
        let guard = tempfile::tempdir().expect("parent temp dir");
        let ro = guard.path().join("read-only");
        std::fs::create_dir(&ro).unwrap();
        let fixture = guard.path().join("pi");
        // A fixture that would print a catalog if it ever ran.
        std::fs::write(
            &fixture,
            "#!/bin/sh\necho 'provider      model'\necho 'kimi-coding   kimi-for-coding'\n",
        )
        .unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&fixture, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::set_permissions(&ro, std::fs::Permissions::from_mode(0o555)).unwrap();
        let exe = std::env::current_exe().unwrap();
        let status = std::process::Command::new(exe)
            .arg("isolation_setup_failure_fails_closed_without_probing")
            .arg("--exact")
            .arg("--nocapture")
            .env(SEED, "1")
            .env("TMPDIR", &ro)
            .env("DROGON_CATALOG_TEST_FIXTURE", &fixture)
            .status()
            .expect("spawn seeded child");
        assert!(status.success(), "seeded child must pass");
        return;
    }
    let fixture = PathBuf::from(std::env::var("DROGON_CATALOG_TEST_FIXTURE").unwrap());
    let catalog = probe_host_catalog(HarnessId::Pi, Some(&fixture));
    assert_eq!(
        catalog.status,
        EnumerationStatus::IsolationFailed,
        "probe isolation failure must fail closed: {catalog:?}"
    );
    assert!(catalog.entries.is_empty());
}
