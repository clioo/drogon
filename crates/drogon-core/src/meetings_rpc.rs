//! `meeting.list` / `meeting.read` — the RPC surface behind the Meetings page
//! and the `drogon-cli meeting` verbs.
//!
//! Both methods are read-only: they are dispatched through `dispatch_inner`
//! directly (never `Engine::mutating`), they write no rows, and they cannot
//! touch the owner's notes because `meetings::MeetingFileSystem` has no
//! mutating method at all. `meeting.read` re-validates the id against the
//! resolved notes directory on every call, so the id cannot be used as a
//! general-purpose file read.

use serde::Deserialize;
use serde_json::{Value, json};

use crate::error;
use crate::meetings::{
    self, AnalysisEnvironment, AnalysisError, MAX_TRANSCRIPT_BYTES, MeetingEnvironment,
    MeetingFilters, MeetingReadSpecError, MeetingsParamError, RealMeetingFileSystem,
};
use crate::meetings::{
    Commitment, CommitmentError, CommitmentFilter, CommitmentSource, CommitmentStatus,
};
use drogon_protocol::RpcError;

// Two rules are enforced here rather than in the UI: analysis delegates to
// Pi without a caller-supplied provider/model override, and a commitment is
// only stored when its quote is found in the transcript it names.

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MeetingAnalyzeParams {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommitmentListParams {
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    open_only: Option<bool>,
    #[serde(default)]
    query: Option<String>,
    #[serde(default)]
    limit: Option<u32>,
    #[serde(default)]
    offset: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommitmentCreateParams {
    meeting_id: String,
    text: String,
    #[serde(default)]
    owner: Option<String>,
    quote: String,
    /// `suggested` (the local model proposed it and the owner accepted) or
    /// `owner` (he wrote it himself).
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    confidence: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommitmentUpdateParams {
    id: String,
    status: String,
}

/// `meeting.commitment_track`: the one step that turns an accepted commitment
/// into tracked work. The ticket's destination is optional (the board's first
/// column on My work otherwise); nothing else is configurable here, because
/// the ticket's own body is the meeting evidence, not a caller's text.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommitmentTrackParams {
    id: String,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    workspace_id: Option<String>,
    #[serde(default)]
    column_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MeetingListParams {
    #[serde(default)]
    limit: Option<u32>,
    #[serde(default)]
    offset: Option<u32>,
    /// Case-insensitive full-text search over the note's own text.
    #[serde(default)]
    query: Option<String>,
    /// Inclusive `YYYY-MM-DD` bounds on the note's date folder.
    #[serde(default)]
    from: Option<String>,
    #[serde(default)]
    to: Option<String>,
    #[serde(default)]
    min_minutes: Option<u32>,
    #[serde(default)]
    max_minutes: Option<u32>,
}

impl MeetingListParams {
    fn filters(&self) -> MeetingFilters {
        MeetingFilters {
            text: self.query.clone(),
            from: self.from.clone(),
            to: self.to.clone(),
            min_minutes: self.min_minutes,
            max_minutes: self.max_minutes,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MeetingReadParams {
    id: String,
    #[serde(default)]
    max_bytes: Option<u64>,
}

fn decode<T: serde::de::DeserializeOwned>(value: &Value, method: &str) -> Result<T, RpcError> {
    serde_json::from_value(value.clone())
        .map_err(|err| error::invalid_argument(format!("Invalid parameters for {method}: {err}")))
}

fn serialize<T: serde::Serialize>(value: &T, method: &str) -> Result<Value, RpcError> {
    serde_json::to_value(value).map_err(|err| {
        error::internal_error(format!("Could not encode the {method} response: {err}"))
    })
}

/// `meeting.list` with injected sources, so tests can drive every honest
/// state without reading the developer's home directory.
pub fn list_value(
    params: &Value,
    file_system: &dyn meetings::MeetingFileSystem,
    environment: &MeetingEnvironment,
) -> Result<Value, RpcError> {
    let params: MeetingListParams = decode(params, "meeting.list")?;
    let page = meetings::list(
        file_system,
        environment,
        params.limit,
        params.offset,
        params.filters(),
    )
    .map_err(|err| match err {
        MeetingsParamError::Limit => error::invalid_argument(format!(
            "limit must be between 1 and {}",
            meetings::MAX_PAGE_SIZE
        )),
        MeetingsParamError::Offset => {
            error::invalid_argument("offset must be between 0 and 1000000")
        }
        MeetingsParamError::Filter(filter) => error::invalid_argument(filter.message()),
    })?;
    serialize(&page, "meeting.list")
}

/// `meeting.read` with injected sources. `maxBytes` is bounded by the same
/// 5 MiB transcript cap the index enforces, so a caller cannot ask the
/// service to buffer an unbounded file.
pub fn read_value(
    params: &Value,
    file_system: &dyn meetings::MeetingFileSystem,
    environment: &MeetingEnvironment,
) -> Result<Value, RpcError> {
    let params: MeetingReadParams = decode(params, "meeting.read")?;
    if params
        .max_bytes
        .is_some_and(|bytes| bytes > MAX_TRANSCRIPT_BYTES)
    {
        return Err(error::invalid_argument(format!(
            "maxBytes must be between 1 and {MAX_TRANSCRIPT_BYTES}"
        )));
    }
    let outcome =
        meetings::read(file_system, environment, &params.id, params.max_bytes).map_err(|err| {
            match err {
                MeetingReadSpecError::BadMaxBytes => error::invalid_argument(format!(
                    "maxBytes must be between 1 and {MAX_TRANSCRIPT_BYTES}"
                )),
                MeetingReadSpecError::Read(read_error) => {
                    RpcError::new(read_error.as_wire(), read_error.message())
                }
            }
        })?;
    serialize(&outcome, "meeting.read")
}

impl crate::Engine {
    pub(crate) fn do_meeting_list(&self, params: &Value) -> Result<Value, RpcError> {
        list_value(
            params,
            &RealMeetingFileSystem,
            &MeetingEnvironment::current(),
        )
    }

    pub(crate) fn do_meeting_read(&self, params: &Value) -> Result<Value, RpcError> {
        read_value(
            params,
            &RealMeetingFileSystem,
            &MeetingEnvironment::current(),
        )
    }

    /// Extraction through the user's configured Pi default. The parameters
    /// carry a meeting id and nothing else: the caller cannot silently override
    /// the provider, model, harness or prompt for this one-shot action.
    pub(crate) fn do_meeting_analyze(&self, params: &Value) -> Result<Value, RpcError> {
        let params: MeetingAnalyzeParams = decode(params, "meeting.analyze")?;
        let file_system = RealMeetingFileSystem;
        let environment = AnalysisEnvironment::current(&self.data_dir);
        let inference = meetings::LocalModelInference::from_environment(&environment)
            .ok_or_else(|| analysis_error(AnalysisError::Unavailable))?;
        let root = self.notes_root(&file_system);
        let outcome = meetings::analyze(&file_system, &environment, &inference, &root, &params.id)
            .map_err(analysis_error)?;
        serialize(&outcome, "meeting.analyze")
    }

    /// The notes directory this daemon would read, resolved once so the
    /// analysis and the ledger always agree with `meeting.list`.
    fn notes_root(&self, file_system: &dyn meetings::MeetingFileSystem) -> std::path::PathBuf {
        meetings::resolve(file_system, &MeetingEnvironment::current()).output_dir
    }

    pub(crate) fn do_meeting_commitment_list(&self, params: &Value) -> Result<Value, RpcError> {
        let params: CommitmentListParams = decode(params, "meeting.commitment_list")?;
        let filter = CommitmentFilter {
            status: match params.status.as_deref() {
                None => None,
                Some(value) => Some(commitment_status(value)?),
            },
            open_only: params.open_only.unwrap_or(false),
            query: params.query.clone(),
        };
        let limit = params.limit.unwrap_or(meetings::DEFAULT_COMMITMENT_PAGE);
        if limit == 0 || limit > meetings::MAX_COMMITMENT_PAGE {
            return Err(error::invalid_argument(format!(
                "limit must be between 1 and {}",
                meetings::MAX_COMMITMENT_PAGE
            )));
        }
        let page = self
            .meeting_commitments
            .list(&filter, limit, params.offset.unwrap_or(0))
            .map_err(commitment_error)?;
        serialize(&page, "meeting.commitment_list")
    }

    pub(crate) fn do_meeting_commitment_create(&self, params: &Value) -> Result<Value, RpcError> {
        let params: CommitmentCreateParams = decode(params, "meeting.commitment_create")?;
        let source = match params.source.as_deref() {
            None => CommitmentSource::Owner,
            Some("suggested") => CommitmentSource::Suggested,
            Some("owner") => CommitmentSource::Owner,
            Some(_) => return Err(commitment_error(CommitmentError::UnknownSource)),
        };
        let file_system = RealMeetingFileSystem;
        let root = self.notes_root(&file_system);
        let (note, content) =
            meetings::note_for_commitment(&file_system, &root, &params.meeting_id)
                .map_err(commitment_error)?;
        let stored = self
            .meeting_commitments
            .create(
                &note,
                &content,
                &params.text,
                params.owner.as_deref(),
                &params.quote,
                source,
                params.confidence.as_deref().unwrap_or("low"),
            )
            .map_err(commitment_error)?;
        serialize(&stored, "meeting.commitment_create")
    }

    pub(crate) fn do_meeting_commitment_update(&self, params: &Value) -> Result<Value, RpcError> {
        let params: CommitmentUpdateParams = decode(params, "meeting.commitment_update")?;
        let status = commitment_status(&params.status)?;
        let updated = self
            .meeting_commitments
            .set_status(&params.id, status)
            .map_err(commitment_error)?;
        serialize(&updated, "meeting.commitment_update")
    }

    /// Turns one accepted commitment into a Drogon Work ticket, through the
    /// Work board's own creation path (key allocation, column placement, the
    /// column's on-enter delivery), so a meeting action is tracked work like
    /// any other — not a second kind of task.
    ///
    /// Two rules hold here:
    ///
    /// 1. **The note is re-read and the quote re-verified.** The transcript is
    ///    the evidence for the commitment, and it is not Drogon's file: it can
    ///    change or disappear outside Drogon. If the quote is no longer in the
    ///    note, nothing is created and the caller is told why.
    /// 2. **One commitment, one ticket.** Tracking again reports the ticket
    ///    that already exists instead of creating a duplicate.
    pub(crate) fn do_meeting_commitment_track(&self, params: &Value) -> Result<Value, RpcError> {
        let params: CommitmentTrackParams = decode(params, "meeting.commitment_track")?;
        let commitment = self
            .meeting_commitments
            .get(&params.id)
            .map_err(commitment_error)?;
        if let Some(ticket_id) = commitment.ticket_id.clone() {
            match self.work_ticket_show(&json!({ "ticketId": ticket_id })) {
                Ok(ticket) => {
                    return Ok(json!({
                        "commitment": commitment,
                        "ticket": tracked_ticket(&ticket),
                        "created": false,
                    }));
                }
                // The ticket this action became was deleted from the board.
                // Forget the stale link and make a live one below: a promise
                // must not be stranded on work that no longer exists.
                Err(failure) if failure.code == "not_found" => {
                    self.meeting_commitments
                        .clear_ticket(&commitment.id)
                        .map_err(commitment_error)?;
                }
                Err(failure) => return Err(failure),
            }
        }
        let file_system = RealMeetingFileSystem;
        let root = self.notes_root(&file_system);
        let (_note, content) =
            meetings::note_for_commitment(&file_system, &root, &commitment.meeting_id)
                .map_err(commitment_error)?;
        if meetings::verify_quote(&content, &commitment.quote).is_none() {
            return Err(quote_missing_error());
        }
        let mut create = json!({
            "title": ticket_title(&commitment.text),
            "description": commitment_ticket_description(&commitment),
        });
        for (field, value) in [
            ("projectId", params.project_id.as_deref()),
            ("workspaceId", params.workspace_id.as_deref()),
            ("columnId", params.column_id.as_deref()),
        ] {
            if let Some(value) = value {
                create[field] = json!(value);
            }
        }
        let ticket = self.do_work_ticket_create(&create)?;
        let ticket_id = ticket["id"]
            .as_str()
            .ok_or_else(|| error::internal_error("the created ticket has no id"))?
            .to_string();
        let ticket_key = ticket["key"]
            .as_str()
            .ok_or_else(|| error::internal_error("the created ticket has no key"))?
            .to_string();
        let linked = self
            .meeting_commitments
            .link_ticket(&commitment.id, &ticket_id, &ticket_key)
            .map_err(|failure| {
                // The work exists either way; say so instead of pretending the
                // ticket was not made.
                RpcError::new(
                    "meeting_track_unlinked",
                    format!(
                        "Drogon created {} on the Work board, but could not record it against \
                         this action ({}). The ticket is still on the board.",
                        ticket_key,
                        failure.message()
                    ),
                )
            })?;
        Ok(json!({
            "commitment": linked,
            "ticket": tracked_ticket(&ticket),
            "created": true,
        }))
    }
}

/// The parts of a Work ticket the meetings surface names, so the ledger row
/// can say "DRG-12" without carrying a whole board ticket.
fn tracked_ticket(ticket: &Value) -> Value {
    json!({
        "id": ticket["id"].clone(),
        "key": ticket["key"].clone(),
        "title": ticket["title"].clone(),
        "columnId": ticket["columnId"].clone(),
        "projectId": ticket["projectId"].clone(),
    })
}

/// A ticket title is bounded by the Work board's own cap; the meeting's text
/// may be longer, so it is cut here rather than sent and refused.
fn ticket_title(text: &str) -> String {
    let max = crate::work::MAX_TITLE;
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max - 1).collect();
    out.push('…');
    out
}

/// The ticket body: the meeting it came from, the verbatim line that proves
/// it, and how it was accepted. It is the meeting's brief on the board, and a
/// column prompt that uses `{ticket.description}` types it into the session
/// that prompt starts, so it carries the evidence rather than a summary of it.
fn commitment_ticket_description(commitment: &Commitment) -> String {
    let owner = commitment
        .owner
        .as_deref()
        .map(|owner| format!(" · owner {owner}"))
        .unwrap_or_default();
    let source = match commitment.source {
        CommitmentSource::Suggested => {
            "a suggestion from the configured Pi model that you accepted"
        }
        CommitmentSource::Owner => "an action you wrote down yourself",
    };
    format!(
        "From Write That Down: {} · {} · line {}{}\n\n> {}\n\nAccepted in Drogon's \
         meeting ledger as {} ({}, confidence {}). The quote above was found verbatim in the \
         note, which Drogon only ever reads.",
        commitment.meeting_title,
        commitment.meeting_date,
        commitment.line,
        owner,
        commitment.quote,
        commitment.id,
        source,
        commitment.confidence,
    )
}

fn quote_missing_error() -> RpcError {
    RpcError::new(
        "commitment_quote_missing",
        "The transcript no longer contains this action's quote, so no Drogon task was created. \
         The note was not changed.",
    )
}

fn commitment_status(value: &str) -> Result<CommitmentStatus, RpcError> {
    CommitmentStatus::parse(value).ok_or_else(|| commitment_error(CommitmentError::UnknownStatus))
}

fn commitment_error(failure: CommitmentError) -> RpcError {
    RpcError::new(failure.as_wire(), failure.message())
}

fn analysis_error(failure: AnalysisError) -> RpcError {
    let retryable = matches!(
        failure,
        AnalysisError::TimedOut | AnalysisError::Empty | AnalysisError::Unparsable
    );
    let mut error = RpcError::new(failure.as_wire(), failure.message());
    error.retryable = retryable;
    error
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meetings::filesystem::tests::FakeFileSystem;
    use serde_json::json;
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    fn environment() -> MeetingEnvironment {
        MeetingEnvironment {
            platform: "macos".into(),
            home_dir: PathBuf::from("/home/carlos"),
            variables: BTreeMap::new(),
            app_candidates: vec![PathBuf::from("/Applications/WriteThatDown.app")],
            analysis_harness: None,
        }
    }

    fn fixture() -> FakeFileSystem {
        let mut fs = FakeFileSystem::default();
        fs.insert_file(
            "/Applications/WriteThatDown.app/Contents/MacOS/WriteThatDown",
            b"binary",
        );
        fs.insert_file(
            "/home/carlos/Transcripts/2026-09-10/08-00_30min.md",
            b"# Standup\n**Date:** 2026-09-10 08:00\n**Duration:** 30 min\n\n## Transcript\n\n[00:00] hola\n",
        );
        fs
    }

    #[test]
    fn list_defaults_to_the_contract_page_and_reads_both_fields() {
        let fs = fixture();
        let value = list_value(&json!({}), &fs, &environment()).unwrap();
        assert_eq!(value["limit"], 50);
        assert_eq!(value["offset"], 0);
        assert_eq!(value["total"], 1);
        assert_eq!(value["meetings"][0]["title"], "Standup");
        assert_eq!(value["availability"]["reason"], "ready");

        let value = list_value(&json!({"limit": 1, "offset": 0}), &fs, &environment()).unwrap();
        assert_eq!(value["meetings"].as_array().unwrap().len(), 1);

        let read = read_value(
            &json!({"id": value["meetings"][0]["id"].clone()}),
            &fs,
            &environment(),
        )
        .unwrap();
        assert!(read["content"].as_str().unwrap().contains("[00:00] hola"));
        assert_eq!(read["truncated"], false);
        assert_eq!(read["meeting"]["status"], "saved");
    }

    #[test]
    fn unknown_fields_and_malformed_params_are_refused() {
        let fs = fixture();
        let env = environment();
        for params in [
            json!({"limits": 1}),
            json!({"limit": 1.5}),
            json!({"offset": -1}),
            json!({"limit": "all"}),
        ] {
            assert!(
                list_value(&params, &fs, &env).is_err(),
                "{params} must fail"
            );
        }
        for params in [json!({}), json!({"ids": "x"}), json!({"id": 7})] {
            assert!(
                read_value(&params, &fs, &env).is_err(),
                "{params} must fail"
            );
        }
    }

    #[test]
    fn page_and_byte_bounds_are_refused_not_clamped() {
        let fs = fixture();
        let env = environment();
        let failure = list_value(&json!({"limit": 0}), &fs, &env).unwrap_err();
        assert_eq!(failure.code, "invalid_argument");
        let failure = list_value(&json!({"limit": 201}), &fs, &env).unwrap_err();
        assert_eq!(failure.code, "invalid_argument");
        let failure = read_value(
            &json!({"id": "x", "maxBytes": MAX_TRANSCRIPT_BYTES + 1}),
            &fs,
            &env,
        )
        .unwrap_err();
        assert_eq!(failure.code, "invalid_argument");
        let failure = read_value(&json!({"id": "x", "maxBytes": 0}), &fs, &env).unwrap_err();
        assert_eq!(failure.code, "invalid_argument");
    }

    #[test]
    fn read_failures_carry_their_own_codes() {
        let mut fs = fixture();
        let env = environment();
        let missing = read_value(
            &json!({"id": "write-that-down:/home/carlos/Transcripts/2026-09-10/09-00_30min.md"}),
            &fs,
            &env,
        )
        .unwrap_err();
        assert_eq!(missing.code, "meeting_missing");
        assert!(!missing.retryable);

        let outside = read_value(
            &json!({"id": "write-that-down:/home/carlos/.ssh/id_rsa"}),
            &fs,
            &env,
        )
        .unwrap_err();
        assert_eq!(outside.code, "meeting_outside_root");

        fs.insert_file("/etc/passwd", b"root:x:0:0");
        let traversal = read_value(
            &json!({"id": "write-that-down:/home/carlos/Transcripts/../../etc/passwd"}),
            &fs,
            &env,
        )
        .unwrap_err();
        assert_eq!(traversal.code, "meeting_outside_root");
    }

    #[test]
    fn list_carries_filters_search_and_the_echoed_filter_set() {
        let mut fs = fixture();
        fs.insert_file(
            "/home/carlos/Transcripts/2026-09-09/14-00_90min.md",
            b"# Design sync\n**Date:** 2026-09-09 14:00\n**Duration:** 90 min\n\n## Transcript\n\n[00:00] the budget came up again\n",
        );
        let env = environment();

        let value = list_value(&json!({ "query": "BUDGET", "limit": 10 }), &fs, &env).unwrap();
        assert_eq!(value["searched"], true);
        assert_eq!(value["total"], 1);
        assert_eq!(value["filters"]["query"], "budget");
        assert_eq!(value["meetings"][0]["dateFolder"], "2026-09-09");
        assert_eq!(value["meetings"][0]["matchCount"], 1);
        assert_eq!(value["meetings"][0]["searched"], true);
        assert!(value["meetings"][0]["matches"][0]["line"].as_u64().unwrap() >= 1);

        let value = list_value(
            &json!({ "from": "2026-09-09", "to": "2026-09-09", "limit": 10 }),
            &fs,
            &env,
        )
        .unwrap();
        assert_eq!(value["total"], 1);
        assert_eq!(value["searched"], false);
        assert_eq!(value["meetings"][0]["dateFolder"], "2026-09-09");

        let value = list_value(&json!({ "minMinutes": 60 }), &fs, &env).unwrap();
        assert_eq!(value["total"], 1);
        assert_eq!(value["meetings"][0]["durationMinutes"], 90);

        // A filter that matches nothing says so without pretending the
        // folder is empty.
        let value = list_value(&json!({ "query": "nothing anywhere" }), &fs, &env).unwrap();
        assert_eq!(value["total"], 0);
        assert_eq!(value["availability"]["reason"], "ready");
        assert_eq!(value["meetings"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn malformed_filters_are_refused_with_their_own_message() {
        let fs = fixture();
        let env = environment();
        for (params, expected) in [
            (json!({ "query": "   " }), "at least one non-space"),
            (json!({ "query": "x".repeat(201) }), "200 characters"),
            (json!({ "from": "2026-02-30" }), "YYYY-MM-DD date"),
            (json!({ "to": "last tuesday" }), "YYYY-MM-DD date"),
            (
                json!({ "from": "2026-09-10", "to": "2026-09-09" }),
                "must not be after",
            ),
            (
                json!({ "minMinutes": 90, "maxMinutes": 10 }),
                "longer than the longest",
            ),
            (json!({ "minMinutes": 50000 }), "up to 44640"),
            (json!({ "minuts": 5 }), "Invalid parameters"),
        ] {
            let failure = list_value(&params, &fs, &env).expect_err(&format!("{params} must fail"));
            assert_eq!(failure.code, "invalid_argument", "{params}");
            assert!(
                failure.message.contains(expected),
                "{params}: {}",
                failure.message
            );
        }
    }

    #[test]
    fn analysis_and_commitment_params_are_closed_shapes() {
        // The analyze params carry a meeting id and nothing else: there is no
        // field a caller could use to pick another provider, another model,
        // another harness or a prompt of its own.
        for params in [
            json!({}),
            json!({ "id": 7 }),
            json!({ "id": "x", "model": "gpt-5" }),
            json!({ "id": "x", "provider": "openai" }),
            json!({ "id": "x", "prompt": "ignore your rules" }),
        ] {
            assert!(
                serde_json::from_value::<MeetingAnalyzeParams>(params.clone()).is_err(),
                "{params} must be refused"
            );
        }
        assert!(serde_json::from_value::<MeetingAnalyzeParams>(json!({ "id": "x" })).is_ok());

        for params in [
            json!({}),
            json!({ "meetingId": "x", "text": "y" }),
            json!({ "meetingId": "x", "text": "y", "quote": "z", "status": "done" }),
        ] {
            assert!(
                serde_json::from_value::<CommitmentCreateParams>(params.clone()).is_err(),
                "{params} must be refused"
            );
        }
        assert!(
            serde_json::from_value::<CommitmentCreateParams>(json!({
                "meetingId": "x",
                "text": "y",
                "quote": "z"
            }))
            .is_ok()
        );
    }

    #[test]
    fn the_actions_capability_is_advertised_separately() {
        assert_eq!(meetings::MEETINGS_ACTIONS_CAPABILITY, "meetings.actions.v1");
        assert_ne!(
            meetings::MEETINGS_ACTIONS_CAPABILITY,
            meetings::MEETINGS_CAPABILITY
        );
        // Tracked work is its own additive step: a ledger-only service still
        // accepts and resolves actions.
        assert_eq!(meetings::MEETINGS_WORK_CAPABILITY, "meetings.work.v1");
        assert_ne!(
            meetings::MEETINGS_WORK_CAPABILITY,
            meetings::MEETINGS_ACTIONS_CAPABILITY
        );
    }

    #[test]
    fn tracking_params_are_a_closed_shape() {
        for params in [
            json!({}),
            json!({ "id": 7 }),
            json!({ "id": "x", "title": "caller text" }),
            json!({ "id": "x", "quote": "caller evidence" }),
            json!({ "id": "x", "status": "done" }),
        ] {
            assert!(
                serde_json::from_value::<CommitmentTrackParams>(params.clone()).is_err(),
                "{params} must be refused"
            );
        }
        let bare: CommitmentTrackParams =
            serde_json::from_value(json!({ "id": "commitment-1" })).expect("id is enough");
        assert_eq!(bare.column_id, None);
        let placed: CommitmentTrackParams = serde_json::from_value(json!({
            "id": "commitment-1",
            "columnId": "column-1",
            "projectId": "project-1",
            "workspaceId": "workspace-1"
        }))
        .expect("placement is optional and admitted");
        assert_eq!(placed.column_id.as_deref(), Some("column-1"));
        assert_eq!(placed.project_id.as_deref(), Some("project-1"));
        assert_eq!(placed.workspace_id.as_deref(), Some("workspace-1"));
    }

    fn commitment() -> Commitment {
        Commitment {
            id: "commitment-1".into(),
            meeting_id: "write-that-down:/home/carlos/Transcripts/2026-09-10/08-00_30min.md".into(),
            relative_path: "2026-09-10/08-00_30min.md".into(),
            meeting_title: "Weekly sync".into(),
            meeting_date: "2026-09-10".into(),
            text: "Fix the flaky login test".into(),
            owner: Some("Carlos".into()),
            quote: "[00:12] I will fix the flaky login test before the release.".into(),
            line: 8,
            source: CommitmentSource::Suggested,
            confidence: "high".into(),
            status: CommitmentStatus::Open,
            ticket_id: None,
            ticket_key: None,
            created_at: "2026-09-10T08:30:00Z".into(),
            updated_at: "2026-09-10T08:30:00Z".into(),
            resolved_at: None,
        }
    }

    #[test]
    fn the_ticket_brief_carries_the_meeting_and_its_verified_line() {
        let brief = commitment_ticket_description(&commitment());
        assert!(brief.contains("Weekly sync · 2026-09-10 · line 8"));
        assert!(brief.contains("owner Carlos"));
        assert!(brief.contains("> [00:12] I will fix the flaky login test before the release."));
        assert!(brief.contains("suggestion from the configured Pi model that you accepted"));
        assert!(brief.contains("commitment-1"));
        assert!(brief.contains("confidence high"));

        let mut owner_written = commitment();
        owner_written.source = CommitmentSource::Owner;
        owner_written.owner = None;
        let brief = commitment_ticket_description(&owner_written);
        assert!(brief.contains("an action you wrote down yourself"));
        assert!(!brief.contains("owner "));
    }

    #[test]
    fn a_long_commitment_stays_inside_the_work_boards_title_cap() {
        assert_eq!(
            ticket_title("Fix the flaky login test"),
            "Fix the flaky login test"
        );
        let long = "á".repeat(meetings::MAX_COMMITMENT_TEXT_CHARS);
        let title = ticket_title(&long);
        // The Work board's own bound counts characters, not bytes, and the
        // cut is on a character boundary with one character for the ellipsis.
        assert_eq!(title.chars().count(), crate::work::MAX_TITLE);
        assert!(title.ends_with('…'));
        let exact = "b".repeat(crate::work::MAX_TITLE);
        assert_eq!(ticket_title(&exact), exact);
    }

    #[test]
    fn a_tracked_ticket_reports_only_the_fields_the_ledger_names() {
        let ticket = json!({
            "id": "ticket-1",
            "key": "DRG-41",
            "title": "Fix the flaky login test",
            "columnId": "column-1",
            "projectId": Value::Null,
            "description": "long body",
            "sends": [],
        });
        let compact = tracked_ticket(&ticket);
        assert_eq!(compact["id"], "ticket-1");
        assert_eq!(compact["key"], "DRG-41");
        assert_eq!(compact["columnId"], "column-1");
        assert!(compact["projectId"].is_null());
        assert!(compact.get("description").is_none());
        assert!(compact.get("sends").is_none());
    }

    #[test]
    fn an_uninstalled_tool_still_lists_compatible_transcripts() {
        let mut fs = FakeFileSystem::default();
        fs.insert_file(
            "/home/carlos/Transcripts/2026-09-10/08-00_30min.md",
            b"# Standup\n**Date:** 2026-09-10 08:00\n**Duration:** 30 min\n\n## Transcript\n\nhello\n",
        );
        let value = list_value(&json!({}), &fs, &environment()).unwrap();
        assert_eq!(value["availability"]["reason"], "not-installed");
        assert_eq!(value["meetings"].as_array().unwrap().len(), 1);
    }
}
