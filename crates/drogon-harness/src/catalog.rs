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
//! Probe isolation and cleanup (coordinator C01-A gates; unix-only):
//! - Probing requires unix process-group and `poll(2)` primitives. On
//!   platforms without them this module fails CLOSED before spawning
//!   anything: [`EnumerationStatus::UnsupportedPlatform`] with an explicit
//!   note. Generic harness launch (session argv/env construction) is
//!   unaffected; only host enumeration is unavailable there.
//! - Every probe child — `--version` included — runs in its own private
//!   root: fresh empty `HOME`, `TMPDIR`, `XDG_CONFIG_HOME`/`XDG_DATA_HOME`/
//!   `XDG_CACHE_HOME`, a private cwd, and harness-specific
//!   `PI_CODING_AGENT_DIR`/`OPENCODE_CONFIG_DIR`, all `0700`, created with
//!   CSPRNG-random names via `create_dir` (a collision or ANY setup error
//!   fails the probe as [`EnumerationStatus::IsolationFailed`]; there is no
//!   fallback to a real profile and never a `remove_dir_all` of a root we
//!   did not create — ownership is tracked and deletion only ever targets
//!   dirs this call created). Entropy failure is also fail-closed: no
//!   time/pid name fallback.
//! - The environment is `env_clear`'d plus a minimal whitelist, so no user
//!   config, plugin discovery, credential variable or inherited runtime
//!   overlay reaches the child.
//! - The child leads its own process group (`process_group(0)`). Pipes are
//!   drained with `poll(2)` under ONE combined byte cap, per-event fairness
//!   caps (a continuously-producing stdout cannot starve the deadline or
//!   stderr checks), and hard deadlines including an unconditional final
//!   bound. The deadline does not stop at leader exit, because a
//!   grandchild that inherits the pipes would otherwise hang the drain
//!   forever — after leader exit the drain continues for a bounded
//!   post-exit grace, then escalates GROUP TERM → GROUP KILL.
//! - Descendant exit is checked evidence, never assumed: `killpg(pgid, 0)`
//!   distinguishes ESRCH (provably empty) from EPERM and other errors
//!   (unverifiable), is re-checked after every grace, and a leader exit
//!   with pipes at EOF is STILL followed by a group check — a background
//!   child with stdio redirected to `/dev/null` holds no pipe and would
//!   otherwise survive a "successful" probe. fcntl and poll errors are
//!   handled, not ignored. Surviving or unverifiable cleanup retains the
//!   probe root (with its path in the catalog note) instead of deleting
//!   evidence.
//! - A process that escapes the group via `setsid`/double-fork is outside
//!   what `killpg` can see; that limit is stated in the evidence whenever
//!   cleanup could not be fully verified, never papered over.
//! - A nonzero leader exit is [`EnumerationStatus::ProbeFailed`] with a
//!   bounded stderr tail: failed or warning output never becomes model
//!   rows.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;

use crate::{HarnessAvailability, HarnessId};

/// Combined stdout+stderr bytes a probe will retain, counted across BOTH
/// streams. Readers keep draining after the cap so a chatty child cannot
/// stall on a full pipe, but only the cap is parsed or kept in memory.
pub const PROBE_OUTPUT_CAP: usize = 1 << 20;

/// Default wall-clock budget for one probe child while its leader runs.
/// Probes of `--version` and `--list-models`-style read-only commands
/// finish in milliseconds; a child exceeding this is escalated, never
/// waited on forever.
pub const PROBE_TIMEOUT_DEFAULT: Duration = Duration::from_secs(10);

/// How long pipe drain continues after the leader exited before the group
/// is TERM-escalated (a grandchild may hold the inherited pipes).
const POST_EXIT_GRACE: Duration = Duration::from_secs(3);

/// Grace after a group TERM before a group KILL, and after a KILL before
/// cleanup is declared unverifiable.
const SIGNAL_GRACE: Duration = Duration::from_secs(2);

/// Bounded wait for the leader to become reapable after its pipes reached
/// EOF (observed on macOS: a window where the writer is gone but
/// waitpid(WNOHANG) still reports the process running).
const REAP_GRACE: Duration = Duration::from_secs(1);

/// Margin over the worst-case escalation chain after which the drain loop
/// stops unconditionally, so no child behavior can hang a probe.
const HARD_STOP_MARGIN: Duration = Duration::from_secs(1);

/// How long the post-leader group check rides out transient teardown
/// statuses (Present/EPERM) before declaring survivors or unverifiable.
const POST_EOF_GROUP_GRACE: Duration = Duration::from_millis(500);

/// Per-fd, per-poll-event drain bound: a continuously-producing child is
/// serviced in slices so deadline, escalation and the sibling stream are
/// all checked between slices.
const DRAIN_PER_EVENT_CAP: usize = 128 * 1024;

