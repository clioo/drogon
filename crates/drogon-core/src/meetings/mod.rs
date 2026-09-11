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

pub mod configuration;
pub mod filesystem;
pub mod transcripts;

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::Serialize;

pub use configuration::{
    CONFIG_RELATIVE_PATH, ConfigurationState, DEFAULT_OUTPUT_DIR, ResolvedConfiguration,
    TranscriptRootSource, config_path, expand_tilde, resolve,
};
pub use filesystem::{
    DirectoryState, EntryKind, FileMetadata, MeetingFileSystem, RealMeetingFileSystem,
    inspect_directory, path_is_inside,
};
pub use transcripts::{
    DEFAULT_PAGE_SIZE, Discovery, MAX_DATE_FOLDERS_SCANNED, MAX_EXCERPT_CHARS, MAX_PAGE_SIZE,
    MAX_TRANSCRIPT_BYTES, MAX_TRANSCRIPTS_SCANNED, MeetingReadError, MeetingStatus,
    MeetingTranscript, ParsedTranscript, TranscriptFailureReason, TranscriptFilename, discover,
    is_date_folder_name, parse_transcript_filename, parse_transcript_markdown, read_by_id,
    transcript_excerpt, transcript_id, truncate_chars,
};

/// Service capability advertised by `status`. The desktop surface and the
/// CLI both gate on it, so a client that meets an older service says so
/// instead of showing an empty list.
pub const MEETINGS_CAPABILITY: &str = "meetings.v1";

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
    discovery: &Discovery,
) -> MeetingAvailability {
    // The headline reason is computed from the FULL index when paging, so
    // page 2 of an empty-looking page still reports `ready`.
    let reason = availability_reason(
        environment,
        installation,
        configuration,
        discovery.directory_state,
        discovery.transcripts.len(),
        discovery.scan_truncated,
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
        transcript_root_state: match discovery.directory_state {
            DirectoryState::Missing => "missing",
            DirectoryState::Unreadable => "unreadable",
            DirectoryState::Readable => "readable",
        },
        read_only: true,
    }
}

/// Full read-only index of the notes directory (bounded by the module's own
/// budgets). Both `list` and `read` start here so the availability they
/// report is the same answer.
fn index(
    file_system: &dyn MeetingFileSystem,
    environment: &MeetingEnvironment,
) -> (ResolvedConfiguration, Discovery) {
    let configuration = resolve(file_system, environment);
    let discovery = discover(
        file_system,
        &configuration.output_dir,
        MAX_DATE_FOLDERS_SCANNED,
        MAX_TRANSCRIPTS_SCANNED,
    );
    (configuration, discovery)
}

