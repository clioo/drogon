//! Host-scoped harness catalogs: bounded, provenance-recording probes of the
//! installed harness CLIs' own enumeration surfaces (`pi --list-models`,
//! `opencode models`), plus honest "no enumeration surface" records for
//! harnesses that expose none (`claude`, `codex`, `antigravity`).
//!
//! What a catalog proves — and what it does not — is deliberate (C01-A
//! requirement): an entry proves the model ID was *enumerated by this
//! harness binary on this host under the recorded config scope*. That is
//! enumeration/installation evidence, NOT authorization, quota, billing
//! reachability, or continuity guarantees; callers must surface the
//! provenance scope instead of a bare "available" claim. `pi --list-models`
//! in particular only lists models whose provider auth is configured
//! (verified against the installed Pi 0.85.1 docs: "If no auth is
//! configured, the models load but stay unavailable in `/model` and
//! `--list-models`"), so a missing entry can mean "no auth", not "no
//! model" — and, per the coordinator's safety guidance, this crate NEVER
//! mirrors or reads user credential files to work around that: the Pi
//! probe runs against an isolated, empty, credential-free config dir, an
//! auth-empty result is reported as an empty enumeration with provenance,
//! and selections against it degrade to
//! [`crate::selection::SelectionVerdict::ManualUnverified`], not
//! confirmations. A daemon-side layer that already owns config resolution
//! (C01-B) may inject entries it enumerated itself through
//! [`HostCatalog::caller_enumerated`], with provenance saying so.
//!
//! Probe hygiene: every probe owns its child before it runs — stdin is
//! `/dev/null`, combined output is capped ([`PROBE_OUTPUT_CAP`]), wall
//! time is bounded ([`PROBE_TIMEOUT_DEFAULT`]), and a timed-out child is
//! signalled as a process group (the child is spawned with
//! `process_group(0)`, so its pid is its pgid; the group is killed through
//! `/bin/kill` because this crate deliberately adds no new dependencies)
//! and reaped before the probe returns. Probes never touch the user's
//! configuration: the Pi probe points `PI_CODING_AGENT_DIR` at a fresh
//! empty temporary dir (Pi may create `auth.json`/`models-store.json`
//! inside it; the dir is removed after the probe), and the OpenCode probe
//! points `OPENCODE_CONFIG_DIR` at a fresh temporary dir (OpenCode installs
//! plugin `node_modules` there; observed on 1.18.30). Provenance records
//! which scope was probed so a built-in-only enumeration is never mistaken
//! for a user-configured one.

use std::ffi::OsStr;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant, SystemTime};

use serde::Serialize;

use crate::{HarnessAvailability, HarnessId};

/// Combined stdout+stderr bytes a probe will retain. The reader keeps
/// draining after the cap so a chatty child cannot stall on a full pipe,
/// but only the cap is parsed or kept in memory.
pub const PROBE_OUTPUT_CAP: usize = 1 << 20;

/// Default wall-clock budget for one probe child. Probes of `--version` and
/// `--list-models`-style read-only commands finish in milliseconds; a child
/// exceeding this is killed, never waited on forever.
pub const PROBE_TIMEOUT_DEFAULT: Duration = Duration::from_secs(10);

/// Environment keys preserved for probe children. Everything else is
/// dropped so an inherited runtime overlay (ORCA_*, an inherited
/// PI_CODING_AGENT_DIR, provider session vars) cannot redirect a probe or
/// leak session metadata into it. `PATH` must survive or nothing resolves.
/// Credential variables are deliberately NOT preserved: probes must not
/// trigger token refresh through the user profile.
const PROBE_ENV_KEEP: &[&str] = &[
    "PATH", "HOME", "TMPDIR", "SHELL", "USER", "LOGNAME", "LANG", "LC_ALL", "TMP", "TEMP",
];

/// One enumerated model, exactly as the harness's own surface reported it.
/// `context`/`max_output` stay raw strings (e.g. `"262.1K"`) — this module
/// does not invent token-count precision the source format does not carry.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    /// Owning provider as reported (`pi --list-models` first column;
    /// `opencode models` `provider/id` prefix). `None` for surfaces that
    /// report bare ids.
    pub provider: Option<String>,
    /// Exact model id as reported. Selections match against this verbatim.
    pub id: String,
    /// Raw reported context window, uninterpreted.
    pub context: Option<String>,
    /// Raw reported max output, uninterpreted.
    pub max_output: Option<String>,
    /// Whether the harness marks the model thinking-capable, as reported.
    pub thinking: Option<bool>,
    /// Whether the harness marks the model image-capable, as reported.
    pub images: Option<bool>,
}

