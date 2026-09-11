// MIT Copyright (c) 2026 Lovecast Inc.
//! Streaming full-text search over the indexed transcripts.
//!
//! A search cannot be answered from file names, so this is the one path that
//! opens note bodies — and it does so **one file at a time**, never holding
//! the corpus in memory: the walk hands over newest-first entries, each is
//! read inside its own 5 MiB transcript cap, matched, and dropped. Two budgets
//! make the cost of a query explicit instead of unbounded: the walk's own
//! file ceiling and a total-bytes ceiling ([`MAX_SEARCH_BYTES`]). When either
//! stops the scan the page says so and reports the match count as a lower
//! bound, rather than presenting a partial answer as a complete one.
//!
//! Only notes that parse as transcripts can match: a malformed or oversized
//! file is not text this index ever promised to search, and silently matching
//! raw bytes of a half-written note would be a worse answer than "not found
//! here, and the list says why".

use super::query::{MeetingFilters, match_lines};
use super::transcripts::{
    MAX_TRANSCRIPT_BYTES, MeetingStatus, MeetingTranscript, ScanEntry, Walk,
    parse_transcript_markdown,
};

/// Total bytes one search may read before it declares its answer partial.
/// Well above a real corpus (327 transcripts of ~100 KiB is ~33 MiB) and low
/// enough that a pathological notes directory cannot pin a core.
pub const MAX_SEARCH_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct SearchOutcome {
    /// The requested page of matching rows, newest first.
    pub rows: Vec<MeetingTranscript>,
    /// Matching transcripts found in the whole scan (a lower bound when
    /// `truncated`).
    pub matched: usize,
    /// Transcript files whose text was read.
    pub scanned: usize,
    pub bytes_scanned: u64,
    /// A budget stopped the scan, so `matched` is not the whole answer.
    pub truncated: bool,
}

/// A search entry is only ever a candidate when the filters that can be
/// decided from the file name alone accept it; that keeps a date- or
/// duration-filtered search from reading notes it already knows are out.
fn candidate(filters: &MeetingFilters, entry: &ScanEntry) -> bool {
    let status = if entry.filename.duration_minutes.is_some() {
        MeetingStatus::Saved
    } else {
        MeetingStatus::Recording
    };
    filters.matches_metadata(&entry.date_folder, status, entry.filename.duration_minutes)
}