/// Environment keys preserved for probe children. Everything else —
/// credentials, runtime overlays, inherited config pointers — is dropped.
/// `PATH` must survive or nothing resolves; `SystemRoot` covers Windows.
const PROBE_ENV_KEEP: &[&str] = &["PATH", "SystemRoot", "WINDIR"];

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
    /// `"private-isolated-root (credential-free)"` (all native probes; no
    /// user providers enumerated without their auth), or
    /// `"caller-enumerated:<label>"` (entries supplied by a daemon-side
    /// layer that owns config resolution; this crate did not read any
    /// config or credential).
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
    /// The harness CLI was not probed because this platform lacks the
    /// unix process-group/poll primitives required for safe, fail-closed
    /// probing. Generic harness launch is unaffected.
    UnsupportedPlatform,
    /// The probe ran but its output could not be parsed. `note` carries a
    /// bounded sample so operators can see what the surface actually said.
    ParseFailed,
    /// The probe child exceeded its wall-clock budget and was killed;
    /// `note` carries the bounded cleanup evidence.
    TimedOut,
    /// The probe child exited non-zero. `note` carries the exit code and a
    /// bounded stderr tail; failed or warning output never becomes model
    /// rows.
    ProbeFailed,
    /// The private probe root could not be created (permissions, temp dir,
    /// entropy). The probe did not run and no fallback to a real profile
    /// was used.
    IsolationFailed,
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
    /// Honesty scope notes (auth-gating, cleanup evidence, retained probe
    /// root after unverifiable cleanup, raw parse sample on failure).
    /// Never credential material.
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
        .and_then(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| catalog.harness.executable().to_string());
    format!("{executable}|{version}|{}", keys.join(";"))
}

/// Probe one harness's catalog, credential-free. `executable` is the
/// discovered absolute path (callers pass [`crate::discover`] results).
/// No probe reads, copies or mirrors user configuration or credentials; an
/// auth-gated surface that enumerates nothing reports an empty catalog
/// with the scope in provenance, and selection validation degrades to
/// manual-unverified accordingly.
///
/// On non-unix platforms this fails closed with
/// [`EnumerationStatus::UnsupportedPlatform`] before spawning anything.
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
    #[cfg(unix)]
    {
        match harness {
            HarnessId::Pi => probe_pi(executable, budget),
            HarnessId::Opencode => probe_opencode(executable, budget),
            HarnessId::Claude | HarnessId::Codex | HarnessId::Antigravity => {
                probe_version_only(harness, executable)
            }
        }
    }
    #[cfg(not(unix))]
    {
        HostCatalog {
            harness,
            availability: HarnessAvailability::Available,
            executable: Some(executable.to_path_buf()),
            provenance: None,
            entries: Vec::new(),
            status: EnumerationStatus::UnsupportedPlatform,
            note: Some(
                "host enumeration requires unix process-group primitives; \
                 failed closed without spawning the executable. Generic \
                 harness launch is unaffected."
                    .to_string(),
            ),
        }
    }
}

#[cfg(all(unix, any(target_os = "macos", target_os = "ios")))]
fn fill_random(buffer: &mut [u8]) -> Result<(), String> {
    // getentropy fills the whole buffer and only returns 0 on success
    // (per Darwin man pages; it does not short-read or return a count).
    // SAFETY: the buffer is valid for its length.
    let rc = unsafe { libc::getentropy(buffer.as_mut_ptr().cast(), buffer.len()) };
    if rc == 0 {
        Ok(())
    } else {
        Err(format!(
            "getentropy failed: {}",
            std::io::Error::last_os_error()
        ))
    }
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "ios"))))]
fn fill_random(buffer: &mut [u8]) -> Result<(), String> {
    // getrandom returns ssize_t: the byte count written (a full or partial
    // fill), 0 only for len 0, and -1 with errno on failure (EINTR means
    // retry). Loop until the whole buffer is filled; no fallback entropy.
    let mut filled = 0usize;
    while filled < buffer.len() {
        // SAFETY: the buffer tail is valid for its remaining length.
        let n = unsafe {
            libc::getrandom(
                buffer[filled..].as_mut_ptr().cast(),
                buffer.len() - filled,
                0,
            )
        };
        if n > 0 {
            filled += n as usize;
            continue;
        }
        if n == 0 {
            return Err("getrandom returned 0 for a non-empty buffer".to_string());
        }
        let err = std::io::Error::last_os_error();
        if err.kind() == std::io::ErrorKind::Interrupted {
            continue;
        }
        return Err(format!("getrandom failed: {err}"));
    }
    Ok(())
}