/// How one catalog was produced. Every field is a fact about the probe, so
/// consumers can render "enumerated by pi 0.85.1 against a credential-free
/// isolated config at <time>" instead of an unearned "confirmed".
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeProvenance {
    /// Absolute executable the probe ran, from discovery.
    pub executable: PathBuf,
    /// The enumeration argv (e.g. `["--list-models"]`), for the record.
    pub argv: Vec<String>,
    /// First line of the bounded `--version` probe, if it succeeded.
    pub version: Option<String>,
    /// When the probe ran.
    pub probed_at: SystemTime,
    /// Human-readable config scope. One of:
    /// `"isolated-empty-config (credential-free)"` (Pi; no user providers
    /// enumerated), `"isolated-opencode-config-dir"` (OpenCode; built-in
    /// catalog only), `"caller-enumerated:<label>"` (entries supplied by a
    /// daemon-side layer that owns config resolution; this crate did not
    /// read any config), or `"process-environment"` (read-only version
    /// probes).
    pub config_scope: String,
}

/// The result of attempting a harness's enumeration surface.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EnumerationStatus {
    /// The harness answered the enumeration; `entries` holds what it
    /// reported (possibly empty — an auth-gated empty answer is still an
    /// honest enumeration of "nothing visible under this scope").
    Enumerated,
    /// The executable is absent or not runnable.
    NotInstalled,
    /// The harness version on this host exposes no model enumeration
    /// command (claude/codex/antigravity today). `note` says what was
    /// captured instead (usually just the version probe).
    UnsupportedSurface,
    /// The probe ran but its output could not be parsed. `note` carries a
    /// bounded sample so operators can see what the surface actually said.
    ParseFailed,
    /// The probe child exceeded the wall-clock budget and was killed.
    TimedOut,
}

/// A host-scoped model catalog for one harness.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostCatalog {
    pub harness: HarnessId,
    /// Installation/launcher verdict from [`crate::discover`] for the same
    /// executable search — the catalog never re-derives availability.
    pub availability: HarnessAvailability,
    pub executable: Option<PathBuf>,
    /// Present for every probe attempt, including failures (the attempt
    /// itself is provenance).
    pub provenance: Option<ProbeProvenance>,
    pub entries: Vec<CatalogEntry>,
    pub status: EnumerationStatus,
    /// Honesty scope notes (auth-gating, built-in-only enumeration, raw
    /// parse sample on failure). Never credential material.
    pub note: Option<String>,
}

impl HostCatalog {
    fn unavailable(harness: HarnessId, availability: HarnessAvailability) -> Self {
        Self {
            harness,
            availability,
            executable: None,
            provenance: None,
            entries: Vec::new(),
            status: EnumerationStatus::NotInstalled,
            note: None,
        }
    }

    /// A catalog whose entries were enumerated by the CALLER (a daemon-side
    /// layer that owns config resolution and its own credential rules), not
    /// by this crate. `label` names that layer for provenance
    /// (`"caller-enumerated:<label>"`). This crate performs no config or
    /// credential reads here; the contract is that `entries` were produced
    /// under the caller's own established rules.
    pub fn caller_enumerated(
        harness: HarnessId,
        availability: HarnessAvailability,
        executable: Option<PathBuf>,
        version: Option<String>,
        label: &str,
        entries: Vec<CatalogEntry>,
        note: Option<String>,
    ) -> Self {
        Self {
            harness,
            availability,
            executable: executable.clone(),
            provenance: Some(ProbeProvenance {
                executable: executable.unwrap_or_default(),
                argv: Vec::new(),
                version,
                probed_at: SystemTime::now(),
                config_scope: format!("caller-enumerated:{label}"),
            }),
            entries,
            status: EnumerationStatus::Enumerated,
            note,
        }
    }
}

