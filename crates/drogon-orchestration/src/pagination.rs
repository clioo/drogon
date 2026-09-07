//! Bounded, deterministic keyset pagination shared by the run and task lists.
//!
//! Why keyset instead of OFFSET: a page must stay bounded and stable while rows
//! are inserted concurrently, and an OFFSET scan grows with the offset. The
//! cursor carries the exact scope the caller selected plus the sort key of the
//! last row *the server actually returned*, so a token minted for one
//! host/run/filter is provably refused by any other listing, and a page trimmed
//! for size resumes exactly where it stopped instead of skipping rows.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use drogon_protocol::RpcError;
use drogon_protocol::orchestration_common::{DEFAULT_RUN_PAGE_LIMIT, MAX_PAGE_LIMIT, OpaqueCursor};
use serde_json::json;

/// Version tag inside the cursor payload, so a future change to the keyset shape
/// refuses old tokens instead of misreading them.
const CURSOR_VERSION: u8 = 1;

/// Serialized budget for one list result. The wire frame caps any message at
/// `drogon_protocol::MAX_FRAME_BYTES` (1 MiB), and a full page of maximum-size
/// specs is far larger than that (100 x 32 KiB of instructions alone), so a page
/// is trimmed to a conservative fraction of the frame and continues by cursor.
pub(crate) const PAGE_RESULT_BUDGET_BYTES: usize = 512 * 1024;

/// Every scope a cursor is bound to. Any mismatch means the token belongs to a
/// different listing and must be refused rather than honoured.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CursorScope {
    /// `"run"` or `"task"`: the listing family the token was minted for.
    pub family: &'static str,
    pub host_id: String,
    /// Empty for the host-scoped run listing; a run id for task listings.
    pub run_id: String,
    /// Normalised filter identity (`""`, `"ready"`, `"pending"`, ...).
    pub filter: String,
    /// Sort key of the last returned row, replayed as a strict keyset predicate.
    pub after_created_at_ms: u64,
    pub after_id: String,
}

impl CursorScope {
    /// Length-prefixed encoding. A delimiter join would let two distinct scopes
    /// collide, which would allow one listing to accept another's cursor.
    fn fingerprint(&self) -> Vec<u8> {
        let mut out = vec![CURSOR_VERSION];
        for field in [
            self.family.as_bytes(),
            self.host_id.as_bytes(),
            self.run_id.as_bytes(),
            self.filter.as_bytes(),
            self.after_id.as_bytes(),
        ] {
            out.extend_from_slice(&(field.len() as u32).to_be_bytes());
            out.extend_from_slice(field);
        }
        out.extend_from_slice(&self.after_created_at_ms.to_be_bytes());
        out
    }

    fn from_fingerprint(bytes: &[u8]) -> Option<CursorScope> {
        if bytes.first()? != &CURSOR_VERSION {
            return None;
        }
        let mut rest = &bytes[1..];
        let mut field = || {
            let len = u32::from_be_bytes(rest.get(..4)?.try_into().ok()?) as usize;
            let value = rest.get(4..)?.get(..len)?;
            let text = std::str::from_utf8(value).ok()?.to_string();
            rest = &rest[4 + len..];
            Some(text)
        };
        let family = field()?;
        Some(CursorScope {
            family: match family.as_str() {
                "run" => "run",
                "task" => "task",
                _ => return None,
            },
            host_id: field()?,
            run_id: field()?,
            filter: field()?,
            after_id: field()?,
            after_created_at_ms: u64::from_be_bytes(rest.try_into().ok()?),
        })
    }
}

/// Mints the continuation token for the last row the server returned. The token
/// is base64url (RFC 4648 section 5) without padding, which satisfies the wire
/// rule for opaque tokens — non-empty, bounded, no whitespace or control
/// characters — without the client parsing its contents.
pub(crate) fn encode_cursor(scope: &CursorScope) -> Result<OpaqueCursor, RpcError> {
    let token = OpaqueCursor(URL_SAFE_NO_PAD.encode(scope.fingerprint()));
    token
        .validate()
        .map_err(|_| RpcError::new("storage_error", "The page cursor is too large to return."))?;
    Ok(token)
}