/// Unpredictable probe dir names from the OS CSPRNG. Any entropy failure
/// propagates: probe isolation fails closed rather than falling back to
/// predictable time/pid names.
#[cfg(unix)]
fn random_hex(bytes: usize) -> Result<String, String> {
    let mut buffer = vec![0u8; bytes];
    fill_random(&mut buffer)?;
    Ok(buffer.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// The private filesystem root one probe child sees. Every directory is
/// created `0700` with `create_dir` (fails rather than reusing anything).
/// `root` is `Some` only for a root THIS call created — a create collision
/// or error therefore can never make `Drop` delete a pre-existing
/// directory.
#[cfg(unix)]
struct ProbeIsolation {
    root: Option<PathBuf>,
    home: PathBuf,
    tmp: PathBuf,
    cwd: PathBuf,
    xdg_config: PathBuf,
    xdg_data: PathBuf,
    xdg_cache: PathBuf,
}

#[cfg(unix)]
impl ProbeIsolation {
    fn create() -> Result<Self, String> {
        let name = random_hex(16).map_err(|err| format!("entropy unavailable: {err}"))?;
        Self::create_at(std::env::temp_dir().join(format!("drogon-probe-{name}")))
    }

    /// Creates the private root at an exact path (test seam for collision
    /// and permission paths). Fails without deleting anything if `root`
    /// already exists or any child dir cannot be created; only a root this
    /// call created is ever removed, and only by `Drop`.
    fn create_at(root: PathBuf) -> Result<Self, String> {
        create_private_dir(&root)?;
        let isolation = Self {
            home: root.join("home"),
            tmp: root.join("tmp"),
            cwd: root.join("cwd"),
            xdg_config: root.join("xdg-config"),
            xdg_data: root.join("xdg-data"),
            xdg_cache: root.join("xdg-cache"),
            root: Some(root),
        };
        for dir in [
            &isolation.home,
            &isolation.tmp,
            &isolation.cwd,
            &isolation.xdg_config,
            &isolation.xdg_data,
            &isolation.xdg_cache,
        ] {
            create_private_dir(dir)?;
        }
        Ok(isolation)
    }

    /// Keep the root on disk (unverifiable cleanup) and return its path so
    /// the caller can record it as evidence.
    fn disarm(mut self) -> Option<PathBuf> {
        self.root.take()
    }

    fn root(&self) -> &Path {
        self.root.as_deref().expect("root set after create_at")
    }

    /// The probe child environment: cleared, whitelisted, and pointed
    /// entirely inside the private root. Harness-specific dirs are added
    /// by the caller on top of this.
    fn env(&self) -> Vec<(String, String)> {
        let mut env: Vec<(String, String)> = PROBE_ENV_KEEP
            .iter()
            .filter_map(|key| {
                std::env::var(key)
                    .ok()
                    .map(|value| (key.to_string(), value))
            })
            .collect();
        let set = |env: &mut Vec<(String, String)>, key: &str, value: PathBuf| {
            env.push((key.to_string(), value.to_string_lossy().into_owned()));
        };
        set(&mut env, "HOME", self.home.clone());
        set(&mut env, "TMPDIR", self.tmp.clone());
        set(&mut env, "TMP", self.tmp.clone());
        set(&mut env, "TEMP", self.tmp.clone());
        set(&mut env, "XDG_CONFIG_HOME", self.xdg_config.clone());
        set(&mut env, "XDG_DATA_HOME", self.xdg_data.clone());
        set(&mut env, "XDG_CACHE_HOME", self.xdg_cache.clone());
        env
    }
}

#[cfg(unix)]
impl Drop for ProbeIsolation {
    fn drop(&mut self) {
        // Only a root this call created is removed, and only when not
        // disarmed for retention.
        if let Some(root) = &self.root
            && root.exists()
        {
            let _ = std::fs::remove_dir_all(root);
        }
    }
}

#[cfg(unix)]
fn create_private_dir(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(path)
        .map_err(|err| format!("cannot create private dir {}: {err}", path.display()))?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
        .map_err(|err| format!("cannot chmod {}: {err}", path.display()))?;
    Ok(())
}

#[cfg(unix)]
fn isolation_failed_catalog(harness: HarnessId, executable: &Path, reason: String) -> HostCatalog {
    HostCatalog {
        harness,
        availability: HarnessAvailability::Available,
        executable: Some(executable.to_path_buf()),
        provenance: Some(ProbeProvenance {
            executable: executable.to_path_buf(),
            argv: Vec::new(),
            version: None,
            probed_at: SystemTime::now(),
            config_scope: "private-isolated-root (credential-free)".to_string(),
        }),
        entries: Vec::new(),
        status: EnumerationStatus::IsolationFailed,
        note: Some(reason),
    }
}

/// Pi: `--version` plus `pi --list-models` inside a private isolated root
/// with an empty `PI_CODING_AGENT_DIR`. Without user auth the surface
/// honestly reports "No models available"; that empty answer is the
/// enumeration. `PI_OFFLINE=1` is set per the installed Pi 0.85.1 docs
/// ("disable all startup network operations"); `PI_TELEMETRY=0` and
/// `PI_SKIP_VERSION_CHECK=1` keep the probe from phoning home or nagging.
/// Per coordinator safety guidance this probe never mirrors
/// `auth.json`/`models-store.json` or any credential material to make more
/// models visible.
#[cfg(unix)]
fn probe_pi(executable: &Path, budget: Duration) -> HostCatalog {
    let isolation = match ProbeIsolation::create() {
        Ok(isolation) => isolation,
        Err(reason) => return isolation_failed_catalog(HarnessId::Pi, executable, reason),
    };
    let mut env = isolation.env();
    let pi_agent = isolation.root().join("pi-agent");
    if let Err(err) = create_private_dir(&pi_agent) {
        return isolation_failed_catalog(HarnessId::Pi, executable, err);
    }
    env.push((
        "PI_CODING_AGENT_DIR".to_string(),
        pi_agent.to_string_lossy().into_owned(),
    ));
    env.push(("PI_OFFLINE".to_string(), "1".to_string()));
    env.push(("PI_TELEMETRY".to_string(), "0".to_string()));
    env.push(("PI_SKIP_VERSION_CHECK".to_string(), "1".to_string()));

    let version = probe_version(executable, &env, isolation.root());
    let argv = vec!["--list-models".to_string()];
    let attempt = ProbeAttempt {
        executable,
        argv: &argv,
        env: &env,
        cwd: &isolation.cwd,
    };
    let outcome = run_probe(&attempt, budget);
    let cleanup_note = outcome.cleanup_note();
    let retained = if outcome.cleanup_verified {
        None
    } else {
        isolation.disarm()
    };
    let (provenance, status, entries, mut note) = match outcome.run {
        ProbeRun::Completed { output, .. } => {
            let provenance = probe_provenance(executable, argv.clone(), version);
            match parse_pi_list_models(&output) {
                ParseOutcome::Entries(entries) => (
                    provenance,
                    EnumerationStatus::Enumerated,
                    entries,
                    Some(
                        "auth-gated enumeration under a private isolated config: \
                         pi --list-models only lists models whose provider auth is \
                         configured; user-configured providers are not visible here \
                         and absence is not proof a model does not exist"
                            .to_string(),
                    ),
                ),
                ParseOutcome::Empty => (
                    provenance,
                    EnumerationStatus::Enumerated,
                    Vec::new(),
                    Some(
                        "pi reported no models under the private credential-free \
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
        ProbeRun::FailedExit {
            stderr_tail,
            exit_code,
            ..
        } => (
            probe_provenance(executable, argv.clone(), version),
            EnumerationStatus::ProbeFailed,
            Vec::new(),
            Some(format!(
                "pi --list-models exited {exit_code}: {stderr_tail}"
            )),
        ),
        ProbeRun::TimedOut { evidence, .. } => (
            probe_provenance(executable, argv.clone(), version),
            EnumerationStatus::TimedOut,
            Vec::new(),
            Some(format!("probe exceeded its wall-clock budget; {evidence}")),
        ),
        ProbeRun::SpawnFailed(message) => (
            probe_provenance(executable, argv.clone(), version),
            EnumerationStatus::NotInstalled,
            Vec::new(),
            Some(message),
        ),
    };
    if let Some(cleanup) = cleanup_note {
        note = Some(format!("{}; {cleanup}", note.unwrap_or_default()));
    }
    if let Some(path) = retained {
        note = Some(format!(
            "{}; probe root retained for inspection: {} (descendant cleanup unverifiable)",
            note.unwrap_or_default(),
            path.display()
        ));
    }
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

/// OpenCode: `opencode models` (plain `provider/id` lines) inside a
/// private isolated root whose `OPENCODE_CONFIG_DIR` is empty — OpenCode
/// writes plugin `node_modules` into that dir (observed on 1.18.30), so
/// the user's config dir is never the probe target. Scope note is
/// explicit: the built-in catalog only; user-defined providers are not
/// enumerated.
#[cfg(unix)]
fn probe_opencode(executable: &Path, budget: Duration) -> HostCatalog {
    let isolation = match ProbeIsolation::create() {
        Ok(isolation) => isolation,
        Err(reason) => return isolation_failed_catalog(HarnessId::Opencode, executable, reason),
    };
    let mut env = isolation.env();
    let opencode_dir = isolation.root().join("opencode-config");
    if let Err(err) = create_private_dir(&opencode_dir) {
        return isolation_failed_catalog(HarnessId::Opencode, executable, err);
    }
    env.push((
        "OPENCODE_CONFIG_DIR".to_string(),
        opencode_dir.to_string_lossy().into_owned(),
    ));
    let version = probe_version(executable, &env, isolation.root());
    let argv = vec!["models".to_string()];
    let attempt = ProbeAttempt {
        executable,
        argv: &argv,
        env: &env,
        cwd: &isolation.cwd,
    };
    let outcome = run_probe(&attempt, budget);
    let cleanup_note = outcome.cleanup_note();
    let retained = if outcome.cleanup_verified {
        None
    } else {
        isolation.disarm()
    };
    let (provenance, status, entries, mut note) = match outcome.run {
        ProbeRun::Completed { output, .. } => {
            let provenance = probe_provenance(executable, argv.clone(), version);
            match parse_opencode_models(&output) {
                ParseOutcome::Entries(entries) => (
                    provenance,
                    EnumerationStatus::Enumerated,
                    entries,
                    Some(
                        "built-in catalog under a private isolated OPENCODE_CONFIG_DIR; \
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
        ProbeRun::FailedExit {
            stderr_tail,
            exit_code,
            ..
        } => (
            probe_provenance(executable, argv.clone(), version),
            EnumerationStatus::ProbeFailed,
            Vec::new(),
            Some(format!("opencode models exited {exit_code}: {stderr_tail}")),
        ),
        ProbeRun::TimedOut { evidence, .. } => (
            probe_provenance(executable, argv.clone(), version),
            EnumerationStatus::TimedOut,
            Vec::new(),
            Some(format!("probe exceeded its wall-clock budget; {evidence}")),
        ),
        ProbeRun::SpawnFailed(message) => (
            probe_provenance(executable, argv.clone(), version),
            EnumerationStatus::NotInstalled,
            Vec::new(),
            Some(message),
        ),
    };
    if let Some(cleanup) = cleanup_note {
        note = Some(format!("{}; {cleanup}", note.unwrap_or_default()));
    }
    if let Some(path) = retained {
        note = Some(format!(
            "{}; probe root retained for inspection: {} (descendant cleanup unverifiable)",
            note.unwrap_or_default(),
            path.display()
        ));
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
#[cfg(unix)]
fn probe_version_only(harness: HarnessId, executable: &Path) -> HostCatalog {
    let isolation = match ProbeIsolation::create() {
        Ok(isolation) => isolation,
        Err(reason) => return isolation_failed_catalog(harness, executable, reason),
    };
    let env = isolation.env();
    let version = probe_version(executable, &env, isolation.root());
    let provenance = ProbeProvenance {
        executable: executable.to_path_buf(),
        argv: Vec::new(),
        version,
        probed_at: SystemTime::now(),
        config_scope: "private-isolated-root (read-only; no enumeration command)".to_string(),
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

#[cfg(unix)]
fn probe_provenance(
    executable: &Path,
    argv: Vec<String>,
    version: Option<String>,
) -> ProbeProvenance {
    ProbeProvenance {
        executable: executable.to_path_buf(),
        argv,
        version,
        probed_at: SystemTime::now(),
        config_scope: "private-isolated-root (credential-free)".to_string(),
    }
}

#[cfg(unix)]
fn probe_version(executable: &Path, env: &[(String, String)], cwd: &Path) -> Option<String> {
    let attempt = ProbeAttempt {
        executable,
        argv: &["--version".to_string()],
        env,
        cwd,
    };
    match run_probe(&attempt, Duration::from_secs(5)).run {
        ProbeRun::Completed { output, .. } => String::from_utf8_lossy(&output)
            .lines()
            .next()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_string),
        ProbeRun::FailedExit { .. } | ProbeRun::TimedOut { .. } | ProbeRun::SpawnFailed(_) => None,
    }
}

#[cfg(unix)]
struct ProbeAttempt<'a> {
    executable: &'a Path,
    argv: &'a [String],
    env: &'a [(String, String)],
    cwd: &'a Path,
}

#[cfg(unix)]
enum ProbeRun {
    /// The leader exited zero. `output` is the combined, cap-bounded
    /// stdout+stderr.
    Completed {
        output: Vec<u8>,
    },
    /// The leader exited non-zero. Never parsed into catalog rows.
    FailedExit {
        stderr_tail: String,
        exit_code: String,
    },
    /// The wall-clock budget expired and the group was escalated;
    /// `evidence` records what the group-signal steps could and could not
    /// prove about descendant exit.
    TimedOut {
        evidence: String,
    },
    SpawnFailed(String),
}

#[cfg(unix)]
struct ProbeOutcome {
    run: ProbeRun,
    /// Whether every descendant's exit was proven (group-empty via ESRCH)
    /// at every step. When false, callers retain the probe root as
    /// evidence instead of deleting it.
    cleanup_verified: bool,
    /// Evidence of descendant cleanup needed after leader exit; `None` on
    /// an ordinary clean exit.
    post_exit_cleanup: Option<String>,
}

#[cfg(unix)]
impl ProbeOutcome {
    /// Evidence of descendant cleanup for the catalog note: the recorded
    /// escalation evidence, plus — whenever cleanup was not fully verified
    /// — an explicit statement of what could not be proven (a
    /// setsid-detached process is outside killpg visibility).
    fn cleanup_note(&self) -> Option<String> {
        let unverifiable = "descendant cleanup unverifiable (EPERM/killpg \
                            error, hard stop, or surviving group members; a \
                            setsid-detached process is outside killpg \
                            visibility)";
        match (&self.post_exit_cleanup, self.cleanup_verified) {
            (Some(evidence), true) => Some(evidence.clone()),
            (Some(evidence), false) => Some(format!("{evidence}; {unverifiable}")),
            (None, false) => Some(unverifiable.to_string()),
            (None, true) => None,
        }
    }
}

/// Bounded stderr tail for the failure note.
#[cfg(unix)]
const FAILURE_TAIL_LIMIT: usize = 400;

#[cfg(unix)]
mod run {
    use super::{
        DRAIN_PER_EVENT_CAP, FAILURE_TAIL_LIMIT, HARD_STOP_MARGIN, POST_EOF_GROUP_GRACE,
        POST_EXIT_GRACE, ProbeAttempt, ProbeOutcome, ProbeRun, REAP_GRACE, SIGNAL_GRACE,
    };
    use std::os::unix::io::AsRawFd;
    use std::process::{Child, Command, ExitStatus, Stdio};
    use std::time::{Duration, Instant};

    /// What `killpg(pgid, 0)` could prove. Only ESRCH demonstrates absence;
    /// EPERM and other errors leave the answer unknown, never "empty".
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    enum GroupStatus {
        Empty,
        Present,
        Unknown,
    }

    fn group_status(pgid: u32) -> GroupStatus {
        // SAFETY: kill with sig 0 performs no action beyond error checking.
        let rc = unsafe { libc::killpg(pgid as libc::pid_t, 0) };
        if rc == 0 {
            return GroupStatus::Present;
        }
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() == Some(libc::ESRCH) {
            GroupStatus::Empty
        } else {
            GroupStatus::Unknown
        }
    }

    fn describe_group(status: GroupStatus) -> &'static str {
        match status {
            GroupStatus::Empty => "group-empty",
            GroupStatus::Present => "group-present",
            GroupStatus::Unknown => "group-membership-unverifiable(EPERM-or-other)",
        }
    }

    fn signal_group(pgid: u32, signal: libc::c_int, evidence: &mut Vec<String>) {
        // SAFETY: killpg signals every process in the group; the group was
        // created by us with process_group(0) and contains only probe
        // descendants.
        let rc = unsafe { libc::killpg(pgid as libc::pid_t, signal) };
        let name = if signal == libc::SIGTERM {
            "SIGTERM"
        } else {
            "SIGKILL"
        };
        if rc == 0 {
            evidence.push(format!("group {name} delivered"));
        } else {
            evidence.push(format!(
                "group {name} failed: {}",
                std::io::Error::last_os_error()
            ));
        }
    }

    /// Poll group membership until it is provably Empty or the deadline
    /// passes. `child` is reaped while polling: a leader that has exited
    /// but not been waited still counts as a group member, which would
    /// otherwise exhaust every grace as a false "survivor". Non-Empty
    /// statuses are ridden out rather than sampled once: macOS returns
    /// EPERM transiently while a group tears down (observed: errno 1 on
    /// the poll right after SIGTERM, ESRCH one tick later), so a single
    /// check would report unverifiable exactly when cleanup was working.
    fn wait_group_empty(pgid: u32, child: &mut Child, deadline: Instant) -> GroupStatus {
        let mut last = group_status(pgid);
        while last != GroupStatus::Empty && Instant::now() < deadline {
            let _ = child.try_wait();
            std::thread::sleep(Duration::from_millis(10));
            last = group_status(pgid);
        }
        last
    }

    /// Escalate the whole process group and collect checked evidence about
    /// descendant exit. Returns whether the group was provably empty at
    /// the end; mere signal delivery is never reported as verified exit.
    fn escalate_group(pgid: u32, child: &mut Child, evidence: &mut Vec<String>) -> bool {
        signal_group(pgid, libc::SIGTERM, evidence);
        let term_deadline = Instant::now() + SIGNAL_GRACE;
        match wait_group_empty(pgid, child, term_deadline) {
            GroupStatus::Empty => {
                evidence.push("group-empty after SIGTERM".to_string());
                true
            }
            GroupStatus::Unknown => {
                evidence.push(
                    "group membership unverifiable after SIGTERM grace (EPERM or \
                     other killpg error persisted)"
                        .to_string(),
                );
                false
            }
            GroupStatus::Present => {
                evidence.push("group survived SIGTERM; escalating to SIGKILL".to_string());
                signal_group(pgid, libc::SIGKILL, evidence);
                let kill_deadline = Instant::now() + SIGNAL_GRACE;
                let final_status = wait_group_empty(pgid, child, kill_deadline);
                evidence.push(format!(
                    "group after SIGKILL: {}",
                    describe_group(final_status)
                ));
                matches!(final_status, GroupStatus::Empty)
            }
        }
    }

    #[derive(Clone, Copy)]
    enum Stream {
        Stdout,
        Stderr,
    }

    struct PipeState {
        raw: std::os::unix::io::RawFd,
        stream: Stream,
        open: bool,
        bytes: Vec<u8>,
    }

    /// Read available data on a nonblocking pipe fd, bounded per event so
    /// one chatty stream cannot starve the deadline, escalation checks or
    /// the sibling stream. Returns false once EOF is reached.
    fn drain(pipe: &mut PipeState, combined: &mut usize, cap: usize) -> bool {
        let mut chunk = [0u8; 8192];
        let mut served = 0usize;
        while served < DRAIN_PER_EVENT_CAP {
            // SAFETY: `raw` is a live, owned pipe fd in nonblocking mode.
            let n = unsafe { libc::read(pipe.raw, chunk.as_mut_ptr().cast(), chunk.len()) };
            if n > 0 {
                let n = n as usize;
                let room = cap.saturating_sub(*combined);
                pipe.bytes.extend_from_slice(&chunk[..n.min(room)]);
                *combined += n;
                served += n;
                continue;
            }
            if n == 0 {
                return false; // EOF: every writer (incl. descendants) closed it.
            }
            let err = std::io::Error::last_os_error();
            if err.kind() == std::io::ErrorKind::WouldBlock {
                return true; // EAGAIN: drained for this event.
            }
            if err.kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            return false; // EIO and friends: treat as closed-with-error.
        }
        true
    }

    fn failure_tail(bytes: &[u8]) -> String {
        let text = String::from_utf8_lossy(bytes);
        let tail: String = text.chars().rev().take(FAILURE_TAIL_LIMIT).collect();
        tail.chars().rev().collect()
    }

    fn set_nonblocking(raw: std::os::unix::io::RawFd) -> Result<(), std::io::Error> {
        // SAFETY: fcntl on a live, owned pipe fd.
        unsafe {
            let flags = libc::fcntl(raw, libc::F_GETFL);
            if flags == -1 {
                return Err(std::io::Error::last_os_error());
            }
            if libc::fcntl(raw, libc::F_SETFL, flags | libc::O_NONBLOCK) == -1 {
                return Err(std::io::Error::last_os_error());
            }
        }
        Ok(())
    }

    pub fn run_probe(attempt: &ProbeAttempt, budget: Duration) -> ProbeOutcome {
        let mut command = Command::new(attempt.executable);
        command
            .args(attempt.argv)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env_clear()
            .envs(attempt.env.iter().cloned())
            .current_dir(attempt.cwd);
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child: Child = match command.spawn() {
            Ok(child) => child,
            Err(err) => {
                return ProbeOutcome {
                    run: ProbeRun::SpawnFailed(format!("spawn failed: {err}")),
                    cleanup_verified: true,
                    post_exit_cleanup: None,
                };
            }
        };
        let pgid = child.id();
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        let mut evidence: Vec<String> = Vec::new();
        let mut cleanup_verified = true;
        if let Err(err) = set_nonblocking(stdout.as_raw_fd()) {
            evidence.push(format!("set_nonblocking(stdout) failed: {err}"));
            cleanup_verified = false;
        }
        if let Err(err) = set_nonblocking(stderr.as_raw_fd()) {
            evidence.push(format!("set_nonblocking(stderr) failed: {err}"));
            cleanup_verified = false;
        }
        if !cleanup_verified {
            // Nonblocking setup failed: draining could block, so fail
            // closed instead of probing further.
            escalate_group(pgid, &mut child, &mut evidence);
            let _ = child.kill();
            let _ = child.wait();
            return ProbeOutcome {
                run: ProbeRun::TimedOut {
                    evidence: evidence.join("; "),
                },
                cleanup_verified,
                post_exit_cleanup: None,
            };
        }
        let mut pipes = [
            PipeState {
                raw: stdout.as_raw_fd(),
                stream: Stream::Stdout,
                open: true,
                bytes: Vec::new(),
            },
            PipeState {
                raw: stderr.as_raw_fd(),
                stream: Stream::Stderr,
                open: true,
                bytes: Vec::new(),
            },
        ];
        let mut combined = 0usize;

        let deadline = Instant::now() + budget;
        // Unconditional final bound: budget, plus the worst-case escalation
        // chain (post-exit grace, TERM wait, KILL wait), reap, and margin.
        // No child behavior can keep the probe alive past this.
        let hard_stop = deadline
            + POST_EXIT_GRACE
            + SIGNAL_GRACE
            + SIGNAL_GRACE
            + REAP_GRACE
            + HARD_STOP_MARGIN;
        let mut leader_exited: Option<ExitStatus> = None;
        let mut exit_deadline: Option<Instant> = None;
        let mut escalated = false;
        let mut budget_expired = false;

        loop {
            // Leader exit is cheap to check every iteration; it does NOT
            // end the drain while descendants may still hold the pipes.
            if leader_exited.is_none()
                && let Ok(Some(status)) = child.try_wait()
            {
                leader_exited = Some(status);
                exit_deadline = Some(Instant::now() + POST_EXIT_GRACE);
            }

            if pipes.iter().all(|pipe| !pipe.open) {
                break;
            }

            let now = Instant::now();
            if now >= hard_stop {
                escalated = true;
                evidence.push("unconditional hard stop reached".to_string());
                cleanup_verified = false;
                escalate_group(pgid, &mut child, &mut evidence);
                break;
            }
            if !escalated && (now >= deadline || exit_deadline.is_some_and(|d| now >= d)) {
                escalated = true;
                if now >= deadline && leader_exited.is_none() {
                    budget_expired = true;
                    evidence.push(format!("leader still running after {budget:?} budget"));
                } else {
                    evidence.push(
                        "leader exited but pipes stayed open past the post-exit grace \
                         (descendants hold them)"
                            .to_string(),
                    );
                }
                if !escalate_group(pgid, &mut child, &mut evidence) {
                    cleanup_verified = false;
                }
            }
            // Post-escalation bail: group demonstrably empty but EOF never
            // arrived (pathological holder). Bounded by hard_stop.
            if escalated
                && matches!(group_status(pgid), GroupStatus::Empty)
                && exit_deadline.is_some_and(|d| Instant::now() >= d + SIGNAL_GRACE + SIGNAL_GRACE)
            {
                evidence.push(
                    "group empty but pipe EOF unconfirmed; proceeding with captured \
                     bytes (pipe holders unverifiable)"
                        .to_string(),
                );
                cleanup_verified = false;
                break;
            }

            let timeout = if escalated {
                Duration::from_millis(50)
            } else {
                let hard_left = deadline.saturating_duration_since(now);
                let grace_left = exit_deadline
                    .map(|d| d.saturating_duration_since(now))
                    .unwrap_or(hard_left)
                    .min(hard_left);
                grace_left.clamp(Duration::from_millis(1), Duration::from_millis(50))
            };
            let mut poll_fds: Vec<libc::pollfd> = pipes
                .iter()
                .filter(|pipe| pipe.open)
                .map(|pipe| libc::pollfd {
                    fd: pipe.raw,
                    events: libc::POLLIN,
                    revents: 0,
                })
                .collect();
            // SAFETY: poll_fds is a valid array for the given length; none
            // of the polled fds are closed while polling.
            let ready = unsafe {
                libc::poll(
                    poll_fds.as_mut_ptr(),
                    poll_fds.len() as libc::nfds_t,
                    timeout.as_millis() as libc::c_int,
                )
            };
            if ready < 0 {
                let err = std::io::Error::last_os_error();
                if err.kind() != std::io::ErrorKind::Interrupted {
                    evidence.push(format!("poll failed: {err}"));
                    cleanup_verified = false;
                }
                continue;
            }
            if ready > 0 {
                for poll_fd in &poll_fds {
                    let Some(pipe) = pipes.iter_mut().find(|p| p.raw == poll_fd.fd) else {
                        continue;
                    };
                    let hangup = poll_fd.revents & (libc::POLLHUP | libc::POLLERR) != 0;
                    let readable = poll_fd.revents & libc::POLLIN != 0;
                    if (readable || hangup) && !drain(pipe, &mut combined, super::PROBE_OUTPUT_CAP)
                    {
                        pipe.open = false;
                    }
                }
            }
        }

        // Pipe EOF means every PIPE writer is gone, so the leader is
        // exiting — but on macOS there is a window where waitpid(WNOHANG)
        // still reports it running, which must not be mistaken for a
        // timeout. Reap it with a bounded wait; a leader that closed its
        // fds but keeps running is pathological and gets escalated.
        if leader_exited.is_none() {
            let reap_deadline = Instant::now() + REAP_GRACE;
            while leader_exited.is_none() && Instant::now() < reap_deadline {
                if let Ok(Some(status)) = child.try_wait() {
                    leader_exited = Some(status);
                    break;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        }
        if leader_exited.is_none() {
            evidence.push("leader closed its pipes but did not exit; escalating".to_string());
            if !escalate_group(pgid, &mut child, &mut evidence) {
                cleanup_verified = false;
            }
            let kill_deadline = Instant::now() + SIGNAL_GRACE;
            while leader_exited.is_none() && Instant::now() < kill_deadline {
                if let Ok(Some(status)) = child.try_wait() {
                    leader_exited = Some(status);
                    break;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            if leader_exited.is_none() {
                cleanup_verified = false;
            }
        }

        // EOF + exited leader is NOT enough: a background child with stdio
        // redirected to /dev/null holds no pipe and stays invisible to the
        // drain. Check the group after reaping the leader, riding out the
        // transient teardown statuses before deciding.
        if leader_exited.is_some() {
            match wait_group_empty(pgid, &mut child, Instant::now() + POST_EOF_GROUP_GRACE) {
                GroupStatus::Empty => {}
                GroupStatus::Present => {
                    escalated = true;
                    evidence.push(
                        "surviving group members after leader exit and pipe EOF \
                         (stdio may be redirected); escalating"
                            .to_string(),
                    );
                    if !escalate_group(pgid, &mut child, &mut evidence) {
                        cleanup_verified = false;
                    }
                }
                GroupStatus::Unknown => {
                    evidence.push(
                        "group membership unverifiable after leader exit (EPERM or \
                         other killpg error persisted)"
                            .to_string(),
                    );
                    cleanup_verified = false;
                }
            }
        }

        let mut output = Vec::new();
        let mut stderr_bytes = Vec::new();
        for pipe in pipes {
            match pipe.stream {
                Stream::Stdout => output.extend_from_slice(&pipe.bytes),
                Stream::Stderr => stderr_bytes.extend_from_slice(&pipe.bytes),
            }
        }
        output.extend_from_slice(&stderr_bytes);
        let post_exit_cleanup = escalated.then(|| evidence.join("; "));
        let run = match leader_exited {
            Some(status) if status.success() && !budget_expired => ProbeRun::Completed { output },
            Some(status) if budget_expired => {
                evidence.push(format!(
                    "leader was still running at the deadline; leader status after \
                     cleanup: {status}"
                ));
                ProbeRun::TimedOut {
                    evidence: evidence.join("; "),
                }
            }
            Some(status) => ProbeRun::FailedExit {
                stderr_tail: failure_tail(&stderr_bytes),
                exit_code: status.to_string(),
            },
            None => ProbeRun::TimedOut {
                evidence: evidence.join("; "),
            },
        };
        ProbeOutcome {
            run,
            cleanup_verified,
            post_exit_cleanup,
        }
    }
}

#[cfg(unix)]
use run::run_probe;

#[cfg(unix)]
enum ParseOutcome {
    Entries(Vec<CatalogEntry>),
    Empty,
    Malformed(String),
}

/// Parse the fixed-column `pi --list-models` table observed on Pi 0.85.1:
/// a header row starting with `provider`, then rows whose columns are
/// separated by runs of 2+ spaces (`provider model context max-out thinking
/// images`). The auth-empty case prints a `No models available` line. Rows
/// only count once the header has been seen; if nothing parses, the output
/// is malformed and reported with a bounded sample.
#[cfg(unix)]
fn parse_pi_list_models(output: &[u8]) -> ParseOutcome {
    let text = String::from_utf8_lossy(output);
    let mut entries = Vec::new();
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
#[cfg(unix)]
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

#[cfg(all(test, unix))]
mod tests {
    use super::{EnumerationStatus, HarnessId, ProbeIsolation, create_private_dir};

    #[test]
    fn isolation_failure_catalog_is_fail_closed() {
        let catalog = super::isolation_failed_catalog(
            HarnessId::Pi,
            std::path::Path::new("/fixture/pi"),
            "cannot create private dir /tmp/x: denied".to_string(),
        );
        assert_eq!(catalog.status, EnumerationStatus::IsolationFailed);
        assert!(catalog.entries.is_empty());
        assert!(catalog.note.as_deref().unwrap().contains("denied"));
    }

    #[test]
    fn entropy_failure_fails_closed_without_fallback() {
        // The failure path is exercised through create_at with an
        // unwritable parent: no probe root is created and nothing is
        // deleted. (The CSPRNG itself cannot be forced to fail portably.)
        let guard = tempfile::tempdir().expect("temp dir");
        let read_only = guard.path().join("read-only");
        std::fs::create_dir(&read_only).unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&read_only, std::fs::Permissions::from_mode(0o555)).unwrap();
        let result = ProbeIsolation::create_at(read_only.join("probe"));
        assert!(result.is_err(), "unwritable parent must fail closed");
        assert!(read_only.exists());
    }

    #[test]
    fn create_collision_never_deletes_a_pre_existing_root() {
        // A name collision (or any create_dir error) must fail without
        // deleting the pre-existing directory: ownership is tracked and
        // Drop only removes a root this call created.
        let guard = tempfile::tempdir().expect("temp dir");
        let foreign = guard.path().join("drogon-probe-collision");
        create_private_dir(&foreign).unwrap();
        std::fs::write(foreign.join("sentinel.txt"), "not ours").unwrap();
        let result = ProbeIsolation::create_at(foreign.clone());
        assert!(result.is_err(), "existing root must not be reused");
        assert!(
            foreign.join("sentinel.txt").exists(),
            "pre-existing root must survive untouched"
        );
        assert!(foreign.exists());
    }
}