/// A normalized, **non-security** freshness token for a catalog: the
/// executable file name, the probed version (or `?`), and the sorted
/// `provider/id` keys joined. Two probes of an unchanged host produce the
/// same token; a version bump, a catalog refresh or a model-set change
/// produces a different one, which is exactly the "model-change
/// invalidation" signal [`crate::selection::SelectionRecord`] consumes.
///
/// This is explicitly NOT a cryptographic integrity digest — the
/// authoritative runtime integrity lock lives in `drogon-core` — and must
/// not be presented as one.
pub fn freshness_token(catalog: &HostCatalog) -> String {
    let mut keys: Vec<String> = catalog
        .entries
        .iter()
        .map(|entry| match &entry.provider {
            Some(provider) => format!("{provider}/{}", entry.id),
            None => entry.id.clone(),
        })
        .collect();
    keys.sort();
    keys.dedup();
    let version = catalog
        .provenance
        .as_ref()
        .and_then(|provenance| provenance.version.clone())
        .unwrap_or_else(|| "?".to_string());
    let executable = catalog
        .executable
        .as_ref()
        .and_then(|path| path.file_name().and_then(OsStr::to_str).map(str::to_owned))
        .unwrap_or_else(|| catalog.harness.executable().to_string());
    format!("{executable}|{version}|{}", keys.join(";"))
}

/// Probe one harness's catalog, credential-free. `executable` is the
/// discovered absolute path (callers pass [`crate::discover`] results).
/// No probe reads, copies or mirrors user configuration or credentials; an
/// auth-gated surface that enumerates nothing reports an empty catalog
/// with the scope in provenance, and selection validation degrades to
/// manual-unverified accordingly.
pub fn probe_host_catalog(harness: HarnessId, executable: Option<&Path>) -> HostCatalog {
    probe_host_catalog_with_budget(harness, executable, PROBE_TIMEOUT_DEFAULT)
}

/// [`probe_host_catalog`] with an explicit wall-clock budget (tests use a
/// short budget so the timeout kill path is exercised in milliseconds).
pub fn probe_host_catalog_with_budget(
    harness: HarnessId,
    executable: Option<&Path>,
    budget: Duration,
) -> HostCatalog {
    let Some(executable) = executable else {
        return HostCatalog::unavailable(harness, HarnessAvailability::Missing);
    };
    match harness {
        HarnessId::Pi => probe_pi(executable, budget),
        HarnessId::Opencode => probe_opencode(executable, budget),
        HarnessId::Claude | HarnessId::Codex | HarnessId::Antigravity => {
            probe_version_only(harness, executable)
        }
    }
}

/// Pi: `--version` plus `pi --list-models` against an isolated EMPTY
/// `PI_CODING_AGENT_DIR`. Without user auth the surface honestly reports
/// "No models available"; that empty answer is the enumeration. From the
/// installed Pi 0.85.1 docs, `PI_OFFLINE=1` disables startup network
/// operations (update checks, package update checks, telemetry) — it
/// bounds network effects, not file effects, which is why the override dir
/// is a throwaway temp dir and never the user's config. Per coordinator
/// safety guidance this probe never mirrors `auth.json`/`models-store.json`
/// or any credential material to make more models visible.
fn probe_pi(executable: &Path, budget: Duration) -> HostCatalog {
    let env = pi_probe_env();
    let version = probe_version(executable, &env);
    let config_dir = probe_config_dir_path(&env);
    let argv = vec!["--list-models".to_string()];
    let attempt = ProbeAttempt {
        executable,
        argv: &argv,
        env: &env,
    };
    let (provenance, status, entries, note) = match run_probe(&attempt, budget) {
        ProbeRun::Completed(output) => {
            let provenance = ProbeProvenance {
                executable: executable.to_path_buf(),
                argv: argv.clone(),
                version,
                probed_at: SystemTime::now(),
                config_scope: "isolated-empty-config (credential-free; user providers \
                                not enumerated without auth)"
                    .to_string(),
            };
            match parse_pi_list_models(&output) {
                ParseOutcome::Entries(entries) => (
                    provenance,
                    EnumerationStatus::Enumerated,
                    entries,
                    Some(
                        "auth-gated enumeration under an isolated empty config: \
                         pi --list-models only lists models whose provider auth \
                         is configured; user-configured providers are not visible \
                         here and absence is not proof a model does not exist"
                            .to_string(),
                    ),
                ),
                ParseOutcome::Empty => (
                    provenance,
                    EnumerationStatus::Enumerated,
                    Vec::new(),
                    Some(
                        "pi reported no models under the isolated credential-free \
                         config (no auth configured); selections against this \
                         catalog are manual-unverified, not confirmed"
                            .to_string(),
                    ),
                ),
                ParseOutcome::Malformed(sample) => (
                    provenance,
                    EnumerationStatus::ParseFailed,
                    Vec::new(),
                    Some(format!("unrecognized --list-models shape: {sample:?}")),
                ),
            }
        }
        ProbeRun::TimedOut => timed_out(
            executable,
            argv,
            version,
            "isolated-empty-config".to_string(),
        ),
        ProbeRun::SpawnFailed(message) => (
            ProbeProvenance {
                executable: executable.to_path_buf(),
                argv: argv.clone(),
                version,
                probed_at: SystemTime::now(),
                config_scope: "isolated-empty-config".to_string(),
            },
            EnumerationStatus::NotInstalled,
            Vec::new(),
            Some(message),
        ),
    };
    remove_probe_dir(config_dir.as_deref());
    HostCatalog {
        harness: HarnessId::Pi,
        availability: HarnessAvailability::Available,
        executable: Some(executable.to_path_buf()),
        provenance: Some(provenance),
        entries,
        status,
        note,
    }
}

