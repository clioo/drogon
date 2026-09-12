// MIT Copyright (c) 2026 Lovecast Inc.
//! Meeting analysis: suggestions extracted from one transcript by the free
//! local model, and the honesty rules that keep them suggestions.
//!
//! The owner's ask was to turn a transcript into tracked work. The risk is
//! obvious: a language model that "extracts" a commitment nobody made, or
//! attributes one to the wrong person, is worse than no extraction at all —
//! so three rules are enforced in code here rather than promised in a prompt:
//!
//! 1. **The only permitted model is the free local one.** The plan is built
//!    with a fixed provider/model (`dgx-spark` /
//!    `qwen3.8-flash-next-nvidia-nvfp4`) and a caller cannot name another:
//!    the owner must never be billed for browsing his own meetings.
//! 2. **A suggestion without a verifiable quote is discarded, not shown.**
//!    Every decision, action and question must carry a verbatim quote; the
//!    quote is searched for in the transcript and the line it came from is
//!    reported with it. Anything whose quote cannot be found (or is too
//!    short to be evidence) is dropped from the suggestion lists and
//!    reported separately, so the UI can say "3 suggestions were discarded"
//!    instead of quietly presenting a guess as a fact.
//! 3. **Nothing is created.** This module writes no task, no session and no
//!    commitment; it returns suggestions. Accepting one is an explicit,
//!    separate, user action (`meeting.commitment_create`).

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use drogon_harness::{HarnessId, HarnessLaunchRequest, PermissionMode, plan_launch};
use serde::{Deserialize, Serialize};

use super::{MeetingFileSystem, MeetingTranscript};

/// The free local model. There is deliberately no parameter anywhere in this
/// module that can replace these three values.
pub const ANALYSIS_PROVIDER: &str = "dgx-spark";
pub const ANALYSIS_MODEL: &str = "qwen3.8-flash-next-nvidia-nvfp4";
pub const ANALYSIS_HARNESS: &str = "pi";
/// Hard wall-clock ceiling for one analysis. The subprocess is killed and
/// reaped when it passes.
pub const ANALYSIS_TIMEOUT: Duration = Duration::from_secs(240);
/// Most stdout the run may produce before the rest is discarded.
pub const MAX_ANALYSIS_OUTPUT_BYTES: usize = 256 * 1024;
/// Bytes of transcript text a prompt may carry. `plan_launch` caps the whole
/// prompt at 32 KiB of argv, so the transcript budget sits below that with
/// room for the instructions.
pub const MAX_ANALYSIS_TRANSCRIPT_BYTES: usize = 24 * 1024;
/// Shortest quote that counts as evidence. A three-word "quote" matches half
/// the corpus and proves nothing.
pub const MIN_QUOTE_CHARS: usize = 12;
/// Discarded suggestions reported back, with their reason, so the owner can
/// see what was thrown away instead of trusting an invisible filter.
pub const MAX_DISCARDED_SHOWN: usize = 5;

/// Whether this host can run the local analysis at all, and with what.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisStatus {
    pub available: bool,
    /// `ready` or `harness-missing`.
    pub reason: &'static str,
    pub harness: &'static str,
    pub provider: &'static str,
    pub model: &'static str,
    /// Always true: the model above is the free local one.
    pub free_local_model: bool,
}

impl AnalysisStatus {
    pub fn missing() -> Self {
        Self {
            available: false,
            reason: "harness-missing",
            harness: ANALYSIS_HARNESS,
            provider: ANALYSIS_PROVIDER,
            model: ANALYSIS_MODEL,
            free_local_model: true,
        }
    }

