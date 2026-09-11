// MIT Copyright (c) 2026 Lovecast Inc.
//! Search and filtering for the Meetings section.
//!
//! 327 transcripts make a reverse-chronological list nearly useless on its
//! own, so the index is queryable: a case-insensitive full-text search plus a
//! date range and a duration range. Everything here is pure — the filesystem
//! walk that feeds it lives in [`super::transcripts`] — so the filter rules
//! are testable without touching disk, and the honest edges (an empty query,
//! a reversed date range, a duration filter that can never match a recording)
//! are decisions rather than surprises.

use serde::Serialize;

use super::transcripts::{MeetingStatus, MeetingTranscript, is_date_folder_name};

/// Longest admitted search string, in characters. A query is matched with
/// `contains`, so an unbounded one is a denial-of-service vector for no gain.
pub const MAX_QUERY_CHARS: usize = 200;
/// How many matching lines a row carries back. The row renders the transcript
/// line the match came from so the owner can check it; three is enough to
/// judge relevance without turning the row into the transcript.
pub const MAX_MATCH_LINES: usize = 3;
/// Characters kept from a matching line.
pub const MAX_MATCH_LINE_CHARS: usize = 240;
/// Upper bound on either end of the duration range, in minutes (a month).
pub const MAX_DURATION_FILTER_MINUTES: u32 = 44_640;

/// One transcript line a search matched, with its 1-based number in the file
/// so the reader can jump to it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingMatchLine {
    pub line: u32,
    pub text: String,
}

/// The filters a list request may carry. Every field is optional; the empty
/// value is "no filter", never "match nothing".
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MeetingFilters {
    pub text: Option<String>,
    /// Inclusive `YYYY-MM-DD` lower bound on the note's own date folder.
    pub from: Option<String>,
    /// Inclusive `YYYY-MM-DD` upper bound.
    pub to: Option<String>,
    pub min_minutes: Option<u32>,
    pub max_minutes: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeetingFilterError {
    QueryTooLong,
    EmptyQuery,
    From,
    To,
    DateRange,
    MinMinutes,
    MaxMinutes,
    DurationRange,
}

impl MeetingFilterError {
    pub fn message(self) -> &'static str {
        match self {
            MeetingFilterError::QueryTooLong => "A search query is limited to 200 characters.",
            MeetingFilterError::EmptyQuery => {
                "A search query must contain at least one non-space character."
            }
            MeetingFilterError::From => "The start of the date range must be a YYYY-MM-DD date.",
            MeetingFilterError::To => "The end of the date range must be a YYYY-MM-DD date.",
            MeetingFilterError::DateRange => {
                "The start of the date range must not be after the end."
            }
            MeetingFilterError::MinMinutes => {
                "The shortest duration must be a number of minutes up to 44640."
            }
            MeetingFilterError::MaxMinutes => {
                "The longest duration must be a number of minutes up to 44640."
            }
            MeetingFilterError::DurationRange => {
                "The shortest duration must not be longer than the longest."
            }
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            MeetingFilterError::From
            | MeetingFilterError::To
            | MeetingFilterError::DateRange
            | MeetingFilterError::MinMinutes
            | MeetingFilterError::MaxMinutes
            | MeetingFilterError::DurationRange => "invalid_argument",
            MeetingFilterError::QueryTooLong | MeetingFilterError::EmptyQuery => "invalid_argument",
        }
    }
}

impl MeetingFilters {
    /// Validates the filter set and normalizes the query (trimmed, empty
    /// means "no text search" rather than "match nothing" — but a query that
    /// is *present and blank* is refused, so the caller learns the difference
    /// between "I did not search" and "I searched for spaces").
    pub fn validated(mut self) -> Result<Self, MeetingFilterError> {
        let text = match self.text.take() {
            None => None,
            Some(raw) => {
                let trimmed = raw.trim();
                if trimmed.is_empty() {
                    // An all-whitespace query is the same instruction as no
                    // query at all; treating it as one keeps a stray space
                    // from rendering "0 of 327".
                    return Err(MeetingFilterError::EmptyQuery);
                }
                if trimmed.chars().count() > MAX_QUERY_CHARS {
                    return Err(MeetingFilterError::QueryTooLong);
                }
                Some(trimmed.to_lowercase())
            }
        };
        if let Some(from) = &self.from
            && !is_date_folder_name(from)
        {
            return Err(MeetingFilterError::From);
        }
        if let Some(to) = &self.to
            && !is_date_folder_name(to)
        {
            return Err(MeetingFilterError::To);
        }
        if let (Some(from), Some(to)) = (&self.from, &self.to)
            && from > to
        {
            return Err(MeetingFilterError::DateRange);
        }
        if self
            .min_minutes
            .is_some_and(|minutes| minutes > MAX_DURATION_FILTER_MINUTES)
        {
            return Err(MeetingFilterError::MinMinutes);
        }
        if self
            .max_minutes
            .is_some_and(|minutes| minutes > MAX_DURATION_FILTER_MINUTES)
        {
            return Err(MeetingFilterError::MaxMinutes);
        }
        if let (Some(min), Some(max)) = (self.min_minutes, self.max_minutes)
            && min > max
        {
            return Err(MeetingFilterError::DurationRange);
        }
        self.text = text;
        Ok(self)
    }