/// OpenCode: `opencode models` (plain `provider/id` lines) with
/// `OPENCODE_CONFIG_DIR` pointed at a fresh temporary dir — OpenCode writes
/// plugin `node_modules` there (observed on 1.18.30), so the user's config
/// dir is never the probe target. Scope note is explicit: the built-in
/// catalog only; user-defined providers are not enumerated.
fn probe_opencode(executable: &Path, budget: Duration) -> HostCatalog {
    let version = probe_version(executable, &base_probe_env());
    let config_dir = std::env::temp_dir().join(nonce_dir("drogon-opencode-probe"));
    if let Err(err) = std::fs::create_dir_all(&config_dir) {
        return HostCatalog {
            harness: HarnessId::Opencode,
            availability: HarnessAvailability::Available,
            executable: Some(executable.to_path_buf()),
            provenance: None,
            entries: Vec::new(),
            status: EnumerationStatus::NotInstalled,
            note: Some(format!("cannot create isolated config dir: {err}")),
        };
    }
    let mut env = base_probe_env();
    env.push((
        "OPENCODE_CONFIG_DIR".to_string(),
        config_dir.to_string_lossy().into_owned(),
    ));
    let argv = vec!["models".to_string()];
    let attempt = ProbeAttempt {
        executable,
        argv: &argv,
        env: &env,
    };
    let (provenance, status, entries, note) = match run_probe(&attempt, budget) {
        ProbeRun::Completed(output) => {
            let provenance = ProbeProvenance {
                executable: executable.to_path_buf(),
                argv: argv.clone(),
                version,
                probed_at: SystemTime::now(),
                config_scope: "isolated-opencode-config-dir (built-in catalog; \
                                user-defined providers not enumerated)"
                    .to_string(),
            };
            match parse_opencode_models(&output) {
                ParseOutcome::Entries(entries) => (
                    provenance,
                    EnumerationStatus::Enumerated,
                    entries,
                    Some(
                        "built-in catalog under an isolated OPENCODE_CONFIG_DIR; \
                         selections against user-defined providers are not \
                         host-validated here"
                            .to_string(),
                    ),
                ),
                ParseOutcome::Empty => (
                    provenance,
                    EnumerationStatus::Enumerated,
                    Vec::new(),
                    Some("opencode reported no models".to_string()),
                ),
                ParseOutcome::Malformed(sample) => (
                    provenance,
                    EnumerationStatus::ParseFailed,
                    Vec::new(),
                    Some(format!("unrecognized `models` shape: {sample:?}")),
                ),
            }
        }
        ProbeRun::TimedOut => timed_out(executable, argv, version, "isolated".to_string()),
        ProbeRun::SpawnFailed(message) => (
            ProbeProvenance {
                executable: executable.to_path_buf(),
                argv: argv.clone(),
                version,
                probed_at: SystemTime::now(),
                config_scope: "isolated".to_string(),
            },
            EnumerationStatus::NotInstalled,
            Vec::new(),
            Some(message),
        ),
    };
    // The probe child is reaped inside `run_probe`; nothing references the
    // isolated dir anymore. Removal is best-effort but checked: a leftover
    // dir means a probe artifact survived and the caller should know.
    let mut note = note;
    if let Err(err) = std::fs::remove_dir_all(&config_dir)
        && note.is_none()
    {
        note = Some(format!("probe config dir not removed: {err}"));
    }
    HostCatalog {
        harness: HarnessId::Opencode,
        availability: HarnessAvailability::Available,
        executable: Some(executable.to_path_buf()),
        provenance: Some(provenance),
        entries,
        status,
        note,
    }
}

