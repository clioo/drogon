//! Indexing and parsing of Write That Down's Markdown transcripts.
//!
//! The tool writes one folder per day (`YYYY-MM-DD/`) and one Markdown file
//! per conversation (`HH-MM_<n>min.md`, or `HH-MM_recording_.md` while the
//! meeting is still running). Every rule below mirrors
//! `Sources/WriteThatDown/Sources/WriteThatDownKit/Persistence/TranscriptWriter.swift`
//! and `.../Presentation/ConversationLibraryModel.swift` in
//! `clioo/write-that-down-patrick`: the header shape, the date-folder name,
//! the duration placeholder (`recording…`), and the "reject anything that is
//! not a date-folder transcript" filter.
//!
//! The walk is bounded in three dimensions — date folders visited, files
//! read, bytes per file — so a notes directory with tens of thousands of
//! meetings is indexed newest-first without loading it into memory.

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::filesystem::{DirectoryState, EntryKind, MeetingFileSystem, inspect_directory};

/// Write That Down caps a single transcript at 5 MiB; anything larger is
/// reported as a named failure instead of being read.
pub const MAX_TRANSCRIPT_BYTES: u64 = 5 * 1024 * 1024;
/// Newest-first walk budget: enough for ~10 years of daily meetings.
pub const MAX_DATE_FOLDERS_SCANNED: usize = 1024;
/// Hard cap on transcript files examined per list call.
pub const MAX_TRANSCRIPTS_SCANNED: usize = 5_000;
/// Characters kept in a list row's excerpt (the row renders two lines).
pub const MAX_EXCERPT_CHARS: usize = 400;
/// Bound on `limit` for one page.
pub const MAX_PAGE_SIZE: u32 = 200;
pub const DEFAULT_PAGE_SIZE: u32 = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeetingStatus {
    Recording,
    Saved,
    Failed,
}

impl MeetingStatus {
    pub fn as_wire(self) -> &'static str {
        match self {
            MeetingStatus::Recording => "recording",
            MeetingStatus::Saved => "saved",
            MeetingStatus::Failed => "failed",
        }
    }
}

/// Serialized as the tool's own vocabulary on the wire, not as a Rust
/// variant name.
impl Serialize for MeetingStatus {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_wire())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranscriptFailureReason {
    Malformed,
    Unreadable,
    Oversized,
}

impl TranscriptFailureReason {
    pub fn as_wire(self) -> &'static str {
        match self {
            TranscriptFailureReason::Malformed => "malformed-transcript",
            TranscriptFailureReason::Unreadable => "unreadable-transcript",
            TranscriptFailureReason::Oversized => "oversized-transcript",
        }
    }
}

impl Serialize for TranscriptFailureReason {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_wire())
    }
}

/// One indexed meeting note. Every field is either read off disk or derived
/// from the file's own header and name; nothing here is invented.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingTranscript {
    pub id: String,
    pub title: String,
    pub file_name: String,
    pub file_path: String,
    /// Path relative to the notes directory (`YYYY-MM-DD/HH-MM_3min.md`).
    pub relative_path: String,
    pub date_folder: String,
    /// Local start time exactly as the tool recorded it (`YYYY-MM-DD HH:MM`).
    pub started_at: Option<String>,
    pub duration_minutes: Option<u32>,
    pub status: MeetingStatus,
    pub excerpt: String,
    pub failure_reason: Option<TranscriptFailureReason>,
}

impl MeetingTranscript {
    pub fn is_failed(&self) -> bool {
        self.status == MeetingStatus::Failed
    }
}

/// The id shape is the fork's (`write-that-down:<absolute path>`): stable
/// across restarts and self-describing for the CLI.
pub fn transcript_id(file_path: &Path) -> String {
    format!("write-that-down:{}", file_path.display())
}