pub fn search(
    file_system: &dyn super::filesystem::MeetingFileSystem,
    walk: &Walk,
    filters: &MeetingFilters,
    query: &str,
    limit: usize,
    offset: usize,
) -> SearchOutcome {
    let mut outcome = SearchOutcome {
        rows: Vec::new(),
        matched: 0,
        scanned: 0,
        bytes_scanned: 0,
        truncated: false,
    };
    let needle = query.to_lowercase();
    for entry in &walk.entries {
        if !candidate(filters, entry) {
            continue;
        }
        if outcome.bytes_scanned >= MAX_SEARCH_BYTES {
            outcome.truncated = true;
            break;
        }
        if entry.size > MAX_TRANSCRIPT_BYTES {
            continue;
        }
        let Ok(bytes) = file_system.read_file(&entry.path) else {
            continue;
        };
        outcome.scanned += 1;
        outcome.bytes_scanned += bytes.len() as u64;
        let Ok(content) = std::str::from_utf8(&bytes) else {
            continue;
        };
        // Cheap rejection before parsing: a note whose bytes never mention
        // the query cannot match, and skipping the parse keeps a search over
        // thousands of unrelated notes from paying for all of them.
        if !content.to_lowercase().contains(&needle) {
            continue;
        }
        let Some(parsed) = parse_transcript_markdown(content, &entry.date_folder, entry.filename)
        else {
            continue;
        };
        let (count, lines) = match_lines(content, &needle);
        if count == 0 {
            continue;
        }
        let index = outcome.matched;
        outcome.matched += 1;
        if index < offset || outcome.rows.len() >= limit {
            continue;
        }
        outcome.rows.push(super::transcripts::row_from_parts(
            entry,
            parsed,
            lines,
            u32::try_from(count).unwrap_or(u32::MAX),
        ));
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meetings::filesystem::tests::FakeFileSystem;
    use crate::meetings::transcripts::{MAX_TRANSCRIPTS_SCANNED, walk};
    use std::path::Path;

    const ROOT: &str = "/home/carlos/Transcripts";

    fn note(date: &str, title: &str, time: &str, duration: &str, body: &str) -> String {
        format!(
            "# {title}\n**Date:** {date} {time}\n**Duration:** {duration}\n\n## Transcript\n\n{body}\n"
        )
    }

    fn fixture() -> FakeFileSystem {
        let mut fs = FakeFileSystem::default();
        for (date, time, duration, title, body) in [
            (
                "2026-09-10",
                "08-00",
                "30 min",
                "Budget review",
                "[00:00] We agreed to ship the budget report.\n[01:00] Raul owns MR 142.",
            ),
            (
                "2026-09-09",
                "14-30",
                "90 min",
                "Design sync",
                "[00:00] The budget question came up again.\n",
            ),
            (
                "2026-09-08",
                "09-15",
                "10 min",
                "Standup",
                "[00:00] Nothing about money here.\n",
            ),
        ] {
            fs.insert_file(
                &format!(
                    "{ROOT}/{date}/{time}_{}.md",
                    duration.replace(" min", "min")
                ),
                note(date, title, &time.replace('-', ":"), duration, body).as_bytes(),
            );
        }
        // Not a transcript file name: never a search candidate.
        fs.insert_file(&format!("{ROOT}/2026-09-10/08-00-summary.md"), b"budget");
        fs
    }

    fn scan(fs: &FakeFileSystem) -> Walk {
        walk(fs, Path::new(ROOT), 64, MAX_TRANSCRIPTS_SCANNED)
    }

    #[test]
    fn search_is_case_insensitive_and_newest_first() {
        let fs = fixture();
        let filters = MeetingFilters::default();
        let outcome = search(&fs, &scan(&fs), &filters, "budget", 10, 0);
        assert_eq!(outcome.matched, 2);
        assert_eq!(outcome.rows.len(), 2);
        assert_eq!(outcome.rows[0].date_folder, "2026-09-10");
        assert_eq!(outcome.rows[1].date_folder, "2026-09-09");
        assert!(outcome.rows[0].searched);
        assert_eq!(outcome.rows[0].matches.len(), 2);
        assert!(!outcome.truncated);
    }

    #[test]
    fn a_match_reports_the_transcript_line_it_came_from() {
        let fs = fixture();
        let filters = MeetingFilters::default();
        let outcome = search(&fs, &scan(&fs), &filters, "budget", 10, 0);
        // The note's own title counts: the title is text the owner can search.
        assert_eq!(outcome.rows[0].match_count, 2);
        assert_eq!(outcome.rows[0].matches[0].line, 1);
        assert_eq!(outcome.rows[0].matches[0].text, "# Budget review");
        assert_eq!(outcome.rows[0].matches[1].line, 7);
    }

    #[test]
    fn date_and_duration_filters_apply_before_the_bodies_are_read() {
        let fs = fixture();
        let filters = MeetingFilters {
            from: Some("2026-09-09".into()),
            ..MeetingFilters::default()
        }
        .validated()
        .unwrap();
        let outcome = search(&fs, &scan(&fs), &filters, "budget", 10, 0);
        assert_eq!(outcome.matched, 2);

        let filters = MeetingFilters {
            to: Some("2026-09-09".into()),
            ..MeetingFilters::default()
        }
        .validated()
        .unwrap();
        let outcome = search(&fs, &scan(&fs), &filters, "budget", 10, 0);
        assert_eq!(outcome.matched, 1);
        assert_eq!(outcome.rows[0].date_folder, "2026-09-09");

        let filters = MeetingFilters {
            max_minutes: Some(30),
            ..MeetingFilters::default()
        }
        .validated()
        .unwrap();
        let outcome = search(&fs, &scan(&fs), &filters, "budget", 10, 0);
        assert_eq!(outcome.matched, 1);
        assert_eq!(outcome.rows[0].duration_minutes, Some(30));
    }

    #[test]
    fn paging_returns_the_window_without_keeping_the_rest() {
        let fs = fixture();
        let filters = MeetingFilters::default();
        let first = search(&fs, &scan(&fs), &filters, "the", 1, 0);
        assert_eq!(first.matched, 2);
        assert_eq!(first.rows.len(), 1);
        assert_eq!(first.rows[0].date_folder, "2026-09-10");
        let second = search(&fs, &scan(&fs), &filters, "the", 1, 1);
        assert_eq!(second.matched, 2);
        assert_eq!(second.rows.len(), 1);
        assert_eq!(second.rows[0].date_folder, "2026-09-09");
        let past_end = search(&fs, &scan(&fs), &filters, "the", 1, 9);
        assert_eq!(past_end.matched, 2);
        assert!(past_end.rows.is_empty());
    }

    #[test]
    fn a_query_never_matches_a_file_that_is_not_a_transcript() {
        let fs = fixture();
        let filters = MeetingFilters::default();
        // `08-00-summary.md` contains "budget" but is not a transcript, and
        // the notes it would be confused with are already counted.
        let outcome = search(&fs, &scan(&fs), &filters, "budget", 10, 0);
        assert_eq!(outcome.matched, 2);
    }

    #[test]
    fn a_failed_transcript_never_matches_a_search() {
        let mut fs = fixture();
        fs.insert_file(
            &format!("{ROOT}/2026-09-11/07-00_5min.md"),
            b"budget budget budget but no header\n",
        );
        let outcome = search(&fs, &scan(&fs), &MeetingFilters::default(), "budget", 10, 0);
        assert_eq!(outcome.matched, 2);
    }
}