/// Harnesses whose CLIs expose no model-enumeration command: capture only
/// the bounded version probe, and say so. Selections for these stay
/// [`crate::selection::SelectionVerdict::NotValidatable`] — shape-checked
/// but never host-confirmed, per the no-fictitious-confirmation rule.
fn probe_version_only(harness: HarnessId, executable: &Path) -> HostCatalog {
    let version = probe_version(executable, &base_probe_env());
    let provenance = ProbeProvenance {
        executable: executable.to_path_buf(),
        argv: Vec::new(),
        version,
        probed_at: SystemTime::now(),
        config_scope: "process-environment (read-only; no enumeration command)".to_string(),
    };
    HostCatalog {
        harness,
        availability: HarnessAvailability::Available,
        executable: Some(executable.to_path_buf()),
        provenance: Some(provenance),
        entries: Vec::new(),
        status: EnumerationStatus::UnsupportedSurface,
        note: Some(
            "this harness exposes no model enumeration surface; only the \
             version probe was captured"
                .to_string(),
        ),
    }
}

fn timed_out(
    executable: &Path,
    argv: Vec<String>,
    version: Option<String>,
    config_scope: String,
) -> (
    ProbeProvenance,
    EnumerationStatus,
    Vec<CatalogEntry>,
    Option<String>,
) {
    (
        ProbeProvenance {
            executable: executable.to_path_buf(),
            argv,
            version,
            probed_at: SystemTime::now(),
            config_scope,
        },
        EnumerationStatus::TimedOut,
        Vec::new(),
        Some("probe exceeded its wall-clock budget and the child was killed".to_string()),
    )
}

/// A uniqueness nonce for probe-owned temp dirs. Not security-sensitive:
/// it only needs to avoid collisions between concurrent probes of one
/// process. No new dependencies (no uuid) per this crate's budget.
fn nonce_dir(prefix: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NONCE: AtomicU64 = AtomicU64::new(0);
    format!(
        "{prefix}-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::Relaxed)
    )
}

/// Minimal probe environment from the current process.
fn base_probe_env() -> Vec<(String, String)> {
    PROBE_ENV_KEEP
        .iter()
        .filter_map(|key| {
            std::env::var(key)
                .ok()
                .map(|value| (key.to_string(), value))
        })
        .collect()
}

/// Pi probe environment: curated base plus an isolated EMPTY
/// `PI_CODING_AGENT_DIR` and offline/no-telemetry overrides from the
/// installed Pi 0.85.1 docs (`PI_OFFLINE=1` disables startup network
/// operations; `PI_TELEMETRY=0` disables telemetry; `PI_SKIP_VERSION_CHECK=1`
/// skips the update check). Credential variables are not carried over, so
/// the probe cannot trigger a token refresh through the user profile. Pi
/// may create `auth.json`/`models-store.json` inside the override dir; the
/// caller removes it after the probe via [`remove_probe_dir`].
fn pi_probe_env() -> Vec<(String, String)> {
    let mut env = base_probe_env();
    let dir = std::env::temp_dir().join(nonce_dir("drogon-pi-probe"));
    if std::fs::create_dir_all(&dir).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
        }
        env.push((
            "PI_CODING_AGENT_DIR".to_string(),
            dir.to_string_lossy().into_owned(),
        ));
    }
    env.push(("PI_OFFLINE".to_string(), "1".to_string()));
    env.push(("PI_TELEMETRY".to_string(), "0".to_string()));
    env.push(("PI_SKIP_VERSION_CHECK".to_string(), "1".to_string()));
    env
}