pub fn id_file_path(id: &str) -> Option<&str> {
    id.strip_prefix("write-that-down:")
        .filter(|rest| !rest.is_empty())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TranscriptFilename {
    pub hour: u8,
    pub minute: u8,
    /// `None` while the file still carries the `recording…` placeholder.
    pub duration_minutes: Option<u32>,
}

/// True for `YYYY-MM-DD` names that are real calendar dates (2026-02-30 is
/// not). Mirrors `isWriteThatDownDateFolderName`.
pub fn is_date_folder_name(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let digits = |range: std::ops::Range<usize>| -> Option<u32> {
        let text = value.get(range)?;
        if !text.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        text.parse::<u32>().ok()
    };
    let (Some(year), Some(month), Some(day)) = (digits(0..4), digits(5..7), digits(8..10)) else {
        return false;
    };
    if month == 0 || month > 12 || day == 0 {
        return false;
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let days_in_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    day <= days_in_month
}

/// Parses `HH-MM_<n>min.md`, `HH-MM_<n>min_<k>.md` (collision suffix) and
/// `HH-MM_recording_.md` (still recording). Mirrors the fork's regex
/// `^(\d{2})-(\d{2})_(recording_|(\d+)min(?:_(\d+))?)\.md$`.
pub fn parse_transcript_filename(name: &str) -> Option<TranscriptFilename> {
    let stem = name.strip_suffix(".md")?;
    let (hour, minute) = parse_clock(stem.get(0..5)?)?;
    if stem.as_bytes().get(5) != Some(&b'_') {
        return None;
    }
    let rest = stem.get(6..)?;
    if rest == "recording_" {
        return Some(TranscriptFilename {
            hour,
            minute,
            duration_minutes: None,
        });
    }
    let (minutes_text, suffix) = match rest.split_once('_') {
        Some((minutes, suffix)) => (minutes, Some(suffix)),
        None => (rest, None),
    };
    let minutes_text = minutes_text.strip_suffix("min")?;
    if minutes_text.is_empty() || !minutes_text.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    if let Some(suffix) = suffix
        && (suffix.is_empty() || !suffix.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return None;
    }
    let minutes: u32 = minutes_text.parse().ok()?;
    Some(TranscriptFilename {
        hour,
        minute,
        duration_minutes: Some(minutes),
    })
}

/// `HH-MM` with an in-range clock time, the file-name form the tool writes
/// (`TranscriptWriter.timeName`).
fn parse_clock(value: &str) -> Option<(u8, u8)> {
    parse_clock_with(value, b'-')
}

/// `HH:MM` with an in-range clock time, the header form the tool writes
/// (`TranscriptWriter.headerDate`). The two separators are genuinely
/// different in Write That Down's own output, so they are parsed separately
/// rather than with one lenient rule.
fn parse_header_clock(value: &str) -> Option<(u8, u8)> {
    parse_clock_with(value, b':')
}

fn parse_clock_with(value: &str, separator: u8) -> Option<(u8, u8)> {
    let bytes = value.as_bytes();
    if bytes.len() != 5 || bytes[2] != separator {
        return None;
    }
    if !bytes
        .iter()
        .enumerate()
        .all(|(index, byte)| index == 2 || byte.is_ascii_digit())
    {
        return None;
    }
    let hour: u8 = value.get(0..2)?.parse().ok()?;
    let minute: u8 = value.get(3..5)?.parse().ok()?;
    if hour > 23 || minute > 59 {
        return None;
    }
    Some((hour, minute))
}

/// The parsed conversation document, as the tool's own library reader sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedTranscript {
    pub title: String,
    pub started_at: String,
    pub duration_minutes: Option<u32>,
    pub excerpt: String,
}

/// Header + `## Transcript` validation, cross-checked against the folder and
/// file name so a renamed or half-written file is reported as malformed
/// instead of being shown as a meeting that never happened.
pub fn parse_transcript_markdown(
    content: &str,
    date_folder: &str,
    filename: TranscriptFilename,
) -> Option<ParsedTranscript> {
    let lines: Vec<&str> = content
        .split('\n')
        .map(|line| line.trim_end_matches('\r'))
        .collect();
    let title = lines.first()?.strip_prefix("# ")?.trim();
    if title.is_empty() {
        return None;
    }
    let date_line = lines
        .iter()
        .find_map(|line| line.strip_prefix("**Date:** "))?;
    let started_at = date_line.trim();
    let (date_part, clock_part) = started_at.split_once(' ')?;
    let (hour, minute) = parse_header_clock(clock_part)?;
    if date_part != date_folder
        || hour != filename.hour
        || minute != filename.minute
        || !is_date_folder_name(date_part)
    {
        return None;
    }
    let has_heading = lines.contains(&"## Transcript");
    if !has_heading {
        return None;
    }
    let duration_line = lines
        .iter()
        .find_map(|line| line.strip_prefix("**Duration:** "))
        .map(str::trim);
    let recording = matches!(duration_line, Some("recording…") | Some("recording_"));
    let saved_duration = duration_line.and_then(parse_duration_minutes);
    match filename.duration_minutes {
        None if !recording => return None,
        Some(expected) if saved_duration != Some(expected) => return None,
        _ => {}
    }
    Some(ParsedTranscript {
        title: title.to_string(),
        started_at: started_at.to_string(),
        duration_minutes: filename.duration_minutes,
        excerpt: transcript_excerpt(content),
    })
}

/// `Some` only for the finalized `N min` header.
fn parse_duration_minutes(value: &str) -> Option<u32> {
    value.strip_suffix(" min")?.parse().ok()
}

/// The transcript body (everything after the `## Transcript` heading),
/// collapsed and bounded — the same region the fork's row renders.
pub fn transcript_excerpt(content: &str) -> String {
    let body = match content.split_once("## Transcript") {
        Some((_, rest)) => rest,
        None => content,
    };
    truncate_chars(body.trim(), MAX_EXCERPT_CHARS)
}

/// Char-boundary safe truncation; never returns a replacement character.
pub fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut out: String = value.chars().take(max_chars).collect();
    out.push('…');
    out
}

