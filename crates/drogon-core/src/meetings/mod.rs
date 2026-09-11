//! Meetings: the owner's own meeting notes, read straight off disk.
//!
//! Write That Down (`clioo/write-that-down-patrick`) is a local-first macOS
//! meeting copilot that saves each finished conversation as plain Markdown.
//! There is no API, no OAuth and no credential anywhere in this path: the
//! notes are files, so Drogon indexes files.
//!
//! Three rules shape the whole module:
//!
//! 1. **Read-only.** `MeetingFileSystem` has no mutating method, so nothing
//!    here can edit, move or delete the owner's notes. `meeting.read` also
//!    refuses any id that resolves outside the resolved notes directory.
//! 2. **Honest states.** "The tool is not installed", "the folder does not
//!    exist", "the folder is empty" and "this file failed to parse" are four
//!    different answers, and each one is reported as itself.
//! 3. **Bounded.** The walk is capped per call and paged, so an enormous
//!    notes directory is never loaded into memory.

pub mod analysis;
pub mod commitments;
pub mod configuration;
pub mod filesystem;
pub mod query;
pub mod search;
pub mod transcripts;

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::Serialize;

pub use analysis::{
    ANALYSIS_HARNESS, ANALYSIS_MODEL, ANALYSIS_PROVIDER, ANALYSIS_TIMEOUT, AnalysisEnvironment,
    AnalysisError, AnalysisStatus, Confidence, DiscardedSuggestion, LocalModelInference,
    MAX_ANALYSIS_OUTPUT_BYTES, MAX_ANALYSIS_TRANSCRIPT_BYTES, MeetingAnalysis, MeetingInference,
    VerifiedSuggestion, analyze, build_prompt, resolve_analysis_harness, verify_quote,
};
pub use commitments::{
    COMMITMENTS_FILE, COMMITMENTS_VERSION, Commitment, CommitmentError, CommitmentFilter,
    CommitmentPage, CommitmentSource, CommitmentStatus, CommitmentStore, DEFAULT_COMMITMENT_PAGE,
    MAX_COMMITMENT_PAGE, MAX_COMMITMENT_TEXT_CHARS, MAX_COMMITMENTS, note_for_commitment,
};
pub use configuration::{
    CONFIG_RELATIVE_PATH, ConfigurationState, DEFAULT_OUTPUT_DIR, ResolvedConfiguration,
    TranscriptRootSource, config_path, expand_tilde, resolve,
};
pub use filesystem::{
    DirectoryState, EntryKind, FileMetadata, MeetingFileSystem, RealMeetingFileSystem,
    inspect_directory, path_is_inside,
};
pub use query::{
    MAX_DURATION_FILTER_MINUTES, MAX_MATCH_LINES, MAX_QUERY_CHARS, MeetingFilterError,
    MeetingFilters, MeetingMatchLine, match_lines,
};
pub use search::{MAX_SEARCH_BYTES, SearchOutcome};
pub use transcripts::{
    DEFAULT_PAGE_SIZE, Discovery, HEADER_WINDOW_BYTES, MAX_DATE_FOLDERS_SCANNED, MAX_EXCERPT_CHARS,
    MAX_PAGE_SIZE, MAX_TRANSCRIPT_BYTES, MAX_TRANSCRIPTS_SCANNED, MeetingReadError, MeetingStatus,
    MeetingTranscript, ParsedTranscript, ScanEntry, TranscriptFailureReason, TranscriptFilename,
    Walk, discover, is_date_folder_name, parse_transcript_filename, parse_transcript_markdown,
    read_by_id, row_for, transcript_excerpt, transcript_id, truncate_chars, walk,
};

/// Service capability advertised by `status`. The desktop surface and the
/// CLI both gate on it, so a client that meets an older service says so
/// instead of showing an empty list.
pub const MEETINGS_CAPABILITY: &str = "meetings.v1";

/// Service capability for the working half of Meetings: extraction through
/// the free local model and the commitment ledger. Separate from
/// [`MEETINGS_CAPABILITY`] so an index-only service is still usable — a
/// client lists and searches, and simply does not offer the actions.
pub const MEETINGS_ACTIONS_CAPABILITY: &str = "meetings.actions.v1";

/// Executable inside the Write That Down app bundle.
const APP_EXECUTABLE: &str = "Contents/MacOS/WriteThatDown";

/// Everything about the host that resolution depends on, injected so tests
/// never read the developer's real home directory.
#[derive(Debug, Clone)]
pub struct MeetingEnvironment {
    /// `std::env::consts::OS` of the service host (`macos`, `linux`, ...).
    pub platform: String,
    pub home_dir: PathBuf,
    pub variables: BTreeMap<String, String>,
    pub app_candidates: Vec<PathBuf>,
    /// The local analysis harness (`pi`) when this host has one, resolved
    /// once from PATH. `None` is the honest "extraction is off" answer: the
    /// transcripts still list, search and read.
    pub analysis_harness: Option<PathBuf>,
}

impl MeetingEnvironment {
    pub fn current() -> Self {
        let home_dir = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/"));
        let variables = std::env::vars()
            .filter(|(key, _)| key.starts_with("WTD_"))
            .collect();
        Self {
            platform: std::env::consts::OS.to_string(),
            app_candidates: default_app_candidates(&home_dir),
            home_dir,
            variables,
            analysis_harness: analysis::resolve_analysis_harness(),
        }
    }

