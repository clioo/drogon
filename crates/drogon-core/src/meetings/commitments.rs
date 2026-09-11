// MIT Copyright (c) 2026 Lovecast Inc.
//! The commitment ledger: what the owner accepted out of a meeting.
//!
//! Extraction produces *suggestions*; nothing becomes tracked work until the
//! owner accepts one. This module is that acceptance step's storage, and three
//! properties matter more than the shape:
//!
//! 1. **It is Drogon's own file, never the notes.** The ledger lives at
//!    `<data-dir>/meeting-commitments.json` and is written with an atomic
//!    temp-plus-rename. The notes directory is only ever read, and a
//!    commitment stores the *quote and its line number* so the claim can
//!    always be checked against the transcript it came from.
//! 2. **A commitment without a findable quote cannot be stored.** Creating
//!    one re-reads the note and verifies the quote with the same rule the
//!    analysis uses, so a ledger entry can never be a claim the transcript
//!    does not support — including when the owner types it himself, which is
//!    the case most likely to drift from what the meeting actually said.
//! 3. **Across the corpus, not per meeting.** The point of 327 transcripts is
//!    that a promise made in March and never closed is visible in September,
//!    so the ledger is queried as a whole (`status`, free text) and every row
//!    keeps the meeting title and date it came from.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::analysis::{MIN_QUOTE_CHARS, verify_quote};
use super::transcripts::{MeetingTranscript, read_by_id};

/// The ledger file, beside the other Drogon-owned state in the data dir.
pub const COMMITMENTS_FILE: &str = "meeting-commitments.json";
/// Schema version of the ledger file.
pub const COMMITMENTS_VERSION: u32 = 1;
/// How many commitments the ledger holds. Well past any real corpus of
/// accepted actions, and low enough that the file stays a file.
pub const MAX_COMMITMENTS: usize = 10_000;
pub const MAX_COMMITMENT_TEXT_CHARS: usize = 500;
pub const MAX_OWNER_CHARS: usize = 120;
/// Largest ledger file this build will read back (a corrupt or hostile file
/// must not be loaded into memory).
pub const MAX_LEDGER_BYTES: u64 = 8 * 1024 * 1024;
pub const DEFAULT_COMMITMENT_PAGE: u32 = 50;
pub const MAX_COMMITMENT_PAGE: u32 = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommitmentStatus {
    Open,
    Done,
    Dismissed,
}

impl CommitmentStatus {
    pub fn as_wire(self) -> &'static str {
        match self {
            CommitmentStatus::Open => "open",
            CommitmentStatus::Done => "done",
            CommitmentStatus::Dismissed => "dismissed",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "open" => Some(CommitmentStatus::Open),
            "done" => Some(CommitmentStatus::Done),
            "dismissed" => Some(CommitmentStatus::Dismissed),
            _ => None,
        }
    }

    pub fn is_open(self) -> bool {
        self == CommitmentStatus::Open
    }
}

/// Where the commitment came from. `Suggested` records that the local model
/// proposed it and the owner accepted the suggestion; `Owner` records that he
/// wrote it himself. The distinction is kept because "the model said so" and
/// "I said so" must never be conflated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommitmentSource {
    Suggested,
    Owner,
}