/// Decodes and re-validates a caller-supplied cursor. A malformed token, and a
/// token that does not match the currently requested scope, is
/// `invalid_argument`; nothing silently falls back to a first page.
pub(crate) fn decode_cursor(
    cursor: &OpaqueCursor,
    expected: &CursorScope,
) -> Result<CursorScope, RpcError> {
    let refused = || {
        RpcError::new(
            "invalid_argument",
            "The page cursor does not fit this listing.",
        )
    };
    cursor.validate()?;
    let bytes = URL_SAFE_NO_PAD.decode(cursor.0.as_bytes()).map_err(|_| refused())?;
    let scope = CursorScope::from_fingerprint(&bytes).ok_or_else(refused)?;
    if scope != *expected {
        return Err(refused());
    }
    Ok(scope)
}

/// Resolves a requested page size against the wire bounds. Shape validation
/// already checked the value; the domain re-checks so it never depends on the
/// caller having validated.
pub(crate) fn page_limit(limit: Option<u32>) -> Result<usize, RpcError> {
    let resolved = usize::try_from(limit.unwrap_or(DEFAULT_RUN_PAGE_LIMIT))
        .map_err(|_| oversized_page())?;
    if resolved == 0 || resolved > usize::try_from(MAX_PAGE_LIMIT).unwrap_or(resolved) {
        return Err(oversized_page());
    }
    Ok(resolved)
}

fn oversized_page() -> RpcError {
    RpcError::new(
        "invalid_argument",
        "Page limit is outside the supported range.",
    )
}

/// Keeps a serialized list result inside `budget` without dropping evidence.
///
/// Rows are appended in order and measured with the real serializer against a
/// fixed `"{"tasks":[..]}"` envelope shape — no synthetic value is ever returned
/// to a caller. The first row is always kept, so a single oversized row still
/// surfaces and root's frame check refuses it explicitly rather than the domain
/// hiding it. Any further row that would cross the budget ends the page, and the
/// continuation cursor is minted from the last kept row, so trimmed rows are
/// returned by the next page instead of skipped.
pub(crate) fn fit_page<T: serde::Serialize>(
    rows: Vec<T>,
    budget: usize,
) -> Result<(Vec<T>, bool), RpcError> {
    let mut kept: Vec<T> = Vec::new();
    let mut serialized: Vec<u64> = Vec::new();
    // Envelope overhead measured once: `{"tasks":[]}` plus one comma per extra row.
    let envelope_overhead = serde_json::to_vec(&json!({ "tasks": [] }))
        .map_err(|_| serialization_failed())?
        .len();
    for row in rows {
        let size = serde_json::to_vec(&row)
            .map_err(|_| serialization_failed())?
            .len();
        let separator = usize::try_from(!kept.is_empty()).map_err(|_| serialization_failed())?;
        let total = serialized
            .iter()
            .map(|previous| usize::try_from(*previous).unwrap_or(usize::MAX))
            .sum::<usize>()
            .saturating_add(size + separator)
            .saturating_add(envelope_overhead);
        if !kept.is_empty() && total > budget {
            return Ok((kept, true));
        }
        kept.push(row);
        serialized.push(u64::try_from(size).unwrap_or(u64::MAX));
    }
    Ok((kept, false))
}

fn serialization_failed() -> RpcError {
    RpcError::new("storage_error", "The coordination store could not serialize a page.")
}

/// Splits a probed page into `(returned rows, whether a further row exists)`.
/// The caller fetched `limit + 1` rows, so a surplus row means a next page
/// exists and is re-read from the cursor rather than carried over.
pub(crate) fn split_page<T>(probed: Vec<T>, limit: usize) -> (Vec<T>, bool) {
    let has_more = probed.len() > limit;
    let mut rows = probed;
    if has_more {
        rows.truncate(limit);
    }
    (rows, has_more)
}