/// Where `pi_probe_env` pointed the override dir, for checked cleanup.
fn probe_config_dir_path(env: &[(String, String)]) -> Option<PathBuf> {
    env.iter()
        .find(|(key, _)| key == "PI_CODING_AGENT_DIR")
        .map(|(_, value)| PathBuf::from(value))
}

/// Remove a probe-owned dir; exists as one named place so cleanup stays
/// auditable. Best-effort (a still-referenced dir is reported via the
/// catalog note path elsewhere), idempotent.
fn remove_probe_dir(path: Option<&Path>) {
    if let Some(path) = path
        && path.exists()
    {
        let _ = std::fs::remove_dir_all(path);
    }
}

fn probe_version(executable: &Path, env: &[(String, String)]) -> Option<String> {
    let attempt = ProbeAttempt {
        executable,
        argv: &["--version".to_string()],
        env,
    };
    match run_probe(&attempt, Duration::from_secs(5)) {
        ProbeRun::Completed(output) => String::from_utf8_lossy(&output)
            .lines()
            .next()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_string),
        ProbeRun::TimedOut | ProbeRun::SpawnFailed(_) => None,
    }
}

struct ProbeAttempt<'a> {
    executable: &'a Path,
    argv: &'a [String],
    env: &'a [(String, String)],
}

enum ProbeRun {
    Completed(Vec<u8>),
    TimedOut,
    SpawnFailed(String),
}

/// Own the child, then run it: spawn with stdin null and `process_group(0)`
/// (the child's pid is its own pgid), drain both streams under a byte cap,
/// poll `try_wait` against the deadline, and on timeout kill the whole
/// group via `/bin/kill -PGID` (no libc in this crate's dependency budget)
/// and reap. The child is never left zombie: every path ends in a waited
/// exit or a group kill.
fn run_probe(attempt: &ProbeAttempt, budget: Duration) -> ProbeRun {
    let mut command = Command::new(attempt.executable);
    command
        .args(attempt.argv)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_clear()
        .envs(attempt.env.iter().cloned());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(err) => return ProbeRun::SpawnFailed(format!("spawn failed: {err}")),
    };
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let out_reader = spawn_capped_reader(stdout);
    let err_reader = spawn_capped_reader(stderr);
    let deadline = Instant::now() + budget;
    let timed_out = loop {
        match child.try_wait() {
            Ok(Some(_)) => break false,
            Ok(None) => {
                if Instant::now() >= deadline {
                    break true;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(_) => break true,
        }
    };
    if timed_out {
        kill_group_and_reap(&mut child);
    }
    let mut output = out_reader.join().unwrap_or_default();
    let stderr_bytes = err_reader.join().unwrap_or_default();
    output.extend_from_slice(&stderr_bytes);
    if timed_out {
        ProbeRun::TimedOut
    } else {
        ProbeRun::Completed(output)
    }
}

fn spawn_capped_reader(mut stream: impl Read + Send + 'static) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut kept = Vec::new();
        let mut chunk = [0u8; 8192];
        loop {
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    if kept.len() < PROBE_OUTPUT_CAP {
                        let room = PROBE_OUTPUT_CAP - kept.len();
                        kept.extend_from_slice(&chunk[..n.min(room)]);
                    }
                    // Past the cap: keep draining so the child never
                    // blocks on a full pipe, but retain nothing.
                }
                Err(_) => break,
            }
        }
        kept
    })
}