impl CommitmentSource {
    pub fn as_wire(self) -> &'static str {
        match self {
            CommitmentSource::Suggested => "suggested",
            CommitmentSource::Owner => "owner",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "suggested" => Some(CommitmentSource::Suggested),
            "owner" => Some(CommitmentSource::Owner),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Commitment {
    pub id: String,
    pub meeting_id: String,
    pub relative_path: String,
    pub meeting_title: String,
    pub meeting_date: String,
    pub text: String,
    pub owner: Option<String>,
    /// The transcript line that supports it, verbatim.
    pub quote: String,
    pub line: u32,
    pub source: CommitmentSource,
    /// `high` or `low`, carried over from the suggestion.
    pub confidence: String,
    pub status: CommitmentStatus,
    pub created_at: String,
    pub updated_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommitmentError {
    /// The quote is not in the note (or is too short to be evidence).
    QuoteNotFound,
    /// The note id does not resolve to a transcript in the configured folder.
    UnknownMeeting,
    EmptyText,
    TextTooLong,
    OwnerTooLong,
    UnknownStatus,
    UnknownSource,
    UnknownId,
    Full,
    Storage,
}

impl CommitmentError {
    pub fn as_wire(self) -> &'static str {
        match self {
            CommitmentError::QuoteNotFound => "commitment_quote_not_found",
            CommitmentError::UnknownMeeting => "commitment_unknown_meeting",
            CommitmentError::EmptyText => "commitment_empty_text",
            CommitmentError::TextTooLong => "commitment_text_too_long",
            CommitmentError::OwnerTooLong => "commitment_owner_too_long",
            CommitmentError::UnknownStatus => "commitment_unknown_status",
            CommitmentError::UnknownSource => "commitment_unknown_source",
            CommitmentError::UnknownId => "commitment_unknown_id",
            CommitmentError::Full => "commitment_ledger_full",
            CommitmentError::Storage => "commitment_storage_failed",
        }
    }

    pub fn message(self) -> String {
        match self {
            CommitmentError::QuoteNotFound => format!(
                "This commitment's quote ({MIN_QUOTE_CHARS} characters or more) is not in the \
                 transcript, so it was NOT recorded. Nothing was written to the note."
            ),
            CommitmentError::UnknownMeeting => {
                "That meeting id does not resolve to a transcript in the configured notes folder."
                    .to_string()
            }
            CommitmentError::EmptyText => "A commitment needs some text.".to_string(),
            CommitmentError::TextTooLong => {
                format!("A commitment is limited to {MAX_COMMITMENT_TEXT_CHARS} characters.")
            }
            CommitmentError::OwnerTooLong => {
                format!("An owner name is limited to {MAX_OWNER_CHARS} characters.")
            }
            CommitmentError::UnknownStatus => {
                "A status must be one of: open, done, dismissed.".to_string()
            }
            CommitmentError::UnknownSource => {
                "A source must be one of: suggested, owner.".to_string()
            }
            CommitmentError::UnknownId => "No such commitment.".to_string(),
            CommitmentError::Full => format!(
                "This ledger is full ({MAX_COMMITMENTS} commitments). Resolve or dismiss some \
                 before adding more."
            ),
            CommitmentError::Storage => {
                "The commitment ledger could not be written. Nothing was changed.".to_string()
            }
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LedgerFile {
    version: u32,
    commitments: Vec<Commitment>,
}

/// One page of the ledger, newest first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitmentPage {
    pub commitments: Vec<Commitment>,
    /// Everything matching the filter (not just this page).
    pub total: usize,
    /// Open commitments matching the filter — the number the owner actually
    /// cares about when scanning for what is still outstanding.
    pub open: usize,
    pub offset: u32,
    pub limit: u32,
    pub has_more: bool,
}

#[derive(Debug, Clone, Default)]
pub struct CommitmentFilter {
    pub status: Option<CommitmentStatus>,
    pub open_only: bool,
    pub query: Option<String>,
}

impl CommitmentFilter {
    fn matches(&self, commitment: &Commitment) -> bool {
        if let Some(status) = self.status
            && commitment.status != status
        {
            return false;
        }
        if self.open_only && !commitment.status.is_open() {
            return false;
        }
        let Some(query) = &self.query else {
            return true;
        };
        let needle = query.to_lowercase();
        [
            commitment.text.as_str(),
            commitment.quote.as_str(),
            commitment.meeting_title.as_str(),
            commitment.meeting_date.as_str(),
            commitment.owner.as_deref().unwrap_or(""),
        ]
        .iter()
        .any(|field| field.to_lowercase().contains(&needle))
    }
}

/// The ledger, on disk. Nothing here ever touches the notes folder: the only
/// path it writes is [`COMMITMENTS_FILE`] under the data dir.
#[derive(Debug)]
pub struct CommitmentStore {
    path: PathBuf,
    lock: Mutex<()>,
}

impl CommitmentStore {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join(COMMITMENTS_FILE),
            lock: Mutex::new(()),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn read(&self) -> Result<LedgerFile, CommitmentError> {
        let metadata = match std::fs::metadata(&self.path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(LedgerFile {
                    version: COMMITMENTS_VERSION,
                    commitments: Vec::new(),
                });
            }
            Err(_) => return Err(CommitmentError::Storage),
        };
        if metadata.len() > MAX_LEDGER_BYTES {
            return Err(CommitmentError::Storage);
        }
        let bytes = std::fs::read(&self.path).map_err(|_| CommitmentError::Storage)?;
        let parsed: LedgerFile =
            serde_json::from_slice(&bytes).map_err(|_| CommitmentError::Storage)?;
        Ok(parsed)
    }

    /// Atomic: the whole ledger is written to a sibling temp file and renamed
    /// over the target, so a crash can never leave a half-written ledger.
    fn write(&self, ledger: &LedgerFile) -> Result<(), CommitmentError> {
        let bytes = serde_json::to_vec_pretty(ledger).map_err(|_| CommitmentError::Storage)?;
        let temp = self.path.with_extension("json.tmp");
        std::fs::write(&temp, &bytes).map_err(|_| CommitmentError::Storage)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let _ = std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(0o600));
        }
        std::fs::rename(&temp, &self.path).map_err(|_| CommitmentError::Storage)
    }

    pub fn list(
        &self,
        filter: &CommitmentFilter,
        limit: u32,
        offset: u32,
    ) -> Result<CommitmentPage, CommitmentError> {
        let limit = if limit == 0 {
            DEFAULT_COMMITMENT_PAGE
        } else {
            limit
        };
        if limit > MAX_COMMITMENT_PAGE {
            return Err(CommitmentError::UnknownStatus);
        }
        let _guard = self.lock.lock().map_err(|_| CommitmentError::Storage)?;
        let ledger = self.read()?;
        let matching: Vec<Commitment> = ledger
            .commitments
            .into_iter()
            .filter(|commitment| filter.matches(commitment))
            .collect();
        // Newest first by the meeting's own date, then by creation, so the
        // ledger reads like the transcript list does.
        let mut matching = matching;
        matching.sort_by(|left, right| {
            right
                .meeting_date
                .cmp(&left.meeting_date)
                .then_with(|| right.created_at.cmp(&left.created_at))
                .then_with(|| right.id.cmp(&left.id))
        });
        let open = matching
            .iter()
            .filter(|commitment| commitment.status.is_open())
            .count();
        let total = matching.len();
        let start = (offset as usize).min(total);
        let end = start.saturating_add(limit as usize).min(total);
        Ok(CommitmentPage {
            commitments: matching[start..end].to_vec(),
            total,
            open,
            offset,
            limit,
            has_more: end < total,
        })
    }

    /// Records an accepted commitment. The quote is verified against the note
    /// *before* anything is stored; `meeting` is the note the caller already
    /// resolved, and `content` its bytes.
    #[allow(clippy::too_many_arguments)]
    pub fn create(
        &self,
        meeting: &MeetingTranscript,
        content: &str,
        text: &str,
        owner: Option<&str>,
        quote: &str,
        source: CommitmentSource,
        confidence: &str,
    ) -> Result<Commitment, CommitmentError> {
        let text = text.trim();
        if text.is_empty() {
            return Err(CommitmentError::EmptyText);
        }
        if text.chars().count() > MAX_COMMITMENT_TEXT_CHARS {
            return Err(CommitmentError::TextTooLong);
        }
        let owner = owner.map(str::trim).filter(|value| !value.is_empty());
        if owner.is_some_and(|value| value.chars().count() > MAX_OWNER_CHARS) {
            return Err(CommitmentError::OwnerTooLong);
        }
        let Some((line, verbatim)) = verify_quote(content, quote) else {
            return Err(CommitmentError::QuoteNotFound);
        };
        let _guard = self.lock.lock().map_err(|_| CommitmentError::Storage)?;
        let mut ledger = self.read()?;
        // Accepting the same suggestion twice is a no-op, not a duplicate.
        if let Some(existing) = ledger.commitments.iter().find(|commitment| {
            commitment.meeting_id == meeting.id
                && commitment.status.is_open()
                && commitment.text.eq_ignore_ascii_case(text)
        }) {
            return Ok(existing.clone());
        }
        if ledger.commitments.len() >= MAX_COMMITMENTS {
            return Err(CommitmentError::Full);
        }
        let now = crate::now_rfc3339();
        let commitment = Commitment {
            id: format!("commitment-{}", uuid::Uuid::new_v4()),
            meeting_id: meeting.id.clone(),
            relative_path: meeting.relative_path.clone(),
            meeting_title: meeting.title.clone(),
            meeting_date: meeting.date_folder.clone(),
            text: text.to_string(),
            owner: owner.map(str::to_string),
            quote: verbatim,
            line,
            source,
            confidence: if confidence == "high" { "high" } else { "low" }.to_string(),
            status: CommitmentStatus::Open,
            created_at: now.clone(),
            updated_at: now,
            resolved_at: None,
        };
        ledger.version = COMMITMENTS_VERSION;
        ledger.commitments.push(commitment.clone());
        self.write(&ledger)?;
        Ok(commitment)
    }

    pub fn set_status(
        &self,
        id: &str,
        status: CommitmentStatus,
    ) -> Result<Commitment, CommitmentError> {
        let _guard = self.lock.lock().map_err(|_| CommitmentError::Storage)?;
        let mut ledger = self.read()?;
        let now = crate::now_rfc3339();
        let Some(commitment) = ledger
            .commitments
            .iter_mut()
            .find(|commitment| commitment.id == id)
        else {
            return Err(CommitmentError::UnknownId);
        };
        commitment.status = status;
        commitment.updated_at = now.clone();
        commitment.resolved_at = if status.is_open() { None } else { Some(now) };
        let updated = commitment.clone();
        self.write(&ledger)?;
        Ok(updated)
    }
}

/// Resolves the note a commitment is being recorded against, so the ledger
/// and the index always agree on which file is meant, and re-reads its bytes
/// for quote verification.
pub fn note_for_commitment(
    file_system: &dyn super::MeetingFileSystem,
    root: &Path,
    meeting_id: &str,
) -> Result<(MeetingTranscript, String), CommitmentError> {
    let meeting =
        read_by_id(file_system, root, meeting_id).map_err(|_| CommitmentError::UnknownMeeting)?;
    if meeting.status == super::MeetingStatus::Failed {
        return Err(CommitmentError::UnknownMeeting);
    }
    let bytes = file_system
        .read_file(Path::new(&meeting.file_path))
        .map_err(|_| CommitmentError::UnknownMeeting)?;
    let content = String::from_utf8(bytes).map_err(|_| CommitmentError::UnknownMeeting)?;
    Ok((meeting, content))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meetings::filesystem::tests::FakeFileSystem;
    use crate::meetings::transcript_id;

    const ROOT: &str = "/home/carlos/Transcripts";
    const NOTE: &str = "/home/carlos/Transcripts/2026-09-10/08-00_30min.md";
    const BODY: &str = "# Weekly sync\n**Date:** 2026-09-10 08:00\n**Duration:** 30 min\n\n## Transcript\n\n[00:00] We agreed to ship the budget report on Friday.\n[00:12] I will fix the flaky login test before the release.\n[00:20] Raul owns MR 142.\n";

    fn fixture() -> FakeFileSystem {
        let mut fs = FakeFileSystem::default();
        fs.insert_file(NOTE, BODY.as_bytes());
        fs.insert_file(
            "/home/carlos/Transcripts/2026-09-08/09-00_10min.md",
            b"# Standup\n**Date:** 2026-09-08 09:00\n**Duration:** 10 min\n\n## Transcript\n\n[00:00] I will write the migration notes.\n",
        );
        fs
    }

    fn meeting(id: &str, fs: &FakeFileSystem) -> (MeetingTranscript, String) {
        note_for_commitment(fs, Path::new(ROOT), id).expect("note resolves")
    }

    fn store() -> (tempfile::TempDir, CommitmentStore) {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = CommitmentStore::new(dir.path());
        (dir, store)
    }

    #[test]
    fn an_accepted_suggestion_is_stored_with_its_verified_quote() {
        let fs = fixture();
        let (_dir, store) = store();
        let id = transcript_id(Path::new(NOTE));
        let (note, content) = meeting(&id, &fs);
        let stored = store
            .create(
                &note,
                &content,
                "Fix the flaky login test",
                Some("Carlos"),
                "I will fix the flaky login test before the release",
                CommitmentSource::Suggested,
                "high",
            )
            .expect("quote is in the note");
        assert_eq!(stored.line, 8);
        assert_eq!(stored.status, CommitmentStatus::Open);
        assert_eq!(stored.source, CommitmentSource::Suggested);
        assert!(stored.quote.starts_with("[00:12]"));

        // Accepting the same suggestion again is idempotent.
        let again = store
            .create(
                &note,
                &content,
                "Fix the flaky login test",
                Some("Carlos"),
                "I will fix the flaky login test before the release",
                CommitmentSource::Suggested,
                "high",
            )
            .unwrap();
        assert_eq!(again.id, stored.id);
        assert_eq!(
            store
                .list(&CommitmentFilter::default(), 50, 0)
                .unwrap()
                .total,
            1
        );
    }

    #[test]
    fn a_commitment_the_transcript_does_not_support_is_refused() {
        let fs = fixture();
        let (dir, store) = store();
        let id = transcript_id(Path::new(NOTE));
        let (note, content) = meeting(&id, &fs);
        let failure = store
            .create(
                &note,
                &content,
                "Migrate the database tonight",
                None,
                "I will migrate the database tonight",
                CommitmentSource::Owner,
                "low",
            )
            .expect_err("an unsupported claim must not be stored");
        assert_eq!(failure, CommitmentError::QuoteNotFound);
        assert!(failure.message().contains("NOT recorded"));
        // Nothing was written, not even an empty ledger.
        assert!(!dir.path().join(COMMITMENTS_FILE).exists());
        // And a quote too short to be evidence is refused the same way.
        assert_eq!(
            store
                .create(
                    &note,
                    &content,
                    "MR 142",
                    None,
                    "MR 142",
                    CommitmentSource::Owner,
                    "low",
                )
                .unwrap_err(),
            CommitmentError::QuoteNotFound
        );
    }

    #[test]
    fn the_ledger_is_queryable_across_the_whole_corpus() {
        let fs = fixture();
        let (dir, store) = store();
        let first = transcript_id(Path::new(NOTE));
        let second = transcript_id(Path::new(
            "/home/carlos/Transcripts/2026-09-08/09-00_10min.md",
        ));
        let (note, content) = meeting(&first, &fs);
        let a = store
            .create(
                &note,
                &content,
                "Fix the flaky login test",
                Some("Carlos"),
                "I will fix the flaky login test before the release",
                CommitmentSource::Suggested,
                "high",
            )
            .unwrap();
        let (note, content) = meeting(&second, &fs);
        let b = store
            .create(
                &note,
                &content,
                "Write the migration notes",
                None,
                "I will write the migration notes",
                CommitmentSource::Owner,
                "low",
            )
            .unwrap();

        let page = store.list(&CommitmentFilter::default(), 50, 0).unwrap();
        assert_eq!(page.total, 2);
        assert_eq!(page.open, 2);
        // Newest meeting first.
        assert_eq!(page.commitments[0].id, a.id);
        assert_eq!(page.commitments[0].meeting_title, "Weekly sync");

        store.set_status(&a.id, CommitmentStatus::Done).unwrap();
        let open = store
            .list(
                &CommitmentFilter {
                    status: Some(CommitmentStatus::Open),
                    ..CommitmentFilter::default()
                },
                50,
                0,
            )
            .unwrap();
        assert_eq!(open.total, 1);
        assert_eq!(open.open, 1);
        assert_eq!(open.commitments[0].id, b.id);

        let searched = store
            .list(
                &CommitmentFilter {
                    query: Some("MIGRATION".into()),
                    ..CommitmentFilter::default()
                },
                50,
                0,
            )
            .unwrap();
        assert_eq!(searched.total, 1);
        assert_eq!(searched.commitments[0].id, b.id);

        let done = store
            .list(
                &CommitmentFilter {
                    status: Some(CommitmentStatus::Done),
                    ..CommitmentFilter::default()
                },
                50,
                0,
            )
            .unwrap();
        assert_eq!(done.total, 1);
        assert!(done.commitments[0].resolved_at.is_some());

        assert_eq!(
            store
                .set_status("commitment-nope", CommitmentStatus::Done)
                .unwrap_err(),
            CommitmentError::UnknownId
        );

        // Paging never invents rows.
        let page = store.list(&CommitmentFilter::default(), 1, 1).unwrap();
        assert_eq!(page.total, 2);
        assert_eq!(page.commitments.len(), 1);
        assert!(!page.has_more);
        let past = store.list(&CommitmentFilter::default(), 1, 9).unwrap();
        assert!(past.commitments.is_empty());

        // The ledger survives a fresh store instance (it is on disk).
        let reopened = CommitmentStore::new(dir.path());
        assert_eq!(
            reopened
                .list(&CommitmentFilter::default(), 50, 0)
                .unwrap()
                .total,
            2
        );
    }

    #[test]
    fn the_ledger_never_writes_to_the_notes_folder() {
        let dir = tempfile::tempdir().expect("temp dir");
        let home = dir.path().join("home");
        let notes = home.join("Transcripts/2026-09-10");
        std::fs::create_dir_all(&notes).expect("notes folder");
        let note_path = notes.join("08-00_30min.md");
        std::fs::write(&note_path, BODY).expect("note");
        let before = fingerprint(&home.join("Transcripts"));

        let store = CommitmentStore::new(dir.path());
        let real = crate::meetings::RealMeetingFileSystem;
        let id = transcript_id(&note_path);
        let (note, content) = note_for_commitment(&real, &home.join("Transcripts"), &id).unwrap();
        let stored = store
            .create(
                &note,
                &content,
                "Ship the budget report",
                None,
                "We agreed to ship the budget report on Friday",
                CommitmentSource::Owner,
                "high",
            )
            .unwrap();
        store
            .set_status(&stored.id, CommitmentStatus::Done)
            .unwrap();
        store.list(&CommitmentFilter::default(), 50, 0).unwrap();

        assert_eq!(fingerprint(&home.join("Transcripts")), before);
        assert!(dir.path().join(COMMITMENTS_FILE).exists());
        // The ledger is private to the user.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = std::fs::metadata(dir.path().join(COMMITMENTS_FILE))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600, "the ledger is the owner's own state");
        }
    }