fn fallback_title(file_name: &str) -> String {
    let stem = file_name.strip_suffix(".md").unwrap_or(file_name);
    let trimmed = stem
        .split_once('_')
        .map(|(_, rest)| rest)
        .unwrap_or(stem)
        .trim_end_matches('_');
    if trimmed.is_empty() {
        "Untitled meeting".to_string()
    } else {
        trimmed.to_string()
    }
}

fn failed_transcript(
    root: &Path,
    date_folder: &str,
    file_name: &str,
    filename: TranscriptFilename,
    reason: TranscriptFailureReason,
    excerpt: String,
) -> MeetingTranscript {
    let file_path = root.join(date_folder).join(file_name);
    MeetingTranscript {
        id: transcript_id(&file_path),
        title: fallback_title(file_name),
        file_name: file_name.to_string(),
        relative_path: format!("{date_folder}/{file_name}"),
        file_path: file_path.display().to_string(),
        date_folder: date_folder.to_string(),
        started_at: Some(format!(
            "{date_folder} {:02}:{:02}",
            filename.hour, filename.minute
        )),
        duration_minutes: filename.duration_minutes,
        status: MeetingStatus::Failed,
        excerpt,
        failure_reason: Some(reason),
    }
}

/// Indexes one date folder's transcripts. Unrelated Markdown files (summary
/// sidecars, hand-written notes) are skipped by name, never guessed at.
fn read_date_folder(
    file_system: &dyn MeetingFileSystem,
    root: &Path,
    date_folder: &str,
    budget: &mut ScanBudget,
) -> Vec<MeetingTranscript> {
    let folder_path = root.join(date_folder);
    let Ok(entries) = file_system.read_dir(&folder_path) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .into_iter()
        .filter(|entry| entry.kind == EntryKind::File)
        .map(|entry| entry.name)
        .collect();
    names.sort();
    let mut out = Vec::new();
    for name in names {
        let Some(filename) = parse_transcript_filename(&name) else {
            continue;
        };
        if budget.files_left == 0 {
            budget.truncated = true;
            break;
        }
        budget.files_left -= 1;
        let file_path = folder_path.join(&name);
        let Ok(meta) = file_system.metadata(&file_path) else {
            out.push(failed_transcript(
                root,
                date_folder,
                &name,
                filename,
                TranscriptFailureReason::Unreadable,
                String::new(),
            ));
            continue;
        };
        if !meta.is_file {
            continue;
        }
        if meta.size > MAX_TRANSCRIPT_BYTES {
            out.push(failed_transcript(
                root,
                date_folder,
                &name,
                filename,
                TranscriptFailureReason::Oversized,
                String::new(),
            ));
            continue;
        }
        let Ok(bytes) = file_system.read_file(&file_path) else {
            out.push(failed_transcript(
                root,
                date_folder,
                &name,
                filename,
                TranscriptFailureReason::Unreadable,
                String::new(),
            ));
            continue;
        };
        let Ok(content) = std::str::from_utf8(&bytes) else {
            out.push(failed_transcript(
                root,
                date_folder,
                &name,
                filename,
                TranscriptFailureReason::Malformed,
                String::new(),
            ));
            continue;
        };
        match parse_transcript_markdown(content, date_folder, filename) {
            Some(parsed) => {
                let relative_path = format!("{date_folder}/{name}");
                out.push(MeetingTranscript {
                    id: transcript_id(&file_path),
                    title: parsed.title,
                    file_name: name,
                    relative_path,
                    file_path: file_path.display().to_string(),
                    date_folder: date_folder.to_string(),
                    started_at: Some(parsed.started_at),
                    duration_minutes: parsed.duration_minutes,
                    status: if parsed.duration_minutes.is_some() {
                        MeetingStatus::Saved
                    } else {
                        MeetingStatus::Recording
                    },
                    excerpt: parsed.excerpt,
                    failure_reason: None,
                })
            }
            None => out.push(failed_transcript(
                root,
                date_folder,
                &name,
                filename,
                TranscriptFailureReason::Malformed,
                transcript_excerpt(content),
            )),
        }
    }
    out
}

