//! Bounded, deterministic keyset pagination shared by the run and task lists.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use drogon_protocol::RpcError;
use drogon_protocol::orchestration_common::{DEFAULT_RUN_PAGE_LIMIT, MAX_PAGE_LIMIT, OpaqueCursor};

/// Version tag inside the cursor payload, so a future change to the keyset shape
const CURSOR_VERSION: u8 = 1;

/// Serialized budget for one list result. The wire frame caps any message at
pub(crate) const PAGE_RESULT_BUDGET_BYTES: usize = 512 * 1024;

/// Every scope a cursor is bound to. Any mismatch means the token belongs to a
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
pub(crate) fn encode_cursor(scope: &CursorScope) -> Result<OpaqueCursor, RpcError> {
    let token = OpaqueCursor(URL_SAFE_NO_PAD.encode(scope.fingerprint()));
    token
        .validate()
        .map_err(|_| RpcError::new("storage_error", "The page cursor is too large to return."))?;
    Ok(token)
}

/// Decodes and re-validates a caller-supplied cursor. A malformed token, and a
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
    let bytes = URL_SAFE_NO_PAD
        .decode(cursor.0.as_bytes())
        .map_err(|_| refused())?;
    let scope = CursorScope::from_fingerprint(&bytes).ok_or_else(refused)?;
    if scope.family != expected.family
        || scope.host_id != expected.host_id
        || scope.run_id != expected.run_id
        || scope.filter != expected.filter
        || scope.after_created_at_ms > i64::MAX as u64
        || crate::runs::validate_id(&scope.after_id).is_err()
    {
        return Err(refused());
    }
    Ok(scope)
}

/// Resolves a requested page size against the wire bounds. Shape validation
pub(crate) fn page_limit(limit: Option<u32>) -> Result<usize, RpcError> {
    let resolved =
        usize::try_from(limit.unwrap_or(DEFAULT_RUN_PAGE_LIMIT)).map_err(|_| oversized_page())?;
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

/// Reserve envelope/cursor space, then resume at the last row that fits.
pub(crate) fn fit_page<T: serde::Serialize>(
    rows: Vec<T>,
    budget: usize,
) -> Result<(Vec<T>, bool), RpcError> {
    let mut kept: Vec<T> = Vec::new();
    let mut total = 4096usize;
    for row in rows {
        let size = serde_json::to_vec(&row)
            .map_err(|_| serialization_failed())?
            .len();
        let next = total
            .saturating_add(size)
            .saturating_add(usize::from(!kept.is_empty()));
        if next > budget {
            if kept.is_empty() {
                return Err(RpcError::new(
                    "storage_error",
                    "A stored coordination row exceeds the page size limit.",
                ));
            }
            return Ok((kept, true));
        }
        total = next;
        kept.push(row);
    }
    Ok((kept, false))
}

fn serialization_failed() -> RpcError {
    RpcError::new(
        "storage_error",
        "The coordination store could not serialize a page.",
    )
}

/// Splits a probed page into `(returned rows, whether a further row exists)`.
pub(crate) fn split_page<T>(probed: Vec<T>, limit: usize) -> (Vec<T>, bool) {
    let has_more = probed.len() > limit;
    let mut rows = probed;
    if has_more {
        rows.truncate(limit);
    }
    (rows, has_more)
}