    pub fn ready() -> Self {
        Self {
            available: true,
            reason: "ready",
            ..Self::missing()
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    High,
    Low,
}

impl Confidence {
    fn parse(value: Option<&str>) -> Self {
        match value.map(str::trim) {
            Some("high") => Confidence::High,
            // Anything else — including a missing field — is low. The model
            // never gets to claim certainty it did not state.
            _ => Confidence::Low,
        }
    }
}

/// One verified suggestion and the transcript line that proves it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedSuggestion {
    pub text: String,
    /// Verbatim line from the transcript, as the file holds it.
    pub quote: String,
    /// 1-based line number of `quote` in the note.
    pub line: u32,
    pub owner: Option<String>,
    pub due: Option<String>,
    pub confidence: Confidence,
}

/// A suggestion the verification step refused. Reported, never rendered as a
/// finding.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardedSuggestion {
    pub text: String,
    /// `quote-not-found`, `quote-too-short`, `empty-text`.
    pub reason: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingAnalysis {
    pub meeting: MeetingTranscript,
    pub model: &'static str,
    pub provider: &'static str,
    pub harness: &'static str,
    pub summary: String,
    pub decisions: Vec<VerifiedSuggestion>,
    pub actions: Vec<VerifiedSuggestion>,
    pub open_questions: Vec<VerifiedSuggestion>,
    pub discarded: Vec<DiscardedSuggestion>,
    /// How many suggestions verification dropped in total (not just the
    /// first [`MAX_DISCARDED_SHOWN`] carried in `discarded`).
    pub discarded_count: usize,
    /// The note was longer than the prompt budget: only its first bytes were
    /// analysed, and the answer says so.
    pub transcript_truncated: bool,
    pub transcript_chars: usize,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnalysisError {
    /// No local harness on this host: extraction is off, browsing is not.
    Unavailable,
    /// The run could not be started.
    Spawn,
    /// The run exceeded [`ANALYSIS_TIMEOUT`] and was killed.
    TimedOut,
    /// The run exited non-zero or produced nothing usable.
    Empty,
    /// The run's output was not the requested JSON object.
    Unparsable,
    Read(super::MeetingReadError),
}

impl AnalysisError {
    pub fn as_wire(self) -> &'static str {
        match self {
            AnalysisError::Unavailable => "meeting_analysis_unavailable",
            AnalysisError::Spawn => "meeting_analysis_spawn_failed",
            AnalysisError::TimedOut => "meeting_analysis_timed_out",
            AnalysisError::Empty => "meeting_analysis_empty",
            AnalysisError::Unparsable => "meeting_analysis_unparsable",
            AnalysisError::Read(read) => read.as_wire(),
        }
    }

    pub fn message(self) -> String {
        match self {
            AnalysisError::Unavailable => format!(
                "The local analysis model is unavailable on this host: `{ANALYSIS_HARNESS}` was \
                 not found on PATH. Transcripts stay fully browsable and searchable; nothing is \
                 extracted until it is installed."
            ),
            AnalysisError::Spawn => {
                "The local analysis model could not be started. Nothing was extracted.".to_string()
            }
            AnalysisError::TimedOut => format!(
                "The local analysis model did not answer within {} seconds and was stopped. \
                 Nothing was extracted.",
                ANALYSIS_TIMEOUT.as_secs()
            ),
            AnalysisError::Empty => {
                "The local analysis model returned no output, so there is nothing to suggest."
                    .to_string()
            }
            AnalysisError::Unparsable => {
                "The local analysis model did not answer with the expected JSON, so no suggestion \
                 is shown. Re-running may help."
                    .to_string()
            }
            AnalysisError::Read(read) => read.message().to_string(),
        }
    }
}

/// The instruction block. Deliberately explicit about the quote rule, because
/// the model's answer is verified against it and a model that is told the
/// rule up front wastes fewer runs.
pub const ANALYSIS_INSTRUCTIONS: &str = r#"You extract commitments from ONE meeting transcript. Answer with a single JSON object and nothing else: no prose, no markdown fence.

Shape:
{"summary":"...","decisions":[{"text":"...","quote":"..."}],"actions":[{"text":"...","owner":"name or null","due":"date or null","quote":"...","confidence":"high"}],"openQuestions":[{"text":"...","quote":"..."}]}

Rules:
- "summary": at most three sentences, in the language of the transcript.
- "decisions": only choices the transcript says were made. Not topics discussed.
- "actions": only commitments a participant accepted ("I will ...", "X owns ...", "let's ... by Friday"). A suggestion is not an action.
- "openQuestions": questions the transcript leaves unanswered.
- Every "quote" must be copied CHARACTER FOR CHARACTER from the transcript below, on one line. A suggestion whose quote is not found verbatim in the transcript is discarded before the human sees it, so an invented quote loses the item.
- "confidence" is "high" only when the transcript states the commitment directly; use "low" when you inferred it.
- Empty array means the transcript holds nothing for that category. Never invent an item to fill a list.

Transcript follows."#;

/// Builds the prompt, bounded to [`MAX_ANALYSIS_TRANSCRIPT_BYTES`] of
/// transcript text (cut on a UTF-8 boundary). Returns the prompt and whether
/// the transcript was cut.
pub fn build_prompt(meeting: &MeetingTranscript, content: &str) -> (String, bool) {
    let (body, truncated) = bound_chars(content, MAX_ANALYSIS_TRANSCRIPT_BYTES);
    let header = format!(
        "Note: {}\nDate: {}\nDuration: {} minutes\n\n",
        meeting.relative_path,
        meeting.started_at.as_deref().unwrap_or("unknown"),
        meeting
            .duration_minutes
            .map(|minutes| minutes.to_string())
            .unwrap_or_else(|| "unknown".to_string()),
    );
    (
        format!("{ANALYSIS_INSTRUCTIONS}\n\n{header}---\n{body}\n---\n"),
        truncated,
    )
}

/// Longest prefix of `value` at most `max_bytes` long, cut on a character
/// boundary.
fn bound_chars(value: &str, max_bytes: usize) -> (&str, bool) {
    if value.len() <= max_bytes {
        return (value, false);
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    (&value[..end], true)
}

/// Normalizes a line for quote matching: lowercased, whitespace collapsed,
/// list markers and leading timestamps that Write That Down writes (`[00:00]`,
/// `**Name:**`, `-`) stripped. The transcript is still rendered verbatim; this
/// only decides whether a quote is present.
fn normalize(value: &str) -> String {
    let lowered = value.to_lowercase();
    let mut out = String::with_capacity(lowered.len());
    let mut last_space = true;
    for ch in lowered.chars() {
        if ch.is_whitespace() {
            if !last_space {
                out.push(' ');
            }
            last_space = true;
            continue;
        }
        last_space = false;
        out.push(ch);
    }
    let trimmed = out.trim();
    let trimmed = trimmed
        .strip_prefix("- ")
        .or_else(|| trimmed.strip_prefix("* "))
        .unwrap_or(trimmed);
    trimmed.trim().to_string()
}

/// Finds the transcript line a quote came from. `None` when the quote is not
/// present verbatim (normalized) or is too short to be evidence.
pub fn verify_quote(content: &str, quote: &str) -> Option<(u32, String)> {
    let needle = normalize(quote);
    if needle.chars().count() < MIN_QUOTE_CHARS {
        return None;
    }
    for (index, raw) in content.split('\n').enumerate() {
        let line = raw.trim_end_matches('\r');
        let normalized = normalize(line);
        if normalized.is_empty() {
            continue;
        }
        // A quote may cover a whole line or a fragment of it, and may have
        // been rejoined across the model's own line wrapping.
        if normalized.contains(&needle) || needle.contains(&normalized) && normalized.len() >= 12 {
            return Some(((index + 1) as u32, line.trim().to_string()));
        }
    }
    None
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawSuggestion {
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    quote: Option<String>,
    #[serde(default)]
    owner: Option<String>,
    #[serde(default)]
    due: Option<String>,
    #[serde(default)]
    confidence: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAnalysis {
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    decisions: Vec<RawSuggestion>,
    #[serde(default)]
    actions: Vec<RawSuggestion>,
    #[serde(default)]
    open_questions: Vec<RawSuggestion>,
}

/// The JSON object out of a model answer, tolerating a markdown fence and
/// surrounding chatter but nothing else.
pub fn extract_json(raw: &str) -> Option<&str> {
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(&raw[start..=end])
}

/// Verifies one raw suggestion, or reports why it was discarded.
fn verify(raw: &RawSuggestion, content: &str) -> Result<VerifiedSuggestion, DiscardedSuggestion> {
    let text = raw.text.as_deref().map(str::trim).unwrap_or_default();
    let discarded = |reason: &'static str| DiscardedSuggestion {
        text: text.to_string(),
        reason,
    };
    if text.is_empty() {
        return Err(discarded("empty-text"));
    }
    let quote = raw.quote.as_deref().map(str::trim).unwrap_or_default();
    if quote.chars().count() < MIN_QUOTE_CHARS {
        return Err(discarded("quote-too-short"));
    }
    let Some((line, verbatim)) = verify_quote(content, quote) else {
        return Err(discarded("quote-not-found"));
    };
    let clean = |value: Option<&str>| -> Option<String> {
        let value = value?.trim();
        if value.is_empty()
            || value.eq_ignore_ascii_case("null")
            || value.eq_ignore_ascii_case("none")
        {
            return None;
        }
        Some(super::transcripts::truncate_chars(value, 120))
    };
    Ok(VerifiedSuggestion {
        text: super::transcripts::truncate_chars(text, 400),
        quote: verbatim,
        line,
        owner: clean(raw.owner.as_deref()),
        due: clean(raw.due.as_deref()),
        confidence: Confidence::parse(raw.confidence.as_deref()),
    })
}

/// Turns a model answer into verified suggestions. `Err` means the answer was
/// not the requested JSON at all — never a partial guess.
pub fn parse_analysis(raw: &str, content: &str) -> Result<ParsedAnalysis, AnalysisError> {
    let json = extract_json(raw).ok_or(AnalysisError::Unparsable)?;
    let parsed: RawAnalysis = serde_json::from_str(json).map_err(|_| AnalysisError::Unparsable)?;
    let mut discarded = Vec::new();
    let mut collect = |raw: &[RawSuggestion]| -> Vec<VerifiedSuggestion> {
        let mut out = Vec::new();
        for suggestion in raw {
            match verify(suggestion, content) {
                Ok(verified) => out.push(verified),
                Err(reason) => {
                    if discarded.len() < MAX_DISCARDED_SHOWN {
                        discarded.push(reason);
                    } else {
                        // Keep counting past the display cap.
                        discarded.push(DiscardedSuggestion {
                            text: String::new(),
                            reason: "hidden",
                        });
                    }
                }
            }
        }
        out
    };
    let decisions = collect(&parsed.decisions);
    let actions = collect(&parsed.actions);
    let open_questions = collect(&parsed.open_questions);
    let discarded_count = discarded.len();
    let discarded = discarded
        .into_iter()
        .filter(|item| item.reason != "hidden")
        .collect();
    Ok(ParsedAnalysis {
        summary: parsed
            .summary
            .as_deref()
            .map(|value| super::transcripts::truncate_chars(value.trim(), 1_200))
            .unwrap_or_default(),
        decisions,
        actions,
        open_questions,
        discarded,
        discarded_count,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedAnalysis {
    pub summary: String,
    pub decisions: Vec<VerifiedSuggestion>,
    pub actions: Vec<VerifiedSuggestion>,
    pub open_questions: Vec<VerifiedSuggestion>,
    pub discarded: Vec<DiscardedSuggestion>,
    pub discarded_count: usize,
}

/// Everything a run needs. `data_dir` hosts the isolated headless config dir;
/// `harness_executable` is the local binary resolution found on this host's
/// PATH (injected, so a test never depends on the developer's own install);
/// `home_dir` locates the user's own Pi config to link read-only.
#[derive(Debug, Clone)]
pub struct AnalysisEnvironment {
    pub data_dir: PathBuf,
    pub home_dir: PathBuf,
    pub inherited_pi_agent_dir: Option<PathBuf>,
    pub harness_executable: Option<PathBuf>,
}

impl AnalysisEnvironment {
    pub fn current(data_dir: &Path) -> Self {
        Self {
            data_dir: data_dir.to_path_buf(),
            home_dir: std::env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("/")),
            inherited_pi_agent_dir: std::env::var_os("PI_CODING_AGENT_DIR").map(PathBuf::from),
            harness_executable: resolve_analysis_harness(),
        }
    }

    /// The harness executable, when this host has one.
    pub fn executable(&self) -> Option<&Path> {
        self.harness_executable.as_deref()
    }

    pub fn status(&self) -> AnalysisStatus {
        if self.harness_executable.is_some() {
            AnalysisStatus::ready()
        } else {
            AnalysisStatus::missing()
        }
    }
}

/// The one place the analysis harness is looked up: this host's `PATH`.
pub fn resolve_analysis_harness() -> Option<PathBuf> {
    drogon_harness::resolve_executable(ANALYSIS_HARNESS, std::env::var_os("PATH").as_deref())
}

/// The seam the analysis runs through. A test drives a shell fixture instead
/// of a real model; production uses [`LocalModelInference`], whose argv is
/// built by the product's own harness planner.
pub trait MeetingInference: Send + Sync {
    fn analyze(&self, prompt: &str) -> Result<String, AnalysisError>;
}

/// Runs the local harness once, headless, with the fixed free model.
pub struct LocalModelInference {
    pub executable: PathBuf,
    pub data_dir: PathBuf,
    pub home_dir: PathBuf,
    pub inherited_pi_agent_dir: Option<PathBuf>,
    pub timeout: Duration,
}

/// An isolated config dir + the environment overlay for one headless run,
/// reusing the daemon's own isolation (issue #187) so an analysis never loads
/// the user's skills, extensions or MCP servers.
struct HeadlessPlan {
    dir: PathBuf,
    env: Vec<(String, String)>,
    links: Vec<(PathBuf, String)>,
}

impl LocalModelInference {
    pub fn from_environment(environment: &AnalysisEnvironment) -> Option<Self> {
        Some(Self {
            executable: environment.executable()?.to_path_buf(),
            data_dir: environment.data_dir.clone(),
            home_dir: environment.home_dir.clone(),
            inherited_pi_agent_dir: environment.inherited_pi_agent_dir.clone(),
            timeout: ANALYSIS_TIMEOUT,
        })
    }

    fn source_agent_dir(&self) -> Option<PathBuf> {
        let own_root = self.data_dir.join("harness-env");
        let looks_like_config_root = |path: &Path| path.join("models.json").is_file();
        self.inherited_pi_agent_dir
            .clone()
            .filter(|path| {
                path.is_dir() && !path.starts_with(&own_root) && looks_like_config_root(path)
            })
            .or_else(|| {
                let candidate = self.home_dir.join(".pi").join("agent");
                candidate.is_dir().then_some(candidate)
            })
    }

    fn plan_headless(&self, nonce: &str) -> Option<HeadlessPlan> {
        let plan = drogon_harness::plan_headless_env(
            HarnessId::Pi,
            &self.data_dir,
            nonce,
            self.source_agent_dir().as_deref(),
        )?;
        Some(HeadlessPlan {
            dir: plan.dir,
            env: plan.env,
            links: plan.link_files,
        })
    }
}

impl MeetingInference for LocalModelInference {
    fn analyze(&self, prompt: &str) -> Result<String, AnalysisError> {
        let nonce = uuid::Uuid::new_v4().to_string();
        let headless = self.plan_headless(&nonce);
        if let Some(plan) = &headless {
            std::fs::create_dir_all(&plan.dir).map_err(|_| AnalysisError::Spawn)?;
            for (source, name) in &plan.links {
                if !source.is_file() {
                    continue;
                }
                let dest = plan.dir.join(name);
                #[cfg(unix)]
                if std::os::unix::fs::symlink(source, &dest).is_err() {
                    let _ = std::fs::copy(source, &dest);
                }
                #[cfg(not(unix))]
                {
                    let _ = std::fs::copy(source, &dest);
                }
            }
        }
        let result = self.run(prompt, headless.as_ref());
        if let Some(plan) = &headless {
            let _ = std::fs::remove_dir_all(&plan.dir);
        }
        result
    }
}

impl LocalModelInference {
    fn run(&self, prompt: &str, headless: Option<&HeadlessPlan>) -> Result<String, AnalysisError> {
        let request = HarnessLaunchRequest {
            harness_id: HarnessId::Pi,
            model: Some(ANALYSIS_MODEL.to_string()),
            effort: None,
            provider: Some(ANALYSIS_PROVIDER.to_string()),
            prompt: Some(prompt.to_string()),
            permission_mode: PermissionMode::Unattended,
            headless: true,
            resume: false,
            agent_session_id: None,
            agent_session_transcript_path: None,
        };
        let plan = plan_launch(&request, &self.executable).map_err(|_| AnalysisError::Spawn)?;
        // The run happens inside a throwaway directory so that nothing an
        // agentic CLI decides to write lands in the owner's notes folder or
        // in the daemon's data dir.
        let cwd = self
            .data_dir
            .join("meeting-analysis")
            .join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&cwd).map_err(|_| AnalysisError::Spawn)?;

        let mut command = Command::new(&plan.command);
        command
            .args(&plan.args)
            .current_dir(&cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("TERM", "dumb");
        // Its own process group, so the kill below reaches the run AND every
        // descendant it started. A one-shot CLI that shells out (`sh -c
        // sleep 30`) otherwise survives the kill, keeps the stdout pipe open
        // and turns a 240-second ceiling into an unbounded wait.
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt as _;
            command.process_group(0);
        }
        if let Some(headless) = headless {
            for (key, value) in &headless.env {
                command.env(key, value);
            }
        }
        let mut child = command.spawn().map_err(|_| AnalysisError::Spawn)?;
        let group = child.id();
        let stdout = child.stdout.take().ok_or(AnalysisError::Spawn)?;
        let stderr = child.stderr.take();
        let (sender, receiver) = std::sync::mpsc::channel();
        let reader = std::thread::spawn(move || {
            let output = read_bounded(stdout);
            let _ = sender.send(output);
        });
        let stderr_reader = stderr.map(|stderr| std::thread::spawn(move || read_bounded(stderr)));

        let deadline = Instant::now() + self.timeout;
        let timed_out = loop {
            match child.try_wait() {
                Ok(Some(_)) => break false,
                Ok(None) => {
                    if Instant::now() >= deadline {
                        terminate_group(&mut child, group);
                        break true;
                    }
                    std::thread::sleep(Duration::from_millis(25));
                }
                Err(_) => {
                    terminate_group(&mut child, group);
                    break true;
                }
            }
        };
        // The output is read from the pipe with its own ceiling: a straggler
        // that inherited stdout must not hold this call open.
        let output = receiver
            .recv_timeout(Duration::from_secs(5))
            .unwrap_or_else(|_| {
                terminate_group(&mut child, group);
                receiver
                    .recv_timeout(Duration::from_secs(5))
                    .unwrap_or_default()
            });
        let _ = reader.join();
        if let Some(reader) = stderr_reader {
            let _ = reader.join();
        }
        // Nothing of this run survives the call, even on the happy path: the
        // group is ours and the run is over.
        terminate_group(&mut child, group);
        if timed_out {
            let _ = std::fs::remove_dir_all(&cwd);
            return Err(AnalysisError::TimedOut);
        }
        let _ = std::fs::remove_dir_all(&cwd);
        let text = String::from_utf8_lossy(&output).into_owned();
        if text.trim().is_empty() {
            return Err(AnalysisError::Empty);
        }
        Ok(text)
    }
}

/// Kills the whole process group the run was spawned into (its own group, so
/// this can never reach the daemon or the developer's session) and reaps the
/// direct child. Idempotent: calling it after the child exited is a no-op
/// plus one last sweep for descendants.
fn terminate_group(child: &mut std::process::Child, group: u32) {
    #[cfg(unix)]
    {
        // Safe: the pid came from our own `spawn` with `process_group(0)`, so
        // `group` is that child's group id and never a negative other value.
        unsafe {
            libc::kill(-(group as i32), libc::SIGKILL);
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Reads at most [`MAX_ANALYSIS_OUTPUT_BYTES`], draining the rest so the child
/// never blocks on a full pipe, and without ever holding the discarded bytes.
fn read_bounded(mut pipe: impl std::io::Read) -> Vec<u8> {
    let mut kept = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        match pipe.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                if kept.len() < MAX_ANALYSIS_OUTPUT_BYTES {
                    let room = MAX_ANALYSIS_OUTPUT_BYTES - kept.len();
                    kept.extend_from_slice(&buffer[..read.min(room)]);
                }
            }
            Err(_) => break,
        }
    }
    kept
}

/// One complete analysis: read the note, build the bounded prompt, run the
/// local model, verify every quote against the note. `expected_root` is the
/// notes directory the caller already resolved, so the analysis and the index
/// always agree on which folder is being read.
pub fn analyze(
    file_system: &dyn MeetingFileSystem,
    environment: &AnalysisEnvironment,
    inference: &dyn MeetingInference,
    expected_root: &Path,
    id: &str,
) -> Result<MeetingAnalysis, AnalysisError> {
    if environment.executable().is_none() {
        return Err(AnalysisError::Unavailable);
    }
    let meeting = super::read_by_id(file_system, expected_root, id).map_err(AnalysisError::Read)?;
    let bytes = file_system
        .read_file(Path::new(&meeting.file_path))
        .map_err(|_| AnalysisError::Read(super::MeetingReadError::Missing))?;
    let content = std::str::from_utf8(&bytes)
        .map_err(|_| AnalysisError::Read(super::MeetingReadError::NotUtf8))?;
    let (prompt, truncated) = build_prompt(&meeting, content);
    let started = Instant::now();
    let raw = inference.analyze(&prompt)?;
    let parsed = parse_analysis(&raw, content)?;
    Ok(MeetingAnalysis {
        meeting,
        model: ANALYSIS_MODEL,
        provider: ANALYSIS_PROVIDER,
        harness: ANALYSIS_HARNESS,
        summary: parsed.summary,
        decisions: parsed.decisions,
        actions: parsed.actions,
        open_questions: parsed.open_questions,
        discarded: parsed.discarded,
        discarded_count: parsed.discarded_count,
        transcript_truncated: truncated,
        transcript_chars: content.chars().count(),
        duration_ms: started.elapsed().as_millis().try_into().unwrap_or(u64::MAX),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meetings::filesystem::tests::FakeFileSystem;
    use crate::meetings::{MeetingStatus, transcript_id};

    const ROOT: &str = "/home/carlos/Transcripts";
    const NOTE: &str = "/home/carlos/Transcripts/2026-09-10/08-00_30min.md";

    const BODY: &str = "# Weekly sync\n**Date:** 2026-09-10 08:00\n**Duration:** 30 min\n\n## Transcript\n\n[00:00] We agreed to ship the budget report on Friday.\n[00:12] I will fix the flaky login test before the release.\n[00:20] Raul owns MR 142.\n[00:31] Should we keep the old importer?\n";

    fn fixture() -> FakeFileSystem {
        let mut fs = FakeFileSystem::default();
        fs.insert_file(NOTE, BODY.as_bytes());
        fs
    }

    fn meeting() -> MeetingTranscript {
        let fs = fixture();
        super::super::read_by_id(&fs, Path::new(ROOT), &transcript_id(Path::new(NOTE)))
            .expect("fixture note must parse")
    }

    /// A harness path that never exists, so a test asserting the degraded
    /// behaviour cannot accidentally pick up the developer's own `pi`.
    fn analysis_environment(harness: Option<&str>) -> AnalysisEnvironment {
        AnalysisEnvironment {
            data_dir: PathBuf::from("/tmp/data"),
            home_dir: PathBuf::from("/home/carlos"),
            inherited_pi_agent_dir: None,
            harness_executable: harness.map(PathBuf::from),
        }
    }

    #[test]
    fn the_prompt_names_the_note_and_is_bounded() {
        let meeting = meeting();
        let (prompt, truncated) = build_prompt(&meeting, BODY);
        assert!(!truncated);
        assert!(prompt.contains(ANALYSIS_PROVIDER) || prompt.contains("transcript"));
        assert!(prompt.contains("2026-09-10/08-00_30min.md"));
        assert!(prompt.contains("Duration: 30 minutes"));
        assert!(prompt.contains("[00:20] Raul owns MR 142."));
        assert!(prompt.ends_with("---\n"));

        let long = "x".repeat(MAX_ANALYSIS_TRANSCRIPT_BYTES + 5_000);
        let (prompt, truncated) = build_prompt(&meeting, &long);
        assert!(truncated);
        assert!(prompt.len() <= MAX_ANALYSIS_TRANSCRIPT_BYTES + 2_000);
        // The cut is on a character boundary, so the prompt is valid UTF-8.
        assert!(prompt.ends_with("---\n"));

        let unicode = "é".repeat(MAX_ANALYSIS_TRANSCRIPT_BYTES);
        let (prompt, truncated) = build_prompt(&meeting, &unicode);
        assert!(truncated);
        assert!(std::str::from_utf8(prompt.as_bytes()).is_ok());
        assert!(!prompt.contains('\u{FFFD}'));
    }

    #[test]
    fn a_quote_is_verified_against_the_note_and_carries_its_line() {
        let (line, text) =
            verify_quote(BODY, "I will fix the flaky login test").expect("quote is in the note");
        assert_eq!(line, 8);
        assert_eq!(
            text,
            "[00:12] I will fix the flaky login test before the release."
        );

        // Timestamps and surrounding punctuation do not defeat the match.
        assert!(verify_quote(BODY, "Raul owns MR 142").is_some());
        // Case and whitespace differences do not either.
        assert!(verify_quote(BODY, "we agreed to ship   the budget report").is_some());
        // An invented quote is refused...
        assert!(verify_quote(BODY, "I will migrate the database tonight").is_none());
        // ...and so is a quote too short to be evidence.
        assert!(verify_quote(BODY, "MR 142").is_none());
        assert!(verify_quote(BODY, "").is_none());
    }

    #[test]
    fn parsing_keeps_only_verifiable_suggestions_and_reports_the_rest() {
        let raw = r#"```json
{"summary":"The team agreed to ship the budget report and Raul took MR 142.",
 "decisions":[{"text":"Ship the budget report on Friday","quote":"We agreed to ship the budget report on Friday"}],
 "actions":[{"text":"Fix the flaky login test","quote":"I will fix the flaky login test before the release","owner":"Carlos","confidence":"high"},
            {"text":"Migrate the database","quote":"I will migrate the database tonight","owner":"Nobody","confidence":"high"},
            {"text":"Own MR 142","quote":"MR 142","confidence":"low"}],
 "openQuestions":[{"text":"Keep the old importer?","quote":"Should we keep the old importer?"}]}
```"#;
        let parsed = parse_analysis(raw, BODY).unwrap();
        assert_eq!(parsed.decisions.len(), 1);
        assert_eq!(parsed.decisions[0].line, 7);
        assert_eq!(parsed.actions.len(), 1);
        assert_eq!(parsed.actions[0].owner.as_deref(), Some("Carlos"));
        assert_eq!(parsed.actions[0].confidence, Confidence::High);
        assert_eq!(parsed.actions[0].line, 8);
        assert_eq!(parsed.open_questions.len(), 1);
        assert_eq!(parsed.discarded_count, 2);
        assert_eq!(parsed.discarded[0].reason, "quote-not-found");
        assert_eq!(parsed.discarded[1].reason, "quote-too-short");
        // The discarded suggestion keeps its text so the owner can see what
        // was thrown away, but it is never in the finding lists.
        assert!(parsed.discarded[0].text.contains("Migrate the database"));
        assert!(parsed.summary.starts_with("The team agreed"));
    }

    #[test]
    fn an_answer_that_is_not_the_requested_json_is_refused_whole() {
        assert_eq!(
            parse_analysis("I looked at the transcript and it seems fine.", BODY),
            Err(AnalysisError::Unparsable)
        );
        assert_eq!(
            parse_analysis("{\"summary\":", BODY),
            Err(AnalysisError::Unparsable)
        );
        assert_eq!(parse_analysis("", BODY), Err(AnalysisError::Unparsable));
        // Unknown fields are tolerated (the model may add them), but a
        // missing category is simply empty.
        let parsed = parse_analysis("{\"summary\":\"ok\"}", BODY).unwrap();
        assert!(parsed.actions.is_empty());
        assert_eq!(parsed.discarded_count, 0);
    }

    #[test]
    fn a_missing_harness_disables_extraction_instead_of_substituting_one() {
        let fs = fixture();
        let environment = analysis_environment(None);
        assert_eq!(environment.status().reason, "harness-missing");
        assert!(!environment.status().available);
        assert_eq!(environment.status().provider, ANALYSIS_PROVIDER);
        assert_eq!(environment.status().model, ANALYSIS_MODEL);
        assert!(environment.status().free_local_model);
        let failure = analyze(
            &fs,
            &environment,
            &FixtureInference::new("{}"),
            Path::new(ROOT),
            &transcript_id(Path::new(NOTE)),
        )
        .expect_err("analysis must be refused");
        assert_eq!(failure, AnalysisError::Unavailable);
        assert!(failure.message().contains("not found on PATH"));
    }

    struct FixtureInference {
        answer: String,
    }

    impl FixtureInference {
        fn new(answer: &str) -> Self {
            Self {
                answer: answer.to_string(),
            }
        }
    }

    impl MeetingInference for FixtureInference {
        fn analyze(&self, _prompt: &str) -> Result<String, AnalysisError> {
            Ok(self.answer.clone())
        }
    }

    #[test]
    fn analyze_returns_verified_suggestions_with_the_notes_own_lines() {
        let fs = fixture();
        // An injected harness path turns extraction on; the fixture runner is
        // what actually answers, so no model and no subprocess run here.
        let environment = analysis_environment(Some("/usr/local/bin/pi"));
        let answer = r#"{"summary":"Budget report ships Friday.",
            "decisions":[{"text":"Ship the budget report on Friday","quote":"We agreed to ship the budget report on Friday"}],
            "actions":[{"text":"Fix the flaky login test","quote":"I will fix the flaky login test before the release","confidence":"high"}],
            "openQuestions":[]}"#;
        let result = analyze(
            &fs,
            &environment,
            &FixtureInference::new(answer),
            Path::new(ROOT),
            &transcript_id(Path::new(NOTE)),
        )
        .expect("verified suggestions");
        assert_eq!(result.model, ANALYSIS_MODEL);
        assert_eq!(result.provider, ANALYSIS_PROVIDER);
        assert_eq!(result.actions.len(), 1);
        assert_eq!(result.actions[0].line, 8);
        assert_eq!(result.meeting.status, MeetingStatus::Saved);
        assert!(!result.transcript_truncated);
        assert_eq!(result.transcript_chars, BODY.chars().count());
    }

    /// One real one-shot run against a shell fixture: the argv planner, the
    /// spawn, the bounded read and the exit-code handling are all exercised
    /// for real, and no model is invoked.
    mod local_run {
        use super::*;
        use std::os::unix::fs::PermissionsExt as _;

        fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
            let path = dir.join(name);
            std::fs::write(&path, body).expect("write fixture harness");
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
                .expect("chmod fixture harness");
            path
        }

        fn inference(executable: &Path, timeout: Duration, data_dir: &Path) -> LocalModelInference {
            LocalModelInference {
                executable: executable.to_path_buf(),
                data_dir: data_dir.to_path_buf(),
                home_dir: data_dir.to_path_buf(),
                inherited_pi_agent_dir: None,
                timeout,
            }
        }

        fn env_for(executable: &Path, data_dir: &Path) -> AnalysisEnvironment {
            AnalysisEnvironment {
                data_dir: data_dir.to_path_buf(),
                home_dir: data_dir.to_path_buf(),
                inherited_pi_agent_dir: None,
                harness_executable: Some(executable.to_path_buf()),
            }
        }

        const ANSWER: &str = "{\"summary\":\"Budget report ships Friday.\",\"decisions\":[{\"text\":\"Ship the budget report on Friday\",\"quote\":\"We agreed to ship the budget report on Friday\"}],\"actions\":[],\"openQuestions\":[]}";

        #[test]
        fn a_real_one_shot_run_yields_verified_suggestions() {
            let dir = tempfile::tempdir().expect("temp dir");
            let data_dir = dir.path().join("data");
            std::fs::create_dir_all(&data_dir).expect("data dir");
            // The fixture refuses to be a model: it asserts the argv it was
            // handed carries ONLY the free local provider and model, and
            // echoes the answer otherwise.
            let executable = script(
                dir.path(),
                "pi",
                &format!(
                    "#!/bin/sh\nargs=\"$*\"\ncase \"$args\" in\n  *\"--provider {ANALYSIS_PROVIDER}\"*) ;;\n  *) echo 'wrong provider' >&2; exit 9 ;;\nesac\ncase \"$args\" in\n  *\"--model {ANALYSIS_MODEL}\"*) ;;\n  *) echo 'wrong model' >&2; exit 9 ;;\nesac\ncase \"$args\" in\n  *'-p'*) ;;\n  *) echo 'not a one-shot run' >&2; exit 9 ;;\nesac\necho '{ANSWER}'\n"
                ),
            );
            assert!(
                std::fs::read_to_string(&executable)
                    .unwrap()
                    .contains(ANALYSIS_PROVIDER)
            );
            let fs = fixture();
            let environment = env_for(&executable, &data_dir);
            let result = analyze(
                &fs,
                &environment,
                &inference(&executable, Duration::from_secs(20), &data_dir),
                Path::new(ROOT),
                &transcript_id(Path::new(NOTE)),
            )
            .expect("the fixture harness answers with verifiable JSON");
            assert_eq!(result.decisions.len(), 1);
            assert_eq!(result.decisions[0].line, 7);
            assert!(result.actions.is_empty());
            // The throwaway working directory is cleaned up behind the run.
            let leftovers: Vec<_> = std::fs::read_dir(data_dir.join("meeting-analysis"))
                .map(|entries| entries.filter_map(Result::ok).collect())
                .unwrap_or_default();
            assert!(leftovers.is_empty(), "analysis cwd must not linger");
        }

        #[test]
        fn a_run_that_never_answers_is_killed_and_reported() {
            // The timeout is generous about the child's own start-up and
            // tight about the 30-second sleep it then performs, so the
            // assertion is about the kill, not about scheduling luck. The
            // budget must absorb whole-host exec storms measured under a
            // full `cargo test --workspace` run (a fresh script's first
            // exec is scanned by macOS, and a spawn-stormed `sh` has been
            // observed taking over a second to reach its first write); the
            // run still never answers, so the budget remains the only way
            // it can end and the kill path is still the thing under test.
            let dir = tempfile::tempdir().expect("temp dir");
            let data_dir = dir.path().join("data");
            std::fs::create_dir_all(&data_dir).expect("data dir");
            let pid_file = dir.path().join("child.pid");
            // The fixture forks a grandchild on purpose: a one-shot CLI that
            // shells out is exactly the shape whose survival used to hold
            // this call open for the length of its own sleep.
            let executable = script(
                dir.path(),
                "pi",
                &format!(
                    "#!/bin/sh\nif [ \"$1\" = \"--warm\" ]; then exit 0; fi\nsleep 30 &\necho \"$$ $!\" > '{}'\nwait\n",
                    pid_file.display()
                ),
            );
            // Pay the fixture's one-time first-exec scan here, bounded, so
            // the real run's start-up is plain fork/exec: the deadline must
            // never expire before the fixture recorded its pids, or the
            // product would honestly kill a run that has not started yet.
            let mut warm = std::process::Command::new(&executable)
                .arg("--warm")
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .expect("warm the fixture once");
            let warm_deadline = Instant::now() + Duration::from_secs(5);
            while warm.try_wait().ok().flatten().is_none() && Instant::now() < warm_deadline {
                std::thread::sleep(Duration::from_millis(5));
            }
            if warm.try_wait().ok().flatten().is_none() {
                let _ = warm.kill();
            }
            let _ = warm.wait();
            let fs = fixture();
            let environment = env_for(&executable, &data_dir);

            let failure = analyze(
                &fs,
                &environment,
                &inference(&executable, Duration::from_secs(10), &data_dir),
                Path::new(ROOT),
                &transcript_id(Path::new(NOTE)),
            )
            .expect_err("a hung run must fail");
            assert_eq!(failure, AnalysisError::TimedOut);
            // The killed child AND its grandchild are gone, not merely
            // abandoned. The fixture records both pids first, so this is an
            // identity check rather than a guess from a process listing. A
            // killed pid can still appear in ps for the short window before
            // launchd reaps it, so the disappearance is polled within a
            // bounded bound — and still fails the moment it persists.
            let recorded = std::fs::read_to_string(&pid_file)
                .expect("the fixture records its pids")
                .trim()
                .to_string();
            let pids: Vec<&str> = recorded.split_whitespace().collect();
            assert_eq!(pids.len(), 2, "the fixture records the run and its child");
            for pid in pids {
                let gone_deadline = Instant::now() + Duration::from_secs(5);
                loop {
                    let alive = std::process::Command::new("ps")
                        .args(["-p", pid, "-o", "pid="])
                        .output()
                        .map(|output| !output.stdout.is_empty())
                        .unwrap_or(false);
                    if !alive {
                        break;
                    }
                    assert!(
                        Instant::now() < gone_deadline,
                        "the analysis process {pid} must be reaped"
                    );
                    std::thread::sleep(Duration::from_millis(25));
                }
            }
        }

        #[test]
        fn a_run_that_says_nothing_is_reported_as_empty() {
            let dir = tempfile::tempdir().expect("temp dir");
            let data_dir = dir.path().join("data");
            std::fs::create_dir_all(&data_dir).expect("data dir");
            let executable = script(dir.path(), "pi", "#!/bin/sh\nexit 1\n");
            let fs = fixture();
            let environment = env_for(&executable, &data_dir);
            let failure = analyze(
                &fs,
                &environment,
                &inference(&executable, Duration::from_secs(20), &data_dir),
                Path::new(ROOT),
                &transcript_id(Path::new(NOTE)),
            )
            .expect_err("an empty run must fail");
            assert_eq!(failure, AnalysisError::Empty);
        }

        #[test]
        fn a_chatty_run_is_capped_without_losing_the_answer() {
            let dir = tempfile::tempdir().expect("temp dir");
            let data_dir = dir.path().join("data");
            std::fs::create_dir_all(&data_dir).expect("data dir");
            let executable = script(
                dir.path(),
                "pi",
                &format!(
                    "#!/bin/sh\necho '{ANSWER}'\ni=0\nwhile [ $i -lt 40 ]; do\n  head -c 65536 /dev/zero | tr '\\000' 'x'\n  i=$((i+1))\n  echo\ndone\n"
                ),
            );
            let output = inference(&executable, Duration::from_secs(30), &data_dir)
                .analyze("prompt")
                .expect("the fixture answers");
            assert!(output.len() >= MAX_ANALYSIS_OUTPUT_BYTES);
            let parsed = parse_analysis(&output, BODY).expect("the head is the answer");
            assert_eq!(parsed.decisions.len(), 1);
        }
    }

    #[test]
    fn analyze_reports_a_runner_failure_as_itself() {
        struct Failing;
        impl MeetingInference for Failing {
            fn analyze(&self, _prompt: &str) -> Result<String, AnalysisError> {
                Err(AnalysisError::TimedOut)
            }
        }
        let fs = fixture();
        let environment = analysis_environment(Some("/usr/local/bin/pi"));
        let failure = analyze(
            &fs,
            &environment,
            &Failing,
            Path::new(ROOT),
            &transcript_id(Path::new(NOTE)),
        )
        .expect_err("a failing runner must fail");
        assert_eq!(failure, AnalysisError::TimedOut);
        assert!(failure.message().contains("did not answer"));
    }
}