    pub fn is_empty(&self) -> bool {
        self.text.is_none()
            && self.from.is_none()
            && self.to.is_none()
            && self.min_minutes.is_none()
            && self.max_minutes.is_none()
    }

    /// True when the filters can be decided from a row's own metadata (date
    /// folder, file name, duration) without reading the note's text. The
    /// list path uses this to avoid reading 327 files it will not page in.
    pub fn is_metadata_only(&self) -> bool {
        self.text.is_none()
    }

    /// Whether this row satisfies the date and duration filters. `status` is
    /// part of the answer because a `recording` or `failed` row has no
    /// duration at all, and a duration filter must not silently treat
    /// "unknown" as "short".
    pub fn matches_metadata(
        &self,
        date_folder: &str,
        status: MeetingStatus,
        duration_minutes: Option<u32>,
    ) -> bool {
        if let Some(from) = &self.from
            && date_folder < from.as_str()
        {
            return false;
        }
        if let Some(to) = &self.to
            && date_folder > to.as_str()
        {
            return false;
        }
        if self.min_minutes.is_none() && self.max_minutes.is_none() {
            return true;
        }
        // A duration filter can only be satisfied by a finalized transcript:
        // a still-recording note and a failed one have no duration, and
        // guessing one would be the exact dishonesty this page refuses.
        if status != MeetingStatus::Saved {
            return false;
        }
        let Some(minutes) = duration_minutes else {
            return false;
        };
        self.min_minutes.is_none_or(|min| minutes >= min)
            && self.max_minutes.is_none_or(|max| minutes <= max)
    }

    /// Whether a row satisfies the metadata filters, reading the duration and
    /// status off the row.
    pub fn matches_row(&self, row: &MeetingTranscript) -> bool {
        self.matches_metadata(&row.date_folder, row.status, row.duration_minutes)
    }
}