    pub fn var(&self, key: &str) -> Option<&str> {
        self.variables.get(key).map(String::as_str)
    }

    pub fn supported(&self) -> bool {
        self.platform == "macos"
    }
}

/// `/Applications/WriteThatDown.app` and `~/Applications/WriteThatDown.app`,
/// the two locations `install.sh` writes to.
pub fn default_app_candidates(home_dir: &std::path::Path) -> Vec<PathBuf> {
    vec![
        PathBuf::from("/Applications/WriteThatDown.app"),
        home_dir.join("Applications/WriteThatDown.app"),
    ]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallationState {
    Installed,
    NotInstalled,
    Unsupported,
}

impl InstallationState {
    pub fn as_wire(self) -> &'static str {
        match self {
            InstallationState::Installed => "installed",
            InstallationState::NotInstalled => "not-installed",
            InstallationState::Unsupported => "unsupported",
        }
    }
}

/// The headline answer for the surface. `Ready` and `Empty` both mean "the
/// notes directory is readable"; they differ so the UI never renders "no
/// meetings" for a folder it merely could not find.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AvailabilityReason {
    UnsupportedPlatform,
    NotInstalled,
    InvalidConfiguration,
    TranscriptRootMissing,
    TranscriptRootUnreadable,
    Empty,
    Ready,
}