    #[test]
    fn a_corrupt_or_oversized_ledger_is_reported_not_guessed_at() {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = CommitmentStore::new(dir.path());
        std::fs::write(dir.path().join(COMMITMENTS_FILE), b"{not json").unwrap();
        assert_eq!(
            store.list(&CommitmentFilter::default(), 50, 0).unwrap_err(),
            CommitmentError::Storage
        );
        std::fs::write(
            dir.path().join(COMMITMENTS_FILE),
            vec![b'0'; (MAX_LEDGER_BYTES + 1) as usize],
        )
        .unwrap();
        assert_eq!(
            store.list(&CommitmentFilter::default(), 50, 0).unwrap_err(),
            CommitmentError::Storage
        );
    }

    fn fingerprint(dir: &Path) -> Vec<String> {
        let mut out = Vec::new();
        let mut stack = vec![dir.to_path_buf()];
        while let Some(current) = stack.pop() {
            for entry in std::fs::read_dir(&current).expect("readable") {
                let entry = entry.expect("entry");
                let meta = entry.metadata().expect("metadata");
                out.push(format!(
                    "{}:{}:{}",
                    entry.path().display(),
                    meta.len(),
                    meta.is_dir()
                ));
                if meta.is_dir() {
                    stack.push(entry.path());
                }
            }
        }
        out.sort();
        out
    }
}