#[derive(Debug, Clone, Copy)]
struct ScanBudget {
    folders_left: usize,
    files_left: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone)]
pub struct Discovery {
    pub transcripts: Vec<MeetingTranscript>,
    pub directory_state: DirectoryState,
    /// The walk stopped at a budget, so "nothing older" would be a lie.
    pub scan_truncated: bool,
}

/// Newest-first index of the notes directory. Date folders are visited in
/// descending name order (= descending date), so the newest meetings are
/// always found even when the budget stops the walk.
pub fn discover(
    file_system: &dyn MeetingFileSystem,
    root: &Path,
    max_folders: usize,
    max_files: usize,
) -> Discovery {
    let directory_state = inspect_directory(file_system, root);
    if directory_state != DirectoryState::Readable {
        return Discovery {
            transcripts: Vec::new(),
            directory_state,
            scan_truncated: false,
        };
    }
    let entries = match file_system.read_dir(root) {
        Ok(entries) => entries,
        Err(_) => {
            return Discovery {
                transcripts: Vec::new(),
                directory_state: DirectoryState::Unreadable,
                scan_truncated: false,
            };
        }
    };
    let mut date_folders: Vec<String> = entries
        .into_iter()
        .filter(|entry| entry.kind == EntryKind::Directory)
        .map(|entry| entry.name)
        .filter(|name| is_date_folder_name(name))
        .collect();
    date_folders.sort();
    date_folders.reverse();
    let mut budget = ScanBudget {
        folders_left: max_folders,
        files_left: max_files,
        truncated: false,
    };
    let mut transcripts = Vec::new();
    for date_folder in date_folders {
        if budget.folders_left == 0 {
            budget.truncated = true;
            break;
        }
        budget.folders_left -= 1;
        transcripts.extend(read_date_folder(
            file_system,
            root,
            &date_folder,
            &mut budget,
        ));
    }
    // Newest first: date folder descending, then file name descending (the
    // time-of-day prefix makes the name order the chronological order).
    transcripts.sort_by(|left, right| {
        right
            .date_folder
            .cmp(&left.date_folder)
            .then_with(|| right.file_name.cmp(&left.file_name))
    });
    Discovery {
        transcripts,
        directory_state,
        scan_truncated: budget.truncated,
    }
}