fn kill_group_and_reap(child: &mut Child) {
    #[cfg(unix)]
    {
        let pgid = child.id();
        let term = Command::new("/bin/kill")
            .args(["-TERM", &format!("-{pgid}")])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        if term.is_err() {
            let _ = child.kill();
        }
        let grace = Instant::now() + Duration::from_secs(2);
        while Instant::now() < grace && child.try_wait().ok().flatten().is_none() {
            std::thread::sleep(Duration::from_millis(10));
        }
        if child.try_wait().ok().flatten().is_none() {
            let _ = Command::new("/bin/kill")
                .args(["-KILL", &format!("-{pgid}")])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            let hard = Instant::now() + Duration::from_secs(2);
            while Instant::now() < hard && child.try_wait().ok().flatten().is_none() {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        // Final reap so no zombie survives the probe.
        let _ = child.wait();
    }
    #[cfg(not(unix))]
    {
        let _ = child.kill();
        let hard = Instant::now() + Duration::from_secs(2);
        while Instant::now() < hard && child.try_wait().ok().flatten().is_none() {
            std::thread::sleep(Duration::from_millis(10));
        }
        let _ = child.wait();
    }
}

enum ParseOutcome {
    Entries(Vec<CatalogEntry>),
    Empty,
    Malformed(String),
}

/// Parse the fixed-column `pi --list-models` table observed on Pi 0.85.1:
/// a header row starting with `provider`, then rows whose columns are
/// separated by runs of 2+ spaces (`provider model context max-out thinking
/// images`). The auth-empty case prints a `No models available` line. Any
/// row that yields at least provider+model counts; if nothing parses, the
/// output is malformed.
fn parse_pi_list_models(output: &[u8]) -> ParseOutcome {
    let text = String::from_utf8_lossy(output);
    let mut entries = Vec::new();
    // Rows only count once the fixed-column header has been seen; without
    // that anchor, arbitrary multi-word output (an HTML error page, a
    // banner) would masquerade as catalog rows.
    let mut saw_header = false;
    for line in text.lines() {
        let line = line.trim_end();
        if line.trim().is_empty() {
            continue;
        }
        if line.starts_with("provider") {
            saw_header = true;
            continue;
        }
        if line.contains("No models available") {
            return if entries.is_empty() {
                ParseOutcome::Empty
            } else {
                ParseOutcome::Entries(entries)
            };
        }
        if !saw_header {
            continue;
        }
        let columns: Vec<&str> = line.split_whitespace().collect();
        if columns.len() < 2 {
            continue;
        }
        let thinking = columns.get(4).map(|value| *value == "yes");
        let images = columns.get(5).map(|value| *value == "yes");
        entries.push(CatalogEntry {
            provider: Some(columns[0].to_string()),
            id: columns[1].to_string(),
            context: columns.get(2).map(|value| value.to_string()),
            max_output: columns.get(3).map(|value| value.to_string()),
            thinking,
            images,
        });
    }
    if entries.is_empty() {
        let sample: String = text.chars().take(200).collect();
        if sample.trim().is_empty() {
            ParseOutcome::Empty
        } else {
            ParseOutcome::Malformed(sample)
        }
    } else {
        ParseOutcome::Entries(entries)
    }
}

/// Parse `opencode models` output: one `provider/id` per line, blank lines
/// and `#` comments skipped. Ids without a `/` are kept provider-less.
fn parse_opencode_models(output: &[u8]) -> ParseOutcome {
    let text = String::from_utf8_lossy(output);
    let mut entries = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (provider, id) = match line.split_once('/') {
            Some((provider, id)) => (Some(provider.to_string()), id.to_string()),
            None => (None, line.to_string()),
        };
        entries.push(CatalogEntry {
            provider,
            id,
            context: None,
            max_output: None,
            thinking: None,
            images: None,
        });
    }
    if entries.is_empty() {
        let sample: String = text.chars().take(200).collect();
        if sample.trim().is_empty() {
            ParseOutcome::Empty
        } else {
            ParseOutcome::Malformed(sample)
        }
    } else {
        ParseOutcome::Entries(entries)
    }
}

#[cfg(test)]
mod tests {
    use super::{remove_probe_dir, spawn_capped_reader};

    #[test]
    fn remove_probe_dir_is_idempotent() {
        let dir = std::env::temp_dir().join(format!(
            "drogon-remove-probe-dir-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        remove_probe_dir(Some(&dir));
        remove_probe_dir(Some(&dir));
        assert!(!dir.exists());
    }

    /// The capped reader is exercised end-to-end in
    /// `tests/catalog_contract.rs::probe_output_beyond_the_cap_is_drained_not_kept`;
    /// here just a direct unit check with a finite in-process source would
    /// need unstable anonymous pipes, so the unit test covers the helper
    /// contract through a short child instead.
    #[cfg(unix)]
    #[test]
    fn capped_reader_keeps_at_most_the_cap() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("big.txt");
        std::fs::write(&file, vec![b'x'; super::PROBE_OUTPUT_CAP * 2]).unwrap();
        let mut child = std::process::Command::new("/bin/cat")
            .arg(&file)
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let handle = spawn_capped_reader(stdout);
        let kept = handle.join().unwrap();
        assert_eq!(kept.len(), super::PROBE_OUTPUT_CAP);
        let _ = child.wait();
    }
}
