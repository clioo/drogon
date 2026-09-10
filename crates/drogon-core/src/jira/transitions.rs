//! Jira workflow transitions (C09): real request/response validation and the
//! board's pending/reconciliation state machine. Every move targets a
//! transition id actually offered by the connected site for that exact
//! issue — display names, workspace statuses and guessed status mutations
//! are never accepted. An uncertain HTTP outcome (timeout, network loss,
//! 5xx, cancel mid-flight) can never be retried blindly: the board must
//! first reconcile against the server's current status.
//!
//! The module is deliberately free of `crate::` imports so it can compile
//! standalone; the daemon wiring (one `pub mod transitions;` line in the
//! held `jira/mod.rs` plus an executor impl over `super::client`) lands
//! with the coordinator's reconciliation. Until then the integration test
//! `tests/jira_transitions.rs` compiles this exact file via `#[path]`.
//! MIT Copyright (c) 2026 Lovecast Inc.

use std::collections::HashMap;

// --- identity ---------------------------------------------------------------

/// Separator between the percent-encoded site id and the issue id, matching
/// the C02 kanban host-identity discipline (`host|id`): printable, and the
/// encoded site part can never contain a literal separator, so the first
/// one is an unambiguous split.
const IDENTITY_SEPARATOR: char = '|';

fn encode_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn decode_component(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' => {
                let hex = value.get(index + 1..index + 3)?;
                decoded.push(u8::from_str_radix(hex, 16).ok()?);
                index += 3;
            }
            byte => {
                decoded.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(decoded).ok()
}

/// Stable key for one issue on one site. Jira issue ids and keys repeat
/// across instances (two sites both mint `DROG-1`), so every selection,
/// pending overlay and move is keyed on this composition, never on the raw
/// key. The site part is percent-encoded; the issue id stays raw after the
/// first separator.
pub fn compose_issue_identity(site_id: &str, issue_id: &str) -> String {
    format!(
        "{}{IDENTITY_SEPARATOR}{issue_id}",
        encode_component(site_id)
    )
}

/// Inverse of [`compose_issue_identity`]; `None` for malformed input —
/// never a guessed site.
pub fn parse_issue_identity(identity: &str) -> Option<(String, String)> {
    parse_encoded_identity(identity)
}

/// Stable key for one status column on one site: two instances both have a
/// status *named* "In Progress" with different ids, and they must stay
/// distinct lanes.
pub fn compose_lane_identity(site_id: &str, status_id: &str) -> String {
    format!(
        "{}{IDENTITY_SEPARATOR}{status_id}",
        encode_component(site_id)
    )
}

/// Inverse of [`compose_lane_identity`].
pub fn parse_lane_identity(identity: &str) -> Option<(String, String)> {
    parse_encoded_identity(identity)
}

fn parse_encoded_identity(identity: &str) -> Option<(String, String)> {
    let (encoded_site, id) = identity.split_once(IDENTITY_SEPARATOR)?;
    if id.is_empty() {
        return None;
    }
    let site = decode_component(encoded_site)?;
    // Canonical check: the composer would have percent-encoded the site, so
    // a part that does not round-trip was not written by this module.
    if encode_component(&site) != encoded_site {
        return None;
    }
    Some((site, id.to_string()))
}

// --- wire shapes -------------------------------------------------------------

/// A Jira status, narrowed to the fields the board groups and renders by.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusRef {
    pub id: String,
    pub name: String,
    pub category_key: String,
}

/// One workflow transition the site actually offers for one issue. `id` is
/// the only mutation handle; `name` and `to` are display data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AvailableTransition {
    pub id: String,
    pub name: String,
    pub to: StatusRef,
    /// Field keys Jira requires on this transition (from the real
    /// `transitions` response with `expand=transitions.fields`); empty when
    /// the site offers none.
    pub required_fields: Vec<String>,
}