/// Case-insensitive occurrence count plus the first [`MAX_MATCH_LINES`]
/// matching lines with their 1-based numbers. The count is over the whole
/// document (not capped), so "12 matches" is true rather than "3 matches".
pub fn match_lines(content: &str, query: &str) -> (usize, Vec<MeetingMatchLine>) {
    if query.is_empty() {
        return (0, Vec::new());
    }
    let needle = query.to_lowercase();
    let mut count = 0usize;
    let mut lines = Vec::new();
    for (index, raw) in content.split('\n').enumerate() {
        let line = raw.trim_end_matches('\r');
        let haystack = line.to_lowercase();
        let mut from = 0usize;
        let mut found_on_line = false;
        while let Some(offset) = haystack[from..].find(&needle) {
            count += 1;
            found_on_line = true;
            from += offset + needle.len();
            if from >= haystack.len() {
                break;
            }
        }
        if found_on_line && lines.len() < MAX_MATCH_LINES {
            lines.push(MeetingMatchLine {
                line: (index + 1) as u32,
                text: super::transcripts::truncate_chars(line.trim(), MAX_MATCH_LINE_CHARS),
            });
        }
    }
    (count, lines)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filters() -> MeetingFilters {
        MeetingFilters::default()
    }

    #[test]
    fn an_empty_filter_set_is_no_filter_at_all() {
        let validated = filters().validated().unwrap();
        assert!(validated.is_empty());
        assert!(validated.is_metadata_only());
        assert!(validated.matches_metadata("2026-09-10", MeetingStatus::Saved, Some(30)));
    }

    #[test]
    fn date_ranges_are_validated_and_inclusive() {
        let range = MeetingFilters {
            from: Some("2026-09-01".into()),
            to: Some("2026-09-30".into()),
            ..filters()
        }
        .validated()
        .unwrap();
        assert!(range.matches_metadata("2026-09-01", MeetingStatus::Saved, Some(1)));
        assert!(range.matches_metadata("2026-09-30", MeetingStatus::Saved, Some(1)));
        assert!(!range.matches_metadata("2026-08-31", MeetingStatus::Saved, Some(1)));
        assert!(!range.matches_metadata("2026-10-01", MeetingStatus::Saved, Some(1)));

        assert_eq!(
            MeetingFilters {
                from: Some("2026-02-30".into()),
                ..filters()
            }
            .validated(),
            Err(MeetingFilterError::From)
        );
        assert_eq!(
            MeetingFilters {
                to: Some("September".into()),
                ..filters()
            }
            .validated(),
            Err(MeetingFilterError::To)
        );
        assert_eq!(
            MeetingFilters {
                from: Some("2026-09-10".into()),
                to: Some("2026-09-09".into()),
                ..filters()
            }
            .validated(),
            Err(MeetingFilterError::DateRange)
        );
    }

    #[test]
    fn duration_filters_refuse_rows_without_a_duration() {
        let short = MeetingFilters {
            max_minutes: Some(15),
            ..filters()
        }
        .validated()
        .unwrap();
        assert!(short.matches_metadata("2026-09-10", MeetingStatus::Saved, Some(15)));
        assert!(short.matches_metadata("2026-09-10", MeetingStatus::Saved, Some(0)));
        assert!(!short.matches_metadata("2026-09-10", MeetingStatus::Saved, Some(16)));
        // A recording has no duration yet and a failed note has no header:
        // neither may be reported as "short".
        assert!(!short.matches_metadata("2026-09-10", MeetingStatus::Recording, None));
        assert!(!short.matches_metadata("2026-09-10", MeetingStatus::Failed, Some(10)));

        let long = MeetingFilters {
            min_minutes: Some(60),
            ..filters()
        }
        .validated()
        .unwrap();
        assert!(long.matches_metadata("2026-09-10", MeetingStatus::Saved, Some(90)));
        assert!(!long.matches_metadata("2026-09-10", MeetingStatus::Saved, Some(59)));

        assert_eq!(
            MeetingFilters {
                min_minutes: Some(90),
                max_minutes: Some(60),
                ..filters()
            }
            .validated(),
            Err(MeetingFilterError::DurationRange)
        );
        assert_eq!(
            MeetingFilters {
                min_minutes: Some(MAX_DURATION_FILTER_MINUTES + 1),
                ..filters()
            }
            .validated(),
            Err(MeetingFilterError::MinMinutes)
        );
    }

    #[test]
    fn a_query_is_trimmed_lowercased_and_bounded() {
        let query = MeetingFilters {
            text: Some("  Budget Review  ".into()),
            ..filters()
        }
        .validated()
        .unwrap();
        assert_eq!(query.text.as_deref(), Some("budget review"));
        assert!(!query.is_metadata_only());

        assert_eq!(
            MeetingFilters {
                text: Some("   ".into()),
                ..filters()
            }
            .validated(),
            Err(MeetingFilterError::EmptyQuery)
        );
        assert_eq!(
            MeetingFilters {
                text: Some("x".repeat(MAX_QUERY_CHARS + 1)),
                ..filters()
            }
            .validated(),
            Err(MeetingFilterError::QueryTooLong)
        );
        // Exactly at the limit is allowed, measured in characters (not
        // bytes) so a multi-byte query is not refused early.
        assert!(
            MeetingFilters {
                text: Some("é".repeat(MAX_QUERY_CHARS)),
                ..filters()
            }
            .validated()
            .is_ok()
        );
    }

    #[test]
    fn match_lines_counts_every_occurrence_and_names_the_first_three() {
        let content = "alpha\nBeta beta\nnothing\nALPHA again\nbeta\nbeta\n";
        let (count, lines) = match_lines(content, "beta");
        assert_eq!(count, 4);
        assert_eq!(lines.len(), MAX_MATCH_LINES);
        assert_eq!(lines[0].line, 2);
        assert_eq!(lines[0].text, "Beta beta");
        assert_eq!(lines[1].line, 5);
        assert_eq!(lines[1].text, "beta");
        assert_eq!(lines[2].line, 6);

        let (none, empty) = match_lines(content, "gamma");
        assert_eq!(none, 0);
        assert!(empty.is_empty());

        // An empty query matches nothing rather than everything.
        assert_eq!(match_lines(content, "").0, 0);
    }

    #[test]
    fn a_match_line_is_bounded_and_keeps_its_own_line_number() {
        let long = format!("  {}  \nsecond", "á".repeat(400));
        let (count, lines) = match_lines(&long, "á");
        assert_eq!(count, 400);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].line, 1);
        assert!(lines[0].text.chars().count() <= MAX_MATCH_LINE_CHARS + 1);
        assert!(lines[0].text.ends_with('…'));
    }
}