impl AvailabilityReason {
    pub fn as_wire(self) -> &'static str {
        match self {
            AvailabilityReason::UnsupportedPlatform => "unsupported-platform",
            AvailabilityReason::NotInstalled => "not-installed",
            AvailabilityReason::InvalidConfiguration => "invalid-configuration",
            AvailabilityReason::TranscriptRootMissing => "transcript-root-missing",
            AvailabilityReason::TranscriptRootUnreadable => "transcript-root-unreadable",
            AvailabilityReason::Empty => "empty",
            AvailabilityReason::Ready => "ready",
        }
    }

    pub fn is_available(self) -> bool {
        matches!(self, AvailabilityReason::Ready | AvailabilityReason::Empty)
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MeetingAvailability {
    pub status: &'static str,
    pub reason: &'static str,
    pub platform: String,
    pub supported: bool,
    pub installation: &'static str,
    pub configuration: &'static str,
    pub configured: bool,
    pub config_path: String,
    pub config_present: bool,
    pub transcript_root: String,
    /// Which layer produced `transcriptRoot`: `default`, `config` (the tool's
    /// own `config.json`) or `environment` (`WTD_OUTPUT_DIR`).
    pub transcript_root_source: &'static str,
    /// Independent of `reason`, so a missing folder is always named even when
    /// the headline is "not installed".
    pub transcript_root_state: &'static str,
    /// Drogon never writes to the notes; stated on the wire, not just here.
    pub read_only: bool,
    /// Whether suggestions can be extracted at all on this host. The page
    /// disables the action and says why instead of offering a button that
    /// would fail.
    pub analysis: analysis::AnalysisStatus,
}

/// One list page. `has_more` and `scan_truncated` are separate on purpose:
/// the first means "page further", the second means "the index itself
/// stopped early, so this is a lower bound".
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MeetingsPage {
    pub availability: MeetingAvailability,
    pub meetings: Vec<MeetingTranscript>,
    pub total: usize,
    pub offset: u32,
    pub limit: u32,
    pub has_more: bool,
    pub scan_truncated: bool,
    /// The filters this page was built with, echoed back so a page renderer
    /// never has to guess which of its inputs the daemon actually applied.
    pub filters: AppliedFilters,
    /// Transcript files whose text a search read (0 without a query).
    pub scanned: usize,
    /// True when the request carried a text query, so "no rows" can be told
    /// apart from "nothing searched".
    pub searched: bool,
}

/// The validated filter set, as the wire reports it.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppliedFilters {
    pub query: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub min_minutes: Option<u32>,
    pub max_minutes: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MeetingReadOutcome {
    pub meeting: MeetingTranscript,
    pub content: String,
    pub size: u64,
    /// The file was longer than the requested byte budget; `content` is a
    /// complete prefix, cut on a UTF-8 boundary.
    pub truncated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeetingsParamError {
    Limit,
    Offset,
    Filter(MeetingFilterError),
}

/// `true` when the Write That Down app bundle is present on this host.
fn installation(
    file_system: &dyn MeetingFileSystem,
    environment: &MeetingEnvironment,
) -> InstallationState {
    if !environment.supported() {
        return InstallationState::Unsupported;
    }
    for candidate in &environment.app_candidates {
        let app_ok = file_system
            .metadata(candidate)
            .map(|meta| meta.is_dir)
            .unwrap_or(false);
        if !app_ok {
            continue;
        }
        let executable = candidate.join(APP_EXECUTABLE);
        if file_system
            .metadata(&executable)
            .map(|meta| meta.is_file)
            .unwrap_or(false)
        {
            return InstallationState::Installed;
        }
    }
    InstallationState::NotInstalled
}

fn availability_reason(
    environment: &MeetingEnvironment,
    installation: InstallationState,
    configuration: &ResolvedConfiguration,
    directory_state: DirectoryState,
    indexed: usize,
    scan_truncated: bool,
) -> AvailabilityReason {
    if !environment.supported() {
        return AvailabilityReason::UnsupportedPlatform;
    }
    if installation != InstallationState::Installed {
        return AvailabilityReason::NotInstalled;
    }
    if configuration.invalid() {
        return AvailabilityReason::InvalidConfiguration;
    }
    match directory_state {
        DirectoryState::Missing => AvailabilityReason::TranscriptRootMissing,
        DirectoryState::Unreadable => AvailabilityReason::TranscriptRootUnreadable,
        DirectoryState::Readable => {
            if indexed == 0 && !scan_truncated {
                AvailabilityReason::Empty
            } else {
                AvailabilityReason::Ready
            }
        }
    }
}

fn build_availability(
    environment: &MeetingEnvironment,
    configuration: &ResolvedConfiguration,
    installation: InstallationState,
    walk: &transcripts::Walk,
) -> MeetingAvailability {
    // The headline reason is computed from the FULL walk when paging, so
    // page 2 of an empty-looking page still reports `ready`.
    let reason = availability_reason(
        environment,
        installation,
        configuration,
        walk.directory_state,
        walk.entries.len(),
        walk.scan_truncated,
    );
    MeetingAvailability {
        status: if reason.is_available() {
            "available"
        } else {
            "unavailable"
        },
        reason: reason.as_wire(),
        platform: environment.platform.clone(),
        supported: environment.supported(),
        installation: installation.as_wire(),
        configuration: configuration.state.as_wire(),
        configured: configuration.state != ConfigurationState::Defaults,
        config_path: configuration.config_path.display().to_string(),
        config_present: configuration.config_present,
        transcript_root: configuration.output_dir.display().to_string(),
        transcript_root_source: configuration.source.as_wire(),
        transcript_root_state: match walk.directory_state {
            DirectoryState::Missing => "missing",
            DirectoryState::Unreadable => "unreadable",
            DirectoryState::Readable => "readable",
        },
        read_only: true,
        analysis: if environment.analysis_harness.is_some() {
            analysis::AnalysisStatus::ready()
        } else {
            analysis::AnalysisStatus::missing()
        },
    }
}

/// One page of meetings, newest first, optionally filtered and searched.
///
/// Two different amounts of work happen here, and the difference is the point:
///
/// * **No text query.** The walk reads names and metadata only, the filters
///   are decided from those, and just the rows on the page have their bounded
///   header window read. Paging through 327 transcripts therefore never reads
///   327 conversations — it reads 50 (or 200) headers.
/// * **Text query.** Bodies must be read, so the scan streams newest-first,
///   one file at a time, under [`MAX_SEARCH_BYTES`], and only the requested
///   window of matching rows is kept.
pub fn list(
    file_system: &dyn MeetingFileSystem,
    environment: &MeetingEnvironment,
    limit: Option<u32>,
    offset: Option<u32>,
    filters: MeetingFilters,
) -> Result<MeetingsPage, MeetingsParamError> {
    let limit = limit.unwrap_or(DEFAULT_PAGE_SIZE);
    if limit == 0 || limit > MAX_PAGE_SIZE {
        return Err(MeetingsParamError::Limit);
    }
    let offset = offset.unwrap_or(0);
    if offset > 1_000_000 {
        return Err(MeetingsParamError::Offset);
    }
    let filters = filters.validated().map_err(MeetingsParamError::Filter)?;
    let configuration = resolve(file_system, environment);
    let walk = transcripts::walk(
        file_system,
        &configuration.output_dir,
        MAX_DATE_FOLDERS_SCANNED,
        MAX_TRANSCRIPTS_SCANNED,
    );
    let installation = installation(file_system, environment);
    // The headline is computed from everything the walk saw, so page 2 of an
    // empty-looking page still reports `ready`.
    let availability = build_availability(environment, &configuration, installation, &walk);
    let applied = AppliedFilters {
        query: filters.text.clone(),
        from: filters.from.clone(),
        to: filters.to.clone(),
        min_minutes: filters.min_minutes,
        max_minutes: filters.max_minutes,
    };

    let (rows, total, scanned, searched, search_truncated) = match &filters.text {
        Some(query) => {
            let outcome = search::search(
                file_system,
                &walk,
                &filters,
                query,
                limit as usize,
                offset as usize,
            );
            (
                outcome.rows,
                outcome.matched,
                outcome.scanned,
                true,
                outcome.truncated,
            )
        }
        None => {
            let matching: Vec<&ScanEntry> = walk
                .entries
                .iter()
                .filter(|entry| {
                    let status = if entry.filename.duration_minutes.is_some() {
                        MeetingStatus::Saved
                    } else {
                        MeetingStatus::Recording
                    };
                    filters.matches_metadata(
                        &entry.date_folder,
                        status,
                        entry.filename.duration_minutes,
                    )
                })
                .collect();
            let start = (offset as usize).min(matching.len());
            let end = start.saturating_add(limit as usize).min(matching.len());
            let rows = matching[start..end]
                .iter()
                .map(|entry| transcripts::row_for(file_system, entry))
                .collect();
            (rows, matching.len(), 0, false, false)
        }
    };

    Ok(MeetingsPage {
        availability,
        meetings: rows,
        total,
        offset,
        limit,
        has_more: (offset as usize).saturating_add(limit as usize) < total,
        scan_truncated: walk.scan_truncated || search_truncated,
        filters: applied,
        scanned,
        searched,
    })
}

/// Reads one transcript, bounded by `max_bytes` (default: the whole file, up
/// to the 5 MiB transcript cap). The id is re-validated against the resolved
/// notes directory before any read.
pub fn read(
    file_system: &dyn MeetingFileSystem,
    environment: &MeetingEnvironment,
    id: &str,
    max_bytes: Option<u64>,
) -> Result<MeetingReadOutcome, MeetingReadSpecError> {
    let max_bytes = max_bytes.unwrap_or(MAX_TRANSCRIPT_BYTES);
    if max_bytes == 0 || max_bytes > MAX_TRANSCRIPT_BYTES {
        return Err(MeetingReadSpecError::BadMaxBytes);
    }
    let configuration = resolve(file_system, environment);
    let meeting = read_by_id(file_system, &configuration.output_dir, id)
        .map_err(MeetingReadSpecError::Read)?;
    let bytes = file_system
        .read_file(std::path::Path::new(&meeting.file_path))
        .map_err(|_| MeetingReadSpecError::Read(MeetingReadError::Missing))?;
    let size = bytes.len() as u64;
    let truncated = size > max_bytes;
    let slice = if truncated {
        utf8_prefix(&bytes, max_bytes as usize)
    } else {
        bytes.as_slice()
    };
    let content = std::str::from_utf8(slice)
        .map_err(|_| MeetingReadSpecError::Read(MeetingReadError::NotUtf8))?
        .to_string();
    Ok(MeetingReadOutcome {
        meeting,
        content,
        size,
        truncated,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeetingReadSpecError {
    BadMaxBytes,
    Read(MeetingReadError),
}

/// Longest prefix of `bytes` that is at most `limit` bytes long and ends on a
/// UTF-8 character boundary. Never substitutes replacement characters.
fn utf8_prefix(bytes: &[u8], limit: usize) -> &[u8] {
    let mut end = limit.min(bytes.len());
    while end > 0 {
        if let Ok(text) = std::str::from_utf8(&bytes[..end]) {
            // Re-slice to the validated length so the borrow's lifetime does
            // not depend on `text`.
            return &bytes[..text.len()];
        }
        end -= 1;
    }
    &bytes[..0]
}

#[cfg(test)]
mod tests {
    use super::filesystem::tests::FakeFileSystem;
    use super::*;

    fn environment(home: &str) -> MeetingEnvironment {
        MeetingEnvironment {
            platform: "macos".into(),
            home_dir: PathBuf::from(home),
            variables: BTreeMap::new(),
            app_candidates: vec![PathBuf::from("/Applications/WriteThatDown.app")],
            analysis_harness: None,
        }
    }

    fn installed(fs: &mut FakeFileSystem) {
        fs.insert_file(
            "/Applications/WriteThatDown.app/Contents/MacOS/WriteThatDown",
            b"binary",
        );
    }

    fn note(date: &str, time: &str, duration: &str, body: &str) -> String {
        format!(
            "# Meeting on {date}\n**Date:** {date} {time}\n**Duration:** {duration}\n\n## Transcript\n\n{body}\n"
        )
    }

    fn seed(fs: &mut FakeFileSystem, root: &str, count: u32) {
        seed_corpus(fs, root, count);
    }

    /// `count` real, distinct calendar dates in descending order, ending
    /// yesterday-by-one from 2026-09-10. A corpus bigger than one month is
    /// the case the section exists for, so the fixture walks a real calendar
    /// instead of inventing impossible dates like `2026-09-45`.
    fn corpus_dates(count: u32) -> Vec<String> {
        fn days_in_month(year: i32, month: u32) -> u32 {
            match month {
                1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
                4 | 6 | 9 | 11 => 30,
                _ if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 => 29,
                _ => 28,
            }
        }
        let (mut year, mut month, mut day) = (2026i32, 9u32, 10u32);
        let mut dates = Vec::with_capacity(count as usize);
        for _ in 0..count {
            dates.push(format!("{year:04}-{month:02}-{day:02}"));
            if day > 1 {
                day -= 1;
            } else {
                if month > 1 {
                    month -= 1;
                } else {
                    month = 12;
                    year -= 1;
                }
                day = days_in_month(year, month);
            }
        }
        dates
    }

    fn seed_corpus(fs: &mut FakeFileSystem, root: &str, count: u32) -> Vec<String> {
        let dates = corpus_dates(count);
        for (index, date) in dates.iter().enumerate() {
            let minutes = 5 + (index as u32 % 7) * 10;
            fs.insert_file(
                &format!("{root}/{date}/08-00_{minutes}min.md"),
                note(date, "08:00", &format!("{minutes} min"), "hola").as_bytes(),
            );
        }
        dates
    }

    #[test]
    fn not_installed_is_distinct_from_an_empty_folder() {
        let mut fs = FakeFileSystem::default();
        let env = environment("/home/carlos");
        // Neither the app nor the folder exists yet (this machine's state
        // before Write That Down was installed).
        let page = list(&fs, &env, None, None, MeetingFilters::default()).unwrap();
        assert_eq!(page.availability.reason, "not-installed");
        assert_eq!(page.availability.status, "unavailable");
        assert_eq!(page.availability.installation, "not-installed");
        assert_eq!(page.availability.transcript_root_state, "missing");
        assert_eq!(
            page.availability.transcript_root,
            "/home/carlos/Transcripts"
        );
        assert_eq!(page.availability.transcript_root_source, "default");
        assert!(page.availability.read_only);

        // Installed, folder absent.
        installed(&mut fs);
        let page = list(&fs, &env, None, None, MeetingFilters::default()).unwrap();
        assert_eq!(page.availability.reason, "transcript-root-missing");

        // Installed, folder present and empty: the only case where "no
        // meetings" is the truth.
        fs.insert_dir("/home/carlos/Transcripts");
        let page = list(&fs, &env, None, None, MeetingFilters::default()).unwrap();
        assert_eq!(page.availability.reason, "empty");
        assert_eq!(page.availability.status, "available");
        assert_eq!(page.availability.transcript_root_state, "readable");
    }

    #[test]
    fn unreadable_and_invalid_configuration_are_reported_as_themselves() {
        let mut fs = FakeFileSystem::default();
        installed(&mut fs);
        fs.insert_dir("/home/carlos/Transcripts");
        fs.make_dir_unreadable("/home/carlos/Transcripts");
        let page = list(
            &fs,
            &environment("/home/carlos"),
            None,
            None,
            MeetingFilters::default(),
        )
        .unwrap();
        assert_eq!(page.availability.reason, "transcript-root-unreadable");

        let mut fs = FakeFileSystem::default();
        installed(&mut fs);
        fs.insert_file(
            "/home/carlos/Library/Application Support/WriteThatDown/config.json",
            b"{oops",
        );
        let page = list(
            &fs,
            &environment("/home/carlos"),
            None,
            None,
            MeetingFilters::default(),
        )
        .unwrap();
        assert_eq!(page.availability.reason, "invalid-configuration");
        assert_eq!(page.availability.configuration, "invalid");
    }

    #[test]
    fn unsupported_platform_never_claims_a_missing_tool() {
        let fs = FakeFileSystem::default();
        let mut env = environment("/home/carlos");
        env.platform = "linux".into();
        let page = list(&fs, &env, None, None, MeetingFilters::default()).unwrap();
        assert_eq!(page.availability.reason, "unsupported-platform");
        assert_eq!(page.availability.installation, "unsupported");
    }

    #[test]
    fn listing_is_paged_newest_first_without_loading_everything() {
        let mut fs = FakeFileSystem::default();
        installed(&mut fs);
        seed(&mut fs, "/home/carlos/Transcripts", 10);
        let env = environment("/home/carlos");
        let first = list(&fs, &env, Some(3), None, MeetingFilters::default()).unwrap();
        assert_eq!(first.total, 10);
        assert_eq!(first.limit, 3);
        assert_eq!(first.offset, 0);
        assert!(first.has_more);
        assert_eq!(first.meetings.len(), 3);
        assert_eq!(first.meetings[0].date_folder, "2026-09-10");
        assert_eq!(first.meetings[2].date_folder, "2026-09-08");

        let second = list(&fs, &env, Some(3), Some(3), MeetingFilters::default()).unwrap();
        assert_eq!(second.meetings[0].date_folder, "2026-09-07");
        assert_eq!(second.availability.reason, "ready");

        let last = list(&fs, &env, Some(3), Some(9), MeetingFilters::default()).unwrap();
        assert_eq!(last.meetings.len(), 1);
        assert!(!last.has_more);
        assert_eq!(last.meetings[0].date_folder, "2026-09-01");

        let past_end = list(&fs, &env, Some(3), Some(50), MeetingFilters::default()).unwrap();
        assert!(past_end.meetings.is_empty());
        assert!(!past_end.has_more);
        assert_eq!(past_end.availability.reason, "ready");
    }

    #[test]
    fn page_bounds_are_validated() {
        let fs = FakeFileSystem::default();
        let env = environment("/home/carlos");
        assert_eq!(
            list(&fs, &env, Some(0), None, MeetingFilters::default()),
            Err(MeetingsParamError::Limit)
        );
        assert_eq!(
            list(
                &fs,
                &env,
                Some(MAX_PAGE_SIZE + 1),
                None,
                MeetingFilters::default()
            ),
            Err(MeetingsParamError::Limit)
        );
        assert_eq!(
            list(&fs, &env, None, Some(1_000_001), MeetingFilters::default()),
            Err(MeetingsParamError::Offset)
        );
        assert!(
            list(
                &fs,
                &env,
                Some(MAX_PAGE_SIZE),
                None,
                MeetingFilters::default()
            )
            .is_ok()
        );
    }

    #[test]
    fn read_returns_the_note_and_refuses_foreign_ids() {
        let mut fs = FakeFileSystem::default();
        installed(&mut fs);
        let root = "/home/carlos/Transcripts";
        let path = format!("{root}/2026-09-10/08-00_30min.md");
        fs.insert_file(
            &path,
            note("2026-09-10", "08:00", "30 min", "[00:00] hola").as_bytes(),
        );
        fs.insert_file("/etc/passwd", b"root:x:0:0");
        let env = environment("/home/carlos");
        let outcome = read(&fs, &env, &transcript_id(std::path::Path::new(&path)), None).unwrap();
        assert_eq!(outcome.meeting.title, "Meeting on 2026-09-10");
        assert!(outcome.content.contains("[00:00] hola"));
        assert_eq!(outcome.meeting.status, MeetingStatus::Saved);
        assert_eq!(outcome.meeting.duration_minutes, Some(30));
        assert!(!outcome.truncated);
        assert_eq!(
            outcome.size,
            fs.read_file(std::path::Path::new(&path)).unwrap().len() as u64
        );

        assert!(matches!(
            read(&fs, &env, "write-that-down:/etc/passwd", None),
            Err(MeetingReadSpecError::Read(MeetingReadError::OutsideRoot))
        ));
        assert!(matches!(
            read(&fs, &env, "write-that-down:", None),
            Err(MeetingReadSpecError::Read(MeetingReadError::UnknownId))
        ));
        assert!(matches!(
            read(&fs, &env, "random", None),
            Err(MeetingReadSpecError::Read(MeetingReadError::UnknownId))
        ));
    }

    #[test]
    fn read_truncates_on_a_character_boundary_and_reports_it() {
        let mut fs = FakeFileSystem::default();
        installed(&mut fs);
        let path = "/home/carlos/Transcripts/2026-09-10/08-00_30min.md";
        let body = format!("{}🦀🦀", "a".repeat(200));
        fs.insert_file(
            path,
            note("2026-09-10", "08:00", "30 min", &body).as_bytes(),
        );
        let env = environment("/home/carlos");
        let full = fs.read_file(std::path::Path::new(path)).unwrap();
        let outcome = read(
            &fs,
            &env,
            &transcript_id(std::path::Path::new(path)),
            Some(100),
        )
        .unwrap();
        assert!(outcome.truncated);
        assert_eq!(outcome.size, full.len() as u64);
        assert!(outcome.content.len() <= 100);
        // The prefix is a complete UTF-8 document: no replacement characters
        // were substituted at the cut.
        assert!(!outcome.content.contains('\u{FFFD}'));
        assert_eq!(
            read(
                &fs,
                &env,
                &transcript_id(std::path::Path::new(path)),
                Some(0)
            ),
            Err(MeetingReadSpecError::BadMaxBytes)
        );
        assert_eq!(
            read(
                &fs,
                &env,
                &transcript_id(std::path::Path::new(path)),
                Some(MAX_TRANSCRIPT_BYTES + 1)
            ),
            Err(MeetingReadSpecError::BadMaxBytes)
        );
    }

    #[test]
    fn wtd_output_dir_overrides_the_resolved_root() {
        let mut fs = FakeFileSystem::default();
        installed(&mut fs);
        fs.insert_file(
            "/tmp/fixture/2026-09-10/08-00_30min.md",
            note("2026-09-10", "08:00", "30 min", "x").as_bytes(),
        );
        let mut env = environment("/home/carlos");
        env.variables
            .insert("WTD_OUTPUT_DIR".into(), "/tmp/fixture".into());
        let page = list(&fs, &env, None, None, MeetingFilters::default()).unwrap();
        assert_eq!(page.availability.transcript_root, "/tmp/fixture");
        assert_eq!(page.availability.transcript_root_source, "environment");
        assert_eq!(page.availability.reason, "ready");
        assert_eq!(page.total, 1);
    }

    #[test]
    fn listing_a_page_never_reads_a_whole_note() {
        use super::filesystem::tests::CountingFileSystem;
        let mut counting = CountingFileSystem::default();
        installed(counting.inner_mut());
        let dates = seed_corpus(counting.inner_mut(), "/home/carlos/Transcripts", 300);
        let env = environment("/home/carlos");

        // A page of 20 out of 300: metadata only for the walk, one bounded
        // header window for each rendered row, and not one whole-file read.
        let page = list(&counting, &env, Some(20), None, MeetingFilters::default()).unwrap();
        assert_eq!(page.total, 300);
        assert_eq!(page.meetings.len(), 20);
        assert_eq!(counting.file_reads(), 0);
        assert_eq!(counting.prefix_reads(), 20);
        assert!(counting.prefix_read_bytes() <= 20 * HEADER_WINDOW_BYTES);

        // Page 2 reads 20 more windows and still no whole note.
        let second = list(
            &counting,
            &env,
            Some(20),
            Some(20),
            MeetingFilters::default(),
        )
        .unwrap();
        assert_eq!(second.meetings[0].date_folder, dates[20]);
        assert_eq!(page.meetings[0].date_folder, dates[0]);
        assert_ne!(page.meetings[0].id, second.meetings[0].id);
        assert_eq!(counting.file_reads(), 0);
        assert_eq!(counting.prefix_reads(), 40);

        // A note whose window cannot decide falls back to a full read — but
        // only that note.
        counting.inner_mut().insert_file(
            "/home/carlos/Transcripts/2027-01-12/09-00_5min.md",
            format!(
                "# Long preamble\n**Date:** 2026-09-12 09:00\n**Duration:** 5 min\n\n{}\n## Transcript\n\nhi\n",
                "filler ".repeat(4_000)
            )
            .as_bytes(),
        );
        let page = list(&counting, &env, Some(1), None, MeetingFilters::default()).unwrap();
        assert_eq!(page.meetings[0].date_folder, "2027-01-12");
        assert_eq!(counting.paths_read_in_full().len(), 1);
    }

    #[test]
    fn a_window_that_cannot_decide_never_turns_a_note_into_a_malformed_one() {
        let mut fs = FakeFileSystem::default();
        installed(&mut fs);
        // The heading sits beyond the header window, so the window alone is
        // indeterminate and the full read supplies the real verdict.
        let path = "/home/carlos/Transcripts/2026-09-12/09-00_5min.md";
        let body = format!(
            "# Long preamble\n**Date:** 2026-09-12 09:00\n**Duration:** 5 min\n\n{}\n## Transcript\n\n[00:00] the real transcript\n",
            "x".repeat(20_000)
        );
        assert!(body.len() as u64 > HEADER_WINDOW_BYTES);
        fs.insert_file(path, body.as_bytes());
        let page = list(
            &fs,
            &environment("/home/carlos"),
            None,
            None,
            MeetingFilters::default(),
        )
        .unwrap();
        assert_eq!(page.meetings.len(), 1);
        assert_eq!(page.meetings[0].status, MeetingStatus::Saved);
        assert_eq!(
            page.meetings[0].id,
            transcript_id(std::path::Path::new(path))
        );
        assert!(page.meetings[0].excerpt.contains("the real transcript"));
    }

    #[test]
    fn filters_select_by_date_duration_and_text_across_the_corpus() {
        let mut fs = FakeFileSystem::default();
        installed(&mut fs);
        let root = "/home/carlos/Transcripts";
        for (date, time, duration, title, body) in [
            ("2026-09-10", "08-00", "15 min", "Budget review", "we ship"),
            (
                "2026-09-09",
                "09-00",
                "45 min",
                "Design sync",
                "budget again",
            ),
            ("2026-08-01", "10-00", "90 min", "Kickoff", "nothing here"),
            ("2026-08-01", "11-00", "5 min", "Standup", "unrelated"),
        ] {
            fs.insert_file(
                &format!(
                    "{root}/{date}/{time}_{}.md",
                    duration.replace(" min", "min")
                ),
                note(date, &time.replace('-', ":"), duration, body)
                    .replace("# Meeting on", &format!("# {title} on"))
                    .as_bytes(),
            );
        }
        let env = environment("/home/carlos");
        let range = MeetingFilters {
            from: Some("2026-09-09".into()),
            to: Some("2026-09-10".into()),
            ..MeetingFilters::default()
        };
        let page = list(&fs, &env, None, None, range).unwrap();
        assert_eq!(page.total, 2);
        assert_eq!(page.filters.from.as_deref(), Some("2026-09-09"));

        let short = MeetingFilters {
            max_minutes: Some(30),
            ..MeetingFilters::default()
        };
        let page = list(&fs, &env, None, None, short).unwrap();
        assert_eq!(page.total, 2);
        // Newest first, so the 15-minute note precedes the 5-minute one.
        assert_eq!(page.meetings[0].duration_minutes, Some(15));
        assert_eq!(page.meetings[1].duration_minutes, Some(5));

        let searched = MeetingFilters {
            text: Some("BUDGET".into()),
            ..MeetingFilters::default()
        };
        let page = list(&fs, &env, None, None, searched).unwrap();
        assert!(page.searched);
        assert_eq!(page.total, 2);
        assert!(page.scanned >= 2);
        assert_eq!(page.filters.query.as_deref(), Some("budget"));
        assert!(page.meetings[0].matches[0].text.contains("udget"));

        // Both together, and an honest empty result.
        let combined = MeetingFilters {
            text: Some("budget".into()),
            from: Some("2026-09-10".into()),
            ..MeetingFilters::default()
        };
        assert_eq!(list(&fs, &env, None, None, combined).unwrap().total, 1);
        let nothing = MeetingFilters {
            text: Some("budget".into()),
            from: Some("2026-08-01".into()),
            to: Some("2026-08-01".into()),
            ..MeetingFilters::default()
        };
        let page = list(&fs, &env, None, None, nothing).unwrap();
        assert!(page.searched);
        assert_eq!(page.total, 0);
        assert!(page.meetings.is_empty());
        assert!(!page.has_more);
        assert_eq!(page.availability.reason, "ready");
    }

    #[test]
    fn a_bad_filter_is_refused_instead_of_clamped() {
        let fs = FakeFileSystem::default();
        let env = environment("/home/carlos");
        assert_eq!(
            list(
                &fs,
                &env,
                None,
                None,
                MeetingFilters {
                    text: Some("   ".into()),
                    ..MeetingFilters::default()
                },
            ),
            Err(MeetingsParamError::Filter(MeetingFilterError::EmptyQuery))
        );
        assert_eq!(
            list(
                &fs,
                &env,
                None,
                None,
                MeetingFilters {
                    from: Some("yesterday".into()),
                    ..MeetingFilters::default()
                },
            ),
            Err(MeetingsParamError::Filter(MeetingFilterError::From))
        );
    }

    #[test]
    fn indexing_reading_and_searching_never_write_to_the_notes_directory() {
        // The read-only guarantee is a property of the whole module, so it is
        // asserted against the real filesystem: build a real corpus, exercise
        // every entry point, and prove the tree is byte-identical afterwards.
        let root = tempfile::tempdir().expect("temp root");
        let home = root.path().join("home");
        // The tool's own default lives under the user's home; the test uses
        // its OWN home so the developer's real notes are never in play.
        let notes = home.join("Transcripts");
        for day in 1..=6 {
            let date = format!("2026-09-{day:02}");
            let dir = notes.join(&date);
            std::fs::create_dir_all(&dir).expect("date folder");
            std::fs::write(
                dir.join("08-00_30min.md"),
                note(&date, "08:00", "30 min", "[00:00] budget and owners"),
            )
            .expect("note");
        }
        std::fs::write(notes.join("loose-note.md"), "not a transcript").expect("loose note");
        let before = tree_fingerprint(&notes);

        std::fs::create_dir_all(home.join("Applications/WriteThatDown.app/Contents/MacOS"))
            .expect("app bundle");
        std::fs::write(
            home.join("Applications/WriteThatDown.app/Contents/MacOS/WriteThatDown"),
            b"binary",
        )
        .expect("app binary");
        let mut env = MeetingEnvironment {
            platform: "macos".into(),
            home_dir: home.clone(),
            variables: BTreeMap::new(),
            app_candidates: vec![home.join("Applications/WriteThatDown.app")],
            analysis_harness: None,
        };

        let real = RealMeetingFileSystem;
        let page = list(&real, &env, None, None, MeetingFilters::default()).unwrap();
        assert_eq!(page.total, 6);
        assert_eq!(page.availability.reason, "ready");
        let searched = list(
            &real,
            &env,
            None,
            None,
            MeetingFilters {
                text: Some("budget".into()),
                ..MeetingFilters::default()
            },
        )
        .unwrap();
        assert_eq!(searched.total, 6);
        let id = page.meetings[0].id.clone();
        let read = read(&real, &env, &id, None).unwrap();
        assert!(read.content.contains("budget and owners"));

        // Every honest state is also a read-only state: point the daemon at
        // a root that does not exist.
        env.variables.insert(
            "WTD_OUTPUT_DIR".into(),
            root.path().join("absent").display().to_string(),
        );
        assert_eq!(
            list(&real, &env, None, None, MeetingFilters::default())
                .unwrap()
                .availability
                .reason,
            "transcript-root-missing"
        );

        assert_eq!(tree_fingerprint(&notes), before);
        assert!(!root.path().join("absent").exists());
    }

    /// Every path, kind and size under `dir`, so any create, edit, move or
    /// delete shows up as a difference.
    fn tree_fingerprint(dir: &std::path::Path) -> Vec<String> {
        let mut out = Vec::new();
        let mut stack = vec![dir.to_path_buf()];
        while let Some(current) = stack.pop() {
            for entry in std::fs::read_dir(&current).expect("readable") {
                let entry = entry.expect("entry");
                let path = entry.path();
                let meta = entry.metadata().expect("metadata");
                let kind = if meta.is_dir() { "dir" } else { "file" };
                out.push(format!("{kind}:{}:{}", path.display(), meta.len()));
                if meta.is_dir() {
                    stack.push(path);
                }
            }
        }
        out.sort();
        out
    }

    #[test]
    fn availability_serializes_with_the_contract_field_names() {
        let mut fs = FakeFileSystem::default();
        installed(&mut fs);
        fs.insert_file(
            "/home/carlos/Transcripts/2026-09-10/08-00_30min.md",
            note("2026-09-10", "08:00", "30 min", "[00:00] hola").as_bytes(),
        );
        let page = list(
            &fs,
            &environment("/home/carlos"),
            None,
            None,
            MeetingFilters::default(),
        )
        .unwrap();
        let value = serde_json::to_value(&page).unwrap();
        assert_eq!(value["availability"]["transcriptRootState"], "readable");
        assert_eq!(value["availability"]["transcriptRootSource"], "default");
        assert_eq!(value["availability"]["readOnly"], true);
        assert_eq!(value["meetings"][0]["fileName"], "08-00_30min.md");
        assert_eq!(value["meetings"][0]["dateFolder"], "2026-09-10");
        assert_eq!(value["meetings"][0]["startedAt"], "2026-09-10 08:00");
        assert_eq!(value["meetings"][0]["durationMinutes"], 30);
        assert_eq!(value["meetings"][0]["status"], "saved");
        assert_eq!(value["meetings"][0]["excerpt"], "[00:00] hola");
        assert_eq!(value["availability"]["analysis"]["available"], false);
        assert_eq!(
            value["availability"]["analysis"]["reason"],
            "harness-missing"
        );
        assert_eq!(value["availability"]["analysis"]["freeLocalModel"], true);
        assert_eq!(value["hasMore"], false);
        assert_eq!(value["scanTruncated"], false);
        assert_eq!(value["total"], 1);
    }
}