/// One page of meetings, newest first.
pub fn list(
    file_system: &dyn MeetingFileSystem,
    environment: &MeetingEnvironment,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<MeetingsPage, MeetingsParamError> {
    let limit = limit.unwrap_or(DEFAULT_PAGE_SIZE);
    if limit == 0 || limit > MAX_PAGE_SIZE {
        return Err(MeetingsParamError::Limit);
    }
    let offset = offset.unwrap_or(0);
    if offset > 1_000_000 {
        return Err(MeetingsParamError::Offset);
    }
    let (configuration, discovery) = index(file_system, environment);
    let installation = installation(file_system, environment);
    let availability = build_availability(environment, &configuration, installation, &discovery);
    let total = discovery.transcripts.len();
    let start = (offset as usize).min(total);
    let end = start.saturating_add(limit as usize).min(total);
    let page = discovery.transcripts[start..end].to_vec();
    Ok(MeetingsPage {
        availability,
        meetings: page,
        total,
        offset,
        limit,
        has_more: end < total,
        scan_truncated: discovery.scan_truncated,
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
        for day in 1..=count {
            let date = format!("2026-09-{day:02}");
            fs.insert_file(
                &format!("{root}/{date}/08-00_30min.md"),
                note(&date, "08:00", "30 min", "hola").as_bytes(),
            );
        }
    }

    #[test]
    fn not_installed_is_distinct_from_an_empty_folder() {
        let mut fs = FakeFileSystem::default();
        let env = environment("/home/carlos");
        // Neither the app nor the folder exists yet (this machine's state
        // before Write That Down was installed).
        let page = list(&fs, &env, None, None).unwrap();
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
        let page = list(&fs, &env, None, None).unwrap();
        assert_eq!(page.availability.reason, "transcript-root-missing");

        // Installed, folder present and empty: the only case where "no
        // meetings" is the truth.
        fs.insert_dir("/home/carlos/Transcripts");
        let page = list(&fs, &env, None, None).unwrap();
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
        let page = list(&fs, &environment("/home/carlos"), None, None).unwrap();
        assert_eq!(page.availability.reason, "transcript-root-unreadable");

        let mut fs = FakeFileSystem::default();
        installed(&mut fs);
        fs.insert_file(
            "/home/carlos/Library/Application Support/WriteThatDown/config.json",
            b"{oops",
        );
        let page = list(&fs, &environment("/home/carlos"), None, None).unwrap();
        assert_eq!(page.availability.reason, "invalid-configuration");
        assert_eq!(page.availability.configuration, "invalid");
    }

    #[test]
    fn unsupported_platform_never_claims_a_missing_tool() {
        let fs = FakeFileSystem::default();
        let mut env = environment("/home/carlos");
        env.platform = "linux".into();
        let page = list(&fs, &env, None, None).unwrap();
        assert_eq!(page.availability.reason, "unsupported-platform");
        assert_eq!(page.availability.installation, "unsupported");
    }

    #[test]
    fn listing_is_paged_newest_first_without_loading_everything() {
        let mut fs = FakeFileSystem::default();
        installed(&mut fs);
        seed(&mut fs, "/home/carlos/Transcripts", 10);
        let env = environment("/home/carlos");
        let first = list(&fs, &env, Some(3), None).unwrap();
        assert_eq!(first.total, 10);
        assert_eq!(first.limit, 3);
        assert_eq!(first.offset, 0);
        assert!(first.has_more);
        assert_eq!(first.meetings.len(), 3);
        assert_eq!(first.meetings[0].date_folder, "2026-09-10");
        assert_eq!(first.meetings[2].date_folder, "2026-09-08");

        let second = list(&fs, &env, Some(3), Some(3)).unwrap();
        assert_eq!(second.meetings[0].date_folder, "2026-09-07");
        assert_eq!(second.availability.reason, "ready");

        let last = list(&fs, &env, Some(3), Some(9)).unwrap();
        assert_eq!(last.meetings.len(), 1);
        assert!(!last.has_more);
        assert_eq!(last.meetings[0].date_folder, "2026-09-01");

        let past_end = list(&fs, &env, Some(3), Some(50)).unwrap();
        assert!(past_end.meetings.is_empty());
        assert!(!past_end.has_more);
        assert_eq!(past_end.availability.reason, "ready");
    }

    #[test]
    fn page_bounds_are_validated() {
        let fs = FakeFileSystem::default();
        let env = environment("/home/carlos");
        assert_eq!(
            list(&fs, &env, Some(0), None),
            Err(MeetingsParamError::Limit)
        );
        assert_eq!(
            list(&fs, &env, Some(MAX_PAGE_SIZE + 1), None),
            Err(MeetingsParamError::Limit)
        );
        assert_eq!(
            list(&fs, &env, None, Some(1_000_001)),
            Err(MeetingsParamError::Offset)
        );
        assert!(list(&fs, &env, Some(MAX_PAGE_SIZE), None).is_ok());
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
        let page = list(&fs, &env, None, None).unwrap();
        assert_eq!(page.availability.transcript_root, "/tmp/fixture");
        assert_eq!(page.availability.transcript_root_source, "environment");
        assert_eq!(page.availability.reason, "ready");
        assert_eq!(page.total, 1);
    }

    #[test]
    fn availability_serializes_with_the_contract_field_names() {
        let mut fs = FakeFileSystem::default();
        installed(&mut fs);
        fs.insert_file(
            "/home/carlos/Transcripts/2026-09-10/08-00_30min.md",
            note("2026-09-10", "08:00", "30 min", "[00:00] hola").as_bytes(),
        );
        let page = list(&fs, &environment("/home/carlos"), None, None).unwrap();
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
        assert_eq!(value["hasMore"], false);
        assert_eq!(value["scanTruncated"], false);
        assert_eq!(value["total"], 1);
    }
}