/// Parse the real `GET /issue/{key}/transitions` envelope — the same
/// mapping the daemon's `list_transitions` performs, plus the optional
/// per-transition screen `fields[]` the board needs to know which moves
/// need input.
pub fn parse_available_transitions(response: &serde_json::Value) -> Vec<AvailableTransition> {
    response
        .get("transitions")
        .and_then(serde_json::Value::as_array)
        .map(|records| {
            records
                .iter()
                .filter_map(|record| {
                    let id = record.get("id").and_then(serde_json::Value::as_str)?;
                    let to = record.get("to")?;
                    let category = to.get("statusCategory");
                    let required_fields: Vec<String> = record
                        .get("fields")
                        .and_then(serde_json::Value::as_array)
                        .map(|fields| {
                            fields
                                .iter()
                                .filter(|field| {
                                    field.get("required").and_then(serde_json::Value::as_bool)
                                        == Some(true)
                                })
                                .filter_map(|field| {
                                    field.get("key").and_then(serde_json::Value::as_str)
                                })
                                .map(str::to_string)
                                .collect()
                        })
                        .unwrap_or_default();
                    Some(AvailableTransition {
                        id: id.to_string(),
                        name: record
                            .get("name")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        to: StatusRef {
                            id: to.get("id")?.as_str()?.to_string(),
                            name: to
                                .get("name")
                                .and_then(serde_json::Value::as_str)
                                .unwrap_or_default()
                                .to_string(),
                            category_key: category
                                .and_then(|c| c.get("key"))
                                .and_then(serde_json::Value::as_str)
                                .unwrap_or_default()
                                .to_string(),
                        },
                        required_fields,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The exact issue a move acts on: the site is part of the identity, so a
/// transition fetched from one instance can never be applied to another
/// instance's colliding key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IssueRef {
    pub site_id: String,
    pub issue_id: String,
    pub issue_key: String,
    pub status: StatusRef,
}

impl IssueRef {
    pub fn identity(&self) -> String {
        compose_issue_identity(&self.site_id, &self.issue_id)
    }
}

// --- move planning -----------------------------------------------------------

/// What the user asked for. Either handle must resolve to exactly one real
/// transition before anything is posted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MoveTarget {
    /// "Move to the column with this status id" (a lane drop).
    Status { status_id: String },
    /// "Run this transition id" (an explicit menu action).
    Transition { transition_id: String },
}

/// Why a requested move cannot be posted. Every variant is a truthful,
/// showable reason — the board never guesses around one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockedReason {
    NoTransitionsOffered,
    TransitionNotOffered {
        transition_id: String,
    },
    StatusNotReachable {
        status_id: String,
    },
    /// More than one offered transition reaches the target status; the user
    /// must pick the real one (workflows commonly route "Go to X" and
    /// "Reopen" to the same status with different side effects).
    AmbiguousStatus {
        status_id: String,
        transition_ids: Vec<String>,
    },
    RequiredFieldsMissing {
        transition_id: String,
        fields: Vec<String>,
    },
    /// The issue already sits in the target status — refusing a no-op POST.
    AlreadyInStatus {
        status_id: String,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum PlanOutcome {
    Ready(TransitionPlan),
    Blocked(BlockedReason),
}

/// A validated, postable move: the exact transition id, its target status
/// and the supplied field values for the transition's screen.
#[derive(Debug, Clone, PartialEq)]
pub struct TransitionPlan {
    pub transition_id: String,
    pub transition_name: String,
    pub target_status: StatusRef,
    /// Supplied values for the transition's required fields, verbatim.
    pub fields: serde_json::Value,
}

/// Resolve a board move into a postable plan, or an honest block.
///
/// `available` MUST be the transitions fetched for `issue` on its own site
/// (`jira.transitions` with the siteId); a transition from any other set is
/// structurally unreachable here, which is what keeps colliding keys on two
/// instances targeting their own workflows.
pub fn plan_move(
    issue: &IssueRef,
    available: &[AvailableTransition],
    target: &MoveTarget,
    supplied_fields: &serde_json::Value,
) -> PlanOutcome {
    if available.is_empty() {
        return PlanOutcome::Blocked(BlockedReason::NoTransitionsOffered);
    }
    let transition = match target {
        MoveTarget::Transition { transition_id } => {
            match available.iter().find(|t| t.id == *transition_id) {
                Some(transition) => transition,
                None => {
                    return PlanOutcome::Blocked(BlockedReason::TransitionNotOffered {
                        transition_id: transition_id.clone(),
                    });
                }
            }
        }
        MoveTarget::Status { status_id } => {
            let matches: Vec<&AvailableTransition> =
                available.iter().filter(|t| t.to.id == *status_id).collect();
            match matches.len() {
                0 => {
                    return PlanOutcome::Blocked(BlockedReason::StatusNotReachable {
                        status_id: status_id.clone(),
                    });
                }
                1 => matches[0],
                _ => {
                    return PlanOutcome::Blocked(BlockedReason::AmbiguousStatus {
                        status_id: status_id.clone(),
                        transition_ids: matches
                            .iter()
                            .map(|t| t.id.clone())
                            .collect::<Vec<String>>(),
                    });
                }
            }
        }
    };
    if transition.to.id == issue.status.id {
        return PlanOutcome::Blocked(BlockedReason::AlreadyInStatus {
            status_id: issue.status.id.clone(),
        });
    }
    // A required field counts as supplied only with a present, non-null,
    // non-empty value — an empty string is not an answer.
    let supplied = supplied_fields.as_object();
    let is_filled = |key: &str| match supplied.and_then(|object| object.get(key)) {
        Some(value) => {
            !value.is_null()
                && !(value.is_string() && value.as_str().unwrap_or_default().is_empty())
        }
        None => false,
    };
    let missing: Vec<String> = transition
        .required_fields
        .iter()
        .filter(|key| !is_filled(key))
        .cloned()
        .collect();
    if !missing.is_empty() {
        return PlanOutcome::Blocked(BlockedReason::RequiredFieldsMissing {
            transition_id: transition.id.clone(),
            fields: missing,
        });
    }
    let mut fields = serde_json::Map::new();
    if let Some(object) = supplied {
        for key in &transition.required_fields {
            if let Some(value) = object.get(key) {
                fields.insert(key.clone(), value.clone());
            }
        }
    }
    PlanOutcome::Ready(TransitionPlan {
        transition_id: transition.id.clone(),
        transition_name: transition.name.clone(),
        target_status: transition.to.clone(),
        fields: serde_json::Value::Object(fields),
    })
}

/// The exact POST body for a plan: `{"transition":{"id":..},"fields":{..}}`.
pub fn build_transition_payload(plan: &TransitionPlan) -> serde_json::Value {
    serde_json::json!({
        "transition": { "id": plan.transition_id },
        "fields": plan.fields,
    })
}

// --- response classification -------------------------------------------------

/// A completed (non-exception) HTTP response from the transition POST.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransitionHttpResponse {
    pub status: u32,
    pub body: String,
}

/// Failure shapes the daemon HTTP adapter can produce; mirrors the
/// `jira::client::JiraRequestError` taxonomy without importing it (this
/// module must compile standalone).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransitionHttpFailure {
    Api { status: u32, message: String },
    Network(String),
    Timeout,
    Cancelled,
}

/// What actually happened to a posted transition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransitionVerdict {
    /// 2xx: Jira applied the transition.
    Applied,
    /// Jira answered and refused — the board restores the origin status and
    /// shows the reason. Nothing was applied.
    Rejected(Rejection),
    /// The outcome is unknown (timeout, network loss, 5xx, cancel
    /// mid-flight): the POST may have landed. The board keeps the pending
    /// overlay and reconciles against the server — never a blind re-POST.
    Uncertain,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Rejection {
    /// 403: no permission for this transition.
    Forbidden,
    /// 400 without resolvable field errors: invalid/illegal transition.
    InvalidTransition { message: String },
    /// 400 whose `errors{}` names the missing screen fields.
    RequiredFields { fields: Vec<String> },
    /// Any other answered refusal (404 gone, 409, ...).
    Other { status: u32, message: String },
}

/// Classify one transition POST outcome. Only 2xx counts as applied; an
/// answered 4xx is a definite refusal; everything else is uncertain.
pub fn classify_transition_response(
    outcome: Result<TransitionHttpResponse, TransitionHttpFailure>,
) -> TransitionVerdict {
    match outcome {
        Ok(response) => {
            if (200..300).contains(&response.status) {
                return TransitionVerdict::Applied;
            }
            match response.status {
                403 => TransitionVerdict::Rejected(Rejection::Forbidden),
                400 => {
                    let fields = error_field_keys(&response.body);
                    if fields.is_empty() {
                        TransitionVerdict::Rejected(Rejection::InvalidTransition {
                            message: first_error_message(&response.body)
                                .unwrap_or_else(|| response.body.clone()),
                        })
                    } else {
                        TransitionVerdict::Rejected(Rejection::RequiredFields { fields })
                    }
                }
                status => TransitionVerdict::Rejected(Rejection::Other {
                    status,
                    message: first_error_message(&response.body)
                        .unwrap_or_else(|| response.body.clone()),
                }),
            }
        }
        Err(failure) => match failure {
            TransitionHttpFailure::Api { status, .. } if (500..600).contains(&status) => {
                TransitionVerdict::Uncertain
            }
            // An answered 4xx from the Api failure path is a definite refusal.
            TransitionHttpFailure::Api { status, message } => {
                classify_answered_failure(status, &message)
            }
            // Timeout / network loss / cancel mid-flight: the request may
            // have been applied server-side. Uncertain, never retried blind.
            TransitionHttpFailure::Network(_)
            | TransitionHttpFailure::Timeout
            | TransitionHttpFailure::Cancelled => TransitionVerdict::Uncertain,
        },
    }
}

fn classify_answered_failure(status: u32, message: &str) -> TransitionVerdict {
    match status {
        403 => TransitionVerdict::Rejected(Rejection::Forbidden),
        400 => TransitionVerdict::Rejected(Rejection::InvalidTransition {
            message: message.to_string(),
        }),
        status => TransitionVerdict::Rejected(Rejection::Other {
            status,
            message: message.to_string(),
        }),
    }
}

/// Field keys out of a Jira 400 body (`{"errors":{"field":"message"}}`).
fn error_field_keys(body: &str) -> Vec<String> {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|data| {
            data.get("errors")
                .and_then(serde_json::Value::as_object)
                .map(|errors| errors.keys().cloned().collect())
        })
        .unwrap_or_default()
}

fn first_error_message(body: &str) -> Option<String> {
    let data = serde_json::from_str::<serde_json::Value>(body).ok()?;
    let mut messages: Vec<String> = data
        .get("errorMessages")
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    if let Some(errors) = data.get("errors").and_then(serde_json::Value::as_object) {
        messages.extend(
            errors
                .values()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_string),
        );
    }
    messages.into_iter().next()
}

// --- pending overlay + reconciliation ---------------------------------------

/// One in-flight board move. It exists from the moment the POST is issued
/// until the board knows the truth, and is keyed by issue identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingMove {
    pub identity: String,
    pub site_id: String,
    pub issue_key: String,
    pub transition_id: String,
    pub transition_name: String,
    pub target_status_id: String,
    pub origin_status_id: String,
    pub state: PendingState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PendingState {
    /// POST in flight; the card shows the target status as pending.
    InFlight,
    /// The POST's outcome is unknown; the card stays pending and the board
    /// must reconcile before any further move on this issue.
    AwaitingReconciliation { attempts: u32 },
}

/// What the board must render/do after settling one POST outcome.
#[derive(Debug, Clone, PartialEq)]
pub enum Settlement {
    /// Remove the overlay; the issue's confirmed status is the target.
    Confirmed,
    /// Remove the overlay; restore the origin status and surface the reason.
    Restored { reason: String },
    /// Keep the overlay (now `AwaitingReconciliation`); fetch the server's
    /// current status before anything else happens to this issue.
    ReconcileNeeded,
    /// The identity had no pending move (a stale settle) — no-op.
    NoPending,
}

/// Why `begin` refused to start a move. A duplicate POST behind an
/// unresolved pending is structurally impossible.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BeginError {
    /// A move for this issue is already in flight or awaiting reconciliation.
    MoveAlreadyPending { identity: String },
}

/// The board's pending-move overlay: at most one unresolved move per issue
/// identity, settled only by a verdict or a reconciliation against real
/// server state.
#[derive(Debug, Default)]
pub struct TransitionBoard {
    pendings: HashMap<String, PendingMove>,
}

impl TransitionBoard {
    pub fn new() -> Self {
        Self::default()
    }

    /// Open the overlay for a planned move. Refuses while the same issue
    /// already has an unresolved move — that refusal is what makes a blind
    /// duplicate POST unreachable.
    pub fn begin(
        &mut self,
        issue: &IssueRef,
        plan: &TransitionPlan,
    ) -> Result<PendingMove, BeginError> {
        let identity = issue.identity();
        if let Some(existing) = self.pendings.get(&identity) {
            return Err(BeginError::MoveAlreadyPending {
                identity: existing.identity.clone(),
            });
        }
        let pending = PendingMove {
            identity: identity.clone(),
            site_id: issue.site_id.clone(),
            issue_key: issue.issue_key.clone(),
            transition_id: plan.transition_id.clone(),
            transition_name: plan.transition_name.clone(),
            target_status_id: plan.target_status.id.clone(),
            origin_status_id: issue.status.id.clone(),
            state: PendingState::InFlight,
        };
        self.pendings.insert(identity, pending.clone());
        Ok(pending)
    }

    pub fn pending(&self, identity: &str) -> Option<&PendingMove> {
        self.pendings.get(identity)
    }

    /// Settle a posted move's verdict.
    pub fn settle(&mut self, identity: &str, verdict: &TransitionVerdict) -> Settlement {
        let Some(pending) = self.pendings.get_mut(identity) else {
            return Settlement::NoPending;
        };
        match verdict {
            TransitionVerdict::Applied => {
                self.pendings.remove(identity);
                Settlement::Confirmed
            }
            TransitionVerdict::Rejected(rejection) => {
                self.pendings.remove(identity);
                Settlement::Restored {
                    reason: rejection_message(rejection),
                }
            }
            TransitionVerdict::Uncertain => {
                let attempts = match &pending.state {
                    PendingState::InFlight => 1,
                    PendingState::AwaitingReconciliation { attempts } => attempts + 1,
                };
                pending.state = PendingState::AwaitingReconciliation { attempts };
                Settlement::ReconcileNeeded
            }
        }
    }

    /// Reconcile an uncertain move against the server's real current status
    /// (a fresh `GET issue`, never the board's own projection):
    /// applied → confirm; still at origin → release the overlay honestly
    /// (an explicit user action may retry the same plan); anything else → a
    /// concurrent remote mutation won, adopt the server's status.
    pub fn reconcile(&mut self, identity: &str, current_status: &StatusRef) -> Reconciliation {
        let Some(pending) = self.pendings.get(identity) else {
            return Reconciliation::NoPending;
        };
        if current_status.id == pending.target_status_id {
            self.pendings.remove(identity);
            return Reconciliation::Applied;
        }
        let origin_status_id = pending.origin_status_id.clone();
        self.pendings.remove(identity);
        if current_status.id == origin_status_id {
            Reconciliation::NotApplied {
                status: current_status.clone(),
            }
        } else {
            Reconciliation::Superseded {
                status: current_status.clone(),
            }
        }
    }
}

/// The outcome of reconciling one uncertain move against server truth.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reconciliation {
    /// The transition actually landed; confirm the target status.
    Applied,
    /// The server still shows the origin status: the move did not land.
    /// Release the overlay; only an explicit user action may retry.
    NotApplied { status: StatusRef },
    /// A concurrent remote mutation moved the issue elsewhere; the board
    /// adopts the server's status (never hides it behind local success).
    Superseded { status: StatusRef },
    /// The identity had no pending move.
    NoPending,
}

fn rejection_message(rejection: &Rejection) -> String {
    match rejection {
        Rejection::Forbidden => {
            "Jira denied this transition (403). Check your permissions.".to_string()
        }
        Rejection::InvalidTransition { message } => {
            format!("Jira rejected this transition: {message}")
        }
        Rejection::RequiredFields { fields } => format!(
            "This transition requires fields before it can run: {}.",
            fields.join(", ")
        ),
        Rejection::Other { status, message } => {
            format!("Jira refused the move ({status}): {message}")
        }
    }
}

#[cfg(test)]
mod compile_seam {
    // The integration test compiles this file via `#[path]`; serde_json must
    // be reachable there, which it is (dev-dependency of drogon-core tests).
    #[test]
    fn serde_json_is_available_standalone() {
        let value = serde_json::json!({ "transitions": [] });
        assert!(
            value
                .get("transitions")
                .unwrap()
                .as_array()
                .unwrap()
                .is_empty()
        );
    }
}