/// Reads one transcript by id. The id carries an absolute path, so this
/// re-validates *everything* before touching the disk: the path must be
/// absolute, inside the resolved notes directory, sit in a real date folder
/// and carry a transcript file name. Nothing outside the notes directory is
/// ever readable through `meeting.read`.
pub fn read_by_id(
    file_system: &dyn MeetingFileSystem,
    root: &Path,
    id: &str,
) -> Result<MeetingTranscript, MeetingReadError> {
    let raw = id_file_path(id).ok_or(MeetingReadError::UnknownId)?;
    let file_path = PathBuf::from(raw);
    if !file_path.is_absolute() {
        return Err(MeetingReadError::UnknownId);
    }
    let file_path = super::filesystem::normalize(&file_path);
    if !super::filesystem::path_is_inside(root, &file_path) {
        return Err(MeetingReadError::OutsideRoot);
    }
    let file_name = file_path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or(MeetingReadError::UnknownId)?;
    let date_folder = file_path
        .parent()
        .and_then(|parent| parent.file_name())
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or(MeetingReadError::UnknownId)?;
    let filename = parse_transcript_filename(&file_name).ok_or(MeetingReadError::UnknownId)?;
    if !is_date_folder_name(&date_folder) {
        return Err(MeetingReadError::UnknownId);
    }
    let meta = file_system
        .metadata(&file_path)
        .map_err(|_| MeetingReadError::Missing)?;
    if !meta.is_file {
        return Err(MeetingReadError::Missing);
    }
    if meta.size > MAX_TRANSCRIPT_BYTES {
        return Err(MeetingReadError::Oversized);
    }
    let bytes = file_system
        .read_file(&file_path)
        .map_err(|_| MeetingReadError::Missing)?;
    let content = std::str::from_utf8(&bytes).map_err(|_| MeetingReadError::NotUtf8)?;
    match parse_transcript_markdown(content, &date_folder, filename) {
        Some(parsed) => Ok(MeetingTranscript {
            id: transcript_id(&file_path),
            title: parsed.title,
            file_name,
            relative_path: format!(
                "{date_folder}/{}",
                file_path.file_name().unwrap().to_string_lossy()
            ),
            file_path: file_path.display().to_string(),
            date_folder,
            started_at: Some(parsed.started_at),
            duration_minutes: parsed.duration_minutes,
            status: if parsed.duration_minutes.is_some() {
                MeetingStatus::Saved
            } else {
                MeetingStatus::Recording
            },
            excerpt: parsed.excerpt,
            failure_reason: None,
        }),
        None => Err(MeetingReadError::Malformed),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeetingReadError {
    /// The id is not a transcript id, or does not describe a transcript file
    /// inside a date folder.
    UnknownId,
    /// The path resolved outside the notes directory.
    OutsideRoot,
    /// The file is gone.
    Missing,
    /// Larger than the transcript cap.
    Oversized,
    /// Not valid UTF-8.
    NotUtf8,
    /// Present but not a valid conversation document.
    Malformed,
}

impl MeetingReadError {
    pub fn as_wire(self) -> &'static str {
        match self {
            MeetingReadError::UnknownId => "unknown_meeting",
            MeetingReadError::OutsideRoot => "meeting_outside_root",
            MeetingReadError::Missing => "meeting_missing",
            MeetingReadError::Oversized => "meeting_oversized",
            MeetingReadError::NotUtf8 => "meeting_not_utf8",
            MeetingReadError::Malformed => "meeting_malformed",
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            MeetingReadError::UnknownId => {
                "This id does not identify a Write That Down transcript."
            }
            MeetingReadError::OutsideRoot => {
                "This transcript is outside the configured notes folder."
            }
            MeetingReadError::Missing => "The transcript file is no longer there.",
            MeetingReadError::Oversized => "The transcript is larger than the 5 MiB safety limit.",
            MeetingReadError::NotUtf8 => "The transcript is not valid UTF-8 text.",
            MeetingReadError::Malformed => {
                "The transcript does not carry a readable Write That Down header."
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meetings::filesystem::tests::FakeFileSystem;

    const ROOT: &str = "/home/carlos/Transcripts";

    fn note(
        date: &str,
        _name: &str,
        title: &str,
        time: &str,
        duration: &str,
        body: &str,
    ) -> String {
        format!(
            "# {title}\n**Date:** {date} {time}\n**Duration:** {duration}\n\n## Transcript\n\n{body}\n"
        )
    }

    #[test]
    fn date_folder_names_must_be_real_calendar_dates() {
        assert!(is_date_folder_name("2026-09-10"));
        assert!(is_date_folder_name("2024-02-29"));
        assert!(!is_date_folder_name("2026-02-30"));
        assert!(!is_date_folder_name("2025-02-29"));
        assert!(!is_date_folder_name("2026-13-01"));
        assert!(!is_date_folder_name("2026-00-10"));
        assert!(!is_date_folder_name("2026-9-10"));
        assert!(!is_date_folder_name("notes"));
        assert!(!is_date_folder_name("2026-09-10 "));
    }

    #[test]
    fn finalized_provisional_and_collision_names_parse() {
        let saved = parse_transcript_filename("08-05_42min.md").unwrap();
        assert_eq!((saved.hour, saved.minute), (8, 5));
        assert_eq!(saved.duration_minutes, Some(42));

        let recording = parse_transcript_filename("23-59_recording_.md").unwrap();
        assert_eq!((recording.hour, recording.minute), (23, 59));
        assert_eq!(recording.duration_minutes, None);

        // Write That Down disambiguates a same-minute second meeting with a
        // numeric suffix instead of clobbering the first file.
        let collision = parse_transcript_filename("08-05_42min_2.md").unwrap();
        assert_eq!(collision.duration_minutes, Some(42));
    }

    #[test]
    fn unrelated_files_are_never_indexed() {
        for name in [
            "08-05_42min-summary.md",
            "08-05-summary.md",
            "notes.md",
            "08-05_42min.txt",
            "25-00_5min.md",
            "08-70_5min.md",
            "08-05_min.md",
            "08-05_42min_2_extra.md",
            "8-05_5min.md",
        ] {
            assert!(
                parse_transcript_filename(name).is_none(),
                "{name} must not be indexed"
            );
        }
    }

    #[test]
    fn header_is_cross_checked_against_folder_and_file_name() {
        let filename = parse_transcript_filename("08-05_42min.md").unwrap();
        let good = note(
            "2026-09-10",
            "08-05_42min.md",
            "Weekly sync",
            "08:05",
            "42 min",
            "[00:00] hello",
        );
        let parsed = parse_transcript_markdown(&good, "2026-09-10", filename).unwrap();
        assert_eq!(parsed.title, "Weekly sync");
        assert_eq!(parsed.started_at, "2026-09-10 08:05");
        assert_eq!(parsed.duration_minutes, Some(42));
        assert_eq!(parsed.excerpt, "[00:00] hello");

        // Wrong folder, wrong clock, missing heading, missing header.
        assert!(
            parse_transcript_markdown(&good, "2026-09-11", filename).is_none(),
            "date folder mismatch"
        );
        let wrong_time = note(
            "2026-09-10",
            "08-05_42min.md",
            "Weekly sync",
            "09:05",
            "42 min",
            "x",
        );
        assert!(parse_transcript_markdown(&wrong_time, "2026-09-10", filename).is_none());
        let no_heading = "# T\n**Date:** 2026-09-10 08:05\n**Duration:** 42 min\n\nbody\n";
        assert!(parse_transcript_markdown(no_heading, "2026-09-10", filename).is_none());
        assert!(parse_transcript_markdown("plain text", "2026-09-10", filename).is_none());
    }

    #[test]
    fn duration_header_must_match_the_file_name_status() {
        let recording_name = parse_transcript_filename("08-05_recording_.md").unwrap();
        let finalized_body = note(
            "2026-09-10",
            "08-05_recording_.md",
            "Live",
            "08:05",
            "42 min",
            "x",
        );
        assert!(parse_transcript_markdown(&finalized_body, "2026-09-10", recording_name).is_none());

        let saved_name = parse_transcript_filename("08-05_42min.md").unwrap();
        let live_body = note(
            "2026-09-10",
            "08-05_42min.md",
            "Live",
            "08:05",
            "recording…",
            "x",
        );
        assert!(parse_transcript_markdown(&live_body, "2026-09-10", saved_name).is_none());

        let mismatched = note(
            "2026-09-10",
            "08-05_42min.md",
            "Live",
            "08:05",
            "41 min",
            "x",
        );
        assert!(parse_transcript_markdown(&mismatched, "2026-09-10", saved_name).is_none());
    }

    #[test]
    fn crlf_headers_parse_like_lf() {
        let filename = parse_transcript_filename("08-05_42min.md").unwrap();
        let content = "# T\r\n**Date:** 2026-09-10 08:05\r\n**Duration:** 42 min\r\n\r\n## Transcript\r\n\r\nhi\r\n";
        assert!(parse_transcript_markdown(content, "2026-09-10", filename).is_some());
    }

    #[test]
    fn transcript_excerpt_is_the_body_and_is_bounded() {
        let long = "palabra ".repeat(200);
        let content = format!("# T\n## Transcript\n\n{long}");
        let excerpt = transcript_excerpt(&content);
        assert!(excerpt.starts_with("palabra palabra"));
        assert!(excerpt.chars().count() <= MAX_EXCERPT_CHARS + 1);
        // Multibyte input is cut on a char boundary, never mid-codepoint.
        let emoji = "🦀".repeat(1000);
        let excerpt = truncate_chars(&emoji, 10);
        assert_eq!(excerpt.chars().count(), 11);
    }

    #[test]
    fn discovery_is_newest_first_and_marks_unparseable_files() {
        let mut fs = FakeFileSystem::default();
        fs.insert_file(
            &format!("{ROOT}/2026-09-09/09-00_10min.md"),
            note(
                "2026-09-09",
                "09-00_10min.md",
                "Yesterday retro",
                "09:00",
                "10 min",
                "y",
            )
            .as_bytes(),
        );
        fs.insert_file(
            &format!("{ROOT}/2026-09-10/08-05_42min.md"),
            note(
                "2026-09-10",
                "08-05_42min.md",
                "Weekly sync",
                "08:05",
                "42 min",
                "x",
            )
            .as_bytes(),
        );
        fs.insert_file(
            &format!("{ROOT}/2026-09-10/15-30_recording_.md"),
            note(
                "2026-09-10",
                "15-30_recording_.md",
                "Design review",
                "15:30",
                "recording…",
                "live",
            )
            .as_bytes(),
        );
        fs.insert_file(
            &format!("{ROOT}/2026-09-10/16-00_5min.md"),
            b"# Broken\nno header at all\n",
        );
        fs.insert_file(
            &format!("{ROOT}/2026-09-10/notes-summary.md"),
            b"# Summary\n",
        );
        fs.insert_file(&format!("{ROOT}/README.md"), b"# not a date folder\n");

        let discovery = discover(&fs, Path::new(ROOT), 10, 10);
        assert_eq!(discovery.directory_state, DirectoryState::Readable);
        assert!(!discovery.scan_truncated);
        let titles: Vec<&str> = discovery
            .transcripts
            .iter()
            .map(|meeting| meeting.title.as_str())
            .collect();
        assert_eq!(
            titles,
            vec!["5min", "Design review", "Weekly sync", "Yesterday retro"]
        );
        // A file that fails to parse still gets the fork's fallback label
        // (the file name minus the clock prefix), so the owner can name the
        // exact file that failed instead of seeing a blank row.
        let broken = &discovery.transcripts[0];
        assert!(broken.is_failed());
        assert_eq!(broken.title, "5min");
        assert_eq!(
            broken.failure_reason,
            Some(TranscriptFailureReason::Malformed)
        );
        assert_eq!(broken.file_name, "16-00_5min.md");
        let live = &discovery.transcripts[1];
        assert_eq!(live.status, MeetingStatus::Recording);
        assert_eq!(live.duration_minutes, None);
        assert_eq!(live.started_at.as_deref(), Some("2026-09-10 15:30"));
        assert_eq!(live.relative_path, "2026-09-10/15-30_recording_.md");
        assert!(
            !discovery
                .transcripts
                .iter()
                .any(|meeting| meeting.file_name.contains("summary"))
        );
    }

    #[test]
    fn missing_and_unreadable_roots_are_never_reported_as_empty() {
        let mut fs = FakeFileSystem::default();
        let missing = discover(&fs, Path::new(ROOT), 10, 10);
        assert_eq!(missing.directory_state, DirectoryState::Missing);
        assert!(missing.transcripts.is_empty());

        fs.insert_dir(ROOT);
        let empty = discover(&fs, Path::new(ROOT), 10, 10);
        assert_eq!(empty.directory_state, DirectoryState::Readable);
        assert!(empty.transcripts.is_empty());

        fs.make_dir_unreadable(ROOT);
        let unreadable = discover(&fs, Path::new(ROOT), 10, 10);
        assert_eq!(unreadable.directory_state, DirectoryState::Unreadable);
        assert!(unreadable.transcripts.is_empty());
    }

    #[test]
    fn oversized_and_unreadable_files_are_named_failures() {
        let mut fs = FakeFileSystem::default();
        let huge = format!("{ROOT}/2026-09-10/08-00_5min.md");
        fs.insert_file(&huge, &vec![b'a'; (MAX_TRANSCRIPT_BYTES + 1) as usize]);
        let denied = format!("{ROOT}/2026-09-10/09-00_5min.md");
        fs.insert_file(&denied, b"# T\n");
        fs.make_file_unreadable(&denied);

        let discovery = discover(&fs, Path::new(ROOT), 10, 10);
        let by_name = |name: &str| {
            discovery
                .transcripts
                .iter()
                .find(|meeting| meeting.file_name == name)
                .expect("indexed failure")
        };
        assert_eq!(
            by_name("08-00_5min.md").failure_reason,
            Some(TranscriptFailureReason::Oversized)
        );
        assert_eq!(
            by_name("09-00_5min.md").failure_reason,
            Some(TranscriptFailureReason::Unreadable)
        );
        // A failed transcript still gets a readable fallback label from its
        // file name, so the owner can name what failed.
        assert_eq!(by_name("08-00_5min.md").title, "5min");
    }

    #[test]
    fn budget_stops_the_walk_newest_first_and_says_so() {
        let mut fs = FakeFileSystem::default();
        for day in 1..=5 {
            fs.insert_file(
                &format!("{ROOT}/2026-09-0{day}/08-00_5min.md"),
                note(
                    &format!("2026-09-0{day}"),
                    "08-00_5min.md",
                    &format!("Day {day}"),
                    "08:00",
                    "5 min",
                    "x",
                )
                .as_bytes(),
            );
        }
        let discovery = discover(&fs, Path::new(ROOT), 2, 10);
        assert!(discovery.scan_truncated);
        let dates: Vec<&str> = discovery
            .transcripts
            .iter()
            .map(|meeting| meeting.date_folder.as_str())
            .collect();
        assert_eq!(dates, vec!["2026-09-05", "2026-09-04"]);

        let by_files = discover(&fs, Path::new(ROOT), 10, 3);
        assert!(by_files.scan_truncated);
        assert_eq!(by_files.transcripts.len(), 3);
    }

    #[test]
    fn read_by_id_refuses_anything_outside_the_notes_directory() {
        let mut fs = FakeFileSystem::default();
        let good_path = format!("{ROOT}/2026-09-10/08-05_42min.md");
        fs.insert_file(
            &good_path,
            note(
                "2026-09-10",
                "08-05_42min.md",
                "Weekly sync",
                "08:05",
                "42 min",
                "hello",
            )
            .as_bytes(),
        );
        fs.insert_file("/home/carlos/.ssh/id_rsa", b"secret");
        fs.insert_file(
            "/home/carlos/Transcripts-evil/2026-09-10/08-05_42min.md",
            b"# X\n",
        );

        let meeting = read_by_id(&fs, Path::new(ROOT), &transcript_id(Path::new(&good_path)))
            .expect("valid transcript");
        assert_eq!(meeting.title, "Weekly sync");

        for bad in [
            "/home/carlos/.ssh/id_rsa",
            "/home/carlos/Transcripts-evil/2026-09-10/08-05_42min.md",
            "/home/carlos/Transcripts/../.ssh/id_rsa",
            "/home/carlos/Transcripts/2026-09-10/notes.md",
            "/home/carlos/Transcripts/nope/08-05_42min.md",
            "relative/path.md",
        ] {
            let id = format!("write-that-down:{bad}");
            assert!(
                read_by_id(&fs, Path::new(ROOT), &id).is_err(),
                "{bad} must not be readable"
            );
        }
        assert!(read_by_id(&fs, Path::new(ROOT), "not-a-transcript-id").is_err());
        assert!(read_by_id(&fs, Path::new(ROOT), "write-that-down:").is_err());
    }

    #[test]
    fn read_by_id_reports_gone_oversized_and_malformed_distinctly() {
        let mut fs = FakeFileSystem::default();
        fs.insert_dir(ROOT);
        let gone = format!("{ROOT}/2026-09-10/08-05_42min.md");
        assert_eq!(
            read_by_id(&fs, Path::new(ROOT), &transcript_id(Path::new(&gone))),
            Err(MeetingReadError::Missing)
        );

        let huge = format!("{ROOT}/2026-09-10/09-05_42min.md");
        fs.insert_file(&huge, &vec![b'a'; (MAX_TRANSCRIPT_BYTES + 1) as usize]);
        assert_eq!(
            read_by_id(&fs, Path::new(ROOT), &transcript_id(Path::new(&huge))),
            Err(MeetingReadError::Oversized)
        );

        let malformed = format!("{ROOT}/2026-09-10/10-05_42min.md");
        fs.insert_file(&malformed, b"# T\nnot a transcript\n");
        assert_eq!(
            read_by_id(&fs, Path::new(ROOT), &transcript_id(Path::new(&malformed))),
            Err(MeetingReadError::Malformed)
        );

        let binary = format!("{ROOT}/2026-09-10/11-05_42min.md");
        fs.insert_file(&binary, &[0xff, 0xfe, 0x00]);
        assert_eq!(
            read_by_id(&fs, Path::new(ROOT), &transcript_id(Path::new(&binary))),
            Err(MeetingReadError::NotUtf8)
        );
    }
}
