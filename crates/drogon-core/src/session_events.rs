//! Push feed for session agent-state changes (R16-BF2).
//!
//! The renderer's worktree card and tab badge used to learn about
//! session/agent-state changes on a poll cadence (`session.list` every 2 s
//! from main's notifications watcher), which the R16-BF harness measured at
//! ~1.3 s median for `update:worktree-card`. The fork pushes instead: hook
//! event → main process → IPC event → renderer store update, within a frame
//! or two (reference: `src/main/agent-hooks/hook-post-command.ts` posts the
//! hook payload to the main-process hook server;
//! `src/main/agent-hooks/agent-status-pane-index.ts` indexes the snapshot per
//! pane; `src/renderer/src/runtime/sync-runtime-graph/agent-status-projection.ts`
//! projects it into the store; in-band status also flows over OSC in
//! `src/shared/agent-status-osc.ts` → `pty-output-processor.ts`).
//!
//! This module is the daemon half of the same shape, adapted to this repo's
//! request/response transport: session state changes are recorded here the
//! moment they are observed (hook wait/clear, PTY activity, admission, exit)
//! and served to main's long-polling bridge via `session.events.poll`.
//! Main forwards one IPC event per change (`ui:session-state-changed`, the
//! channel the renderer already merges); the 2 s `session.list` poll stays
//! as a reconciliation fallback.
//!
//! Design notes:
//! - One process-global log: the observation points (PTY reader threads,
//!   `persist_exit`) only hold a `SessionHandle`, never the `Engine`, so a
//!   per-engine log is unreachable from exactly the threads that must emit.
//! - Per-session latest wins: the log keeps only the newest event per
//!   session id, so a `/bin/yes` flood can never grow it (bounded by the
//!   session count, hard-capped) and a slow poller always converges on the
//!   truth instead of replaying history.
//! - `record_snapshot` is transition-guarded: it stores (and sequences) an
//!   event only when the session's `(agentState, agentStateAt)` differs from
//!   what was last stored, so steady-state re-observations stay silent.
//! - Daemon → main ordering uses the monotonic `seq` (the poll cursor, and
//!   the resync signal together with `bootId` from the poll response).
//!   Main → renderer ordering uses `agentStateAt` compare in the renderer's
//!   `applySessionStatePush`: the daemon clock is deliberately
//!   second-resolution (`humantime_rfc3339`), so same-second wait→clear pairs
//!   share a stamp and are ordered by the leave-`needs_input` rule there;
//!   the 2 s poll fallback self-heals any residual.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

/// One pushed session-state change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SessionStateEvent {
    pub(crate) seq: u64,
    pub(crate) session_id: String,
    pub(crate) workspace_id: String,
    pub(crate) agent_state: String,
    pub(crate) agent_state_at: Option<String>,
    pub(crate) agent_prompt_preview: Option<String>,
    pub(crate) cache_idle_at: Option<String>,
}

impl SessionStateEvent {
    fn wire(&self) -> Value {
        json!({
            "seq": self.seq,
            "sessionId": self.session_id,
            "workspaceId": self.workspace_id,
            "agentState": self.agent_state,
            "agentStateAt": self.agent_state_at,
            "agentPromptPreview": self.agent_prompt_preview,
            "cacheIdleAt": self.cache_idle_at,
        })
    }
}

/// Per-session latest events plus the global sequence. Never persisted: a
/// daemon restart resets the log and the `bootId` in the poll response tells
/// main to resync from zero.
#[derive(Debug, Default)]
pub(crate) struct SessionEventLog {
    seq: u64,
    latest: HashMap<String, SessionStateEvent>,
}

/// Hard cap on tracked sessions; beyond it the stalest entries are evicted.
/// Live daemons track dozens of sessions — this is orders of magnitude above
/// any real load and only bounds a leak (e.g. forgotten rows never polled).
const MAX_TRACKED_SESSIONS: usize = 2048;

impl SessionEventLog {
    /// Records a `session::snapshot`-shaped value. Returns the sequenced
    /// event when the session's `(agentState, agentStateAt)` moved, `None`
    /// for steady-state re-observations and for values that carry no session
    /// identity. Same-input idempotent: recording one snapshot twice stores
    /// (and sequences) exactly one event.
    pub(crate) fn record(&mut self, snapshot: &Value) -> Option<SessionStateEvent> {
        let session_id = snapshot.get("id")?.as_str()?;
        let workspace_id = snapshot.get("workspaceId")?.as_str()?;
        let agent_state = snapshot.get("agentState")?.as_str()?;
        let agent_state_at = snapshot
            .get("agentStateAt")
            .and_then(Value::as_str)
            .map(str::to_string);
        let agent_prompt_preview = snapshot
            .get("agentPromptPreview")
            .and_then(Value::as_str)
            .map(str::to_string);
        let cache_idle_at = snapshot
            .get("cacheIdleAt")
            .and_then(Value::as_str)
            .map(str::to_string);
        if let Some(known) = self.latest.get(session_id)
            && known.agent_state == agent_state
            && known.agent_state_at == agent_state_at
            && known.agent_prompt_preview == agent_prompt_preview
            && known.cache_idle_at == cache_idle_at
        {
            return None;
        }
        self.seq += 1;
        if self.latest.len() >= MAX_TRACKED_SESSIONS
            && !self.latest.contains_key(session_id)
            && let Some(victim) = self
                .latest
                .iter()
                .min_by_key(|(_, event)| event.seq)
                .map(|(id, _)| id.clone())
        {
            self.latest.remove(&victim);
        }
        let event = SessionStateEvent {
            seq: self.seq,
            session_id: session_id.to_string(),
            workspace_id: workspace_id.to_string(),
            agent_state: agent_state.to_string(),
            agent_state_at,
            agent_prompt_preview,
            cache_idle_at,
        };
        self.latest.insert(session_id.to_string(), event.clone());
        Some(event)
    }

    /// Events sequenced after `after_seq`, oldest first. A poller that fell
    /// behind (or resyncs after a daemon restart) converges on the latest
    /// truth per session rather than replaying every intermediate state.
    pub(crate) fn since(&self, after_seq: u64) -> Vec<SessionStateEvent> {
        let mut events: Vec<SessionStateEvent> = self
            .latest
            .values()
            .filter(|event| event.seq > after_seq)
            .cloned()
            .collect();
        events.sort_by_key(|event| event.seq);
        events
    }

    pub(crate) fn current_seq(&self) -> u64 {
        self.seq
    }
}

fn shared() -> &'static Mutex<SessionEventLog> {
    static LOG: OnceLock<Mutex<SessionEventLog>> = OnceLock::new();
    LOG.get_or_init(|| Mutex::new(SessionEventLog::default()))
}

/// Records one session snapshot into the process-global push log. See
/// [`SessionEventLog::record`].
pub(crate) fn record_snapshot(snapshot: &Value) -> Option<SessionStateEvent> {
    shared().lock().unwrap().record(snapshot)
}

/// Blocks (bounded) until an event newer than `after_seq` exists, then
/// returns the pending events plus the current sequence. A zero `wait_ms`
/// degrades to a single non-blocking drain. Precedent for blocking inside an
/// RPC handler: `desktop_relay_rpc::relay_roundtrip` (and the server is one
/// thread per client, so a blocked poll never starves other calls).
pub(crate) fn poll(after_seq: u64, wait_ms: u64) -> (Vec<SessionStateEvent>, u64) {
    let deadline = Instant::now() + Duration::from_millis(wait_ms);
    loop {
        {
            let log = shared().lock().unwrap();
            let events = log.since(after_seq);
            if !events.is_empty() {
                return (events, log.current_seq());
            }
            if Instant::now() >= deadline {
                return (Vec::new(), log.current_seq());
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Current sequence without blocking; lets tests scope their poll to events
/// recorded after the baseline even while other tests emit concurrently.
#[cfg(test)]
pub(crate) fn current_seq() -> u64 {
    shared().lock().unwrap().current_seq()
}

pub(crate) fn events_wire(events: &[SessionStateEvent]) -> Vec<Value> {
    events.iter().map(SessionStateEvent::wire).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn snapshot(id: &str, state: &str, at: Option<&str>) -> Value {
        json!({
            "id": id,
            "workspaceId": "w1",
            "agentState": state,
            "agentStateAt": at,
        })
    }

    #[test]
    fn record_sequences_only_transitions_and_replays_in_order() {
        let mut log = SessionEventLog::default();
        let first = log.record(&snapshot("s1", "working", Some("t1"))).unwrap();
        assert_eq!(first.seq, 1);
        // Same input twice: idempotent, no second event.
        assert!(log.record(&snapshot("s1", "working", Some("t1"))).is_none());
        let second = log.record(&snapshot("s1", "idle", Some("t1"))).unwrap();
        assert_eq!(second.seq, 2);
        let events = log.since(0);
        // Per-session latest wins: one entry, the newest truth.
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].agent_state, "idle");
        assert!(log.since(2).is_empty());
        assert_eq!(log.current_seq(), 2);
    }

    #[test]
    fn metadata_changes_push_without_an_agent_state_transition() {
        let mut log = SessionEventLog::default();
        let mut row = snapshot("s1", "working", Some("t1"));
        log.record(&row).unwrap();
        row["agentPromptPreview"] = json!("Refactor authentication");
        assert_eq!(log.record(&row).unwrap().seq, 2);
        assert!(log.record(&row).is_none());
        row["cacheIdleAt"] = json!("t2");
        assert_eq!(log.record(&row).unwrap().wire()["cacheIdleAt"], "t2");
        row["cacheIdleAt"] = Value::Null;
        let cleared = log.record(&row).unwrap();
        assert_eq!(cleared.seq, 4);
        assert!(cleared.wire()["cacheIdleAt"].is_null());
    }

    #[test]
    fn record_keeps_one_entry_per_session_and_cursors_scope() {
        let mut log = SessionEventLog::default();
        log.record(&snapshot("s1", "working", Some("t1")));
        log.record(&snapshot("s2", "needs_input", Some("t2")));
        let all = log.since(0);
        assert_eq!(all.len(), 2);
        assert!(all[0].seq < all[1].seq);
        let tail = log.since(1);
        assert_eq!(tail.len(), 1);
        assert_eq!(tail[0].session_id, "s2");
    }

    #[test]
    fn record_refuses_snapshots_without_identity() {
        let mut log = SessionEventLog::default();
        assert!(log.record(&json!({"agentState": "working"})).is_none());
        assert!(log.record(&json!({"id": "s1"})).is_none());
        assert_eq!(log.current_seq(), 0);
    }

    #[test]
    fn exited_and_unknown_transition_like_any_state() {
        let mut log = SessionEventLog::default();
        assert!(log.record(&snapshot("s1", "unknown", None)).is_some());
        assert!(log.record(&snapshot("s1", "unknown", None)).is_none());
        let exited = log.record(&snapshot("s1", "exited", None)).unwrap();
        assert_eq!(exited.agent_state, "exited");
        assert_eq!(exited.agent_state_at, None);
    }

    #[cfg(unix)]
    mod push_feed {
        use crate::Engine;
        use drogon_protocol::{PROTOCOL_VERSION, Request};
        use serde_json::{Value, json};

        use super::current_seq;

        fn invoke(engine: &Engine, id: &str, method: &str, params: Value) -> Value {
            let response = engine.dispatch(Request {
                protocol: PROTOCOL_VERSION,
                request_id: id.into(),
                auth: None,
                method: method.into(),
                params,
            });
            assert!(response.ok, "{method}: {:?}", response.error);
            response.result.unwrap()
        }

        fn event_for(events: &Value, id: &str) -> Value {
            events
                .as_array()
                .unwrap()
                .iter()
                .find(|event| event["sessionId"] == id)
                .unwrap_or_else(|| panic!("no push event for {id} in {events}"))
                .clone()
        }

        /// Drains until an event for `id` appears or the timeout elapses.
        /// A blocking `session.events.poll` unblocks on ANY newer event, so
        /// under parallel tests a foreign event can win the wakeup while our
        /// (possibly async, e.g. reader-thread) record is still in flight.
        /// Chasing `nextSeq` is lossless: our event sequences ahead of every
        /// observed cursor when it lands.
        fn wait_for_event(engine: &Engine, id: &str, mut after_seq: u64) -> (Value, u64) {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            loop {
                let polled = invoke(
                    engine,
                    "poll-wait-event",
                    "session.events.poll",
                    json!({"afterSeq": after_seq, "waitMs": 0}),
                );
                if let Some(found) = polled["events"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|event| event["sessionId"] == id)
                {
                    return (found.clone(), polled["nextSeq"].as_u64().unwrap());
                }
                after_seq = polled["nextSeq"].as_u64().unwrap();
                assert!(
                    std::time::Instant::now() < deadline,
                    "timed out waiting for a push event for {id}"
                );
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }

        #[test]
        fn hook_wait_clear_and_exit_flow_as_push_events() {
            let dir = tempfile::tempdir().unwrap();
            let engine = Engine::open(dir.path()).unwrap();
            let base = current_seq();
            let workspace = invoke(
                &engine,
                "workspace",
                "workspace.register",
                json!({"path": dir.path()}),
            );
            let session = invoke(
                &engine,
                "start",
                "session.start",
                json!({
                    "workspaceId": workspace["id"],
                    "command": "/bin/sh",
                    "args": ["-c", "exec sleep 30"],
                }),
            );
            let id = session["id"].as_str().unwrap();
            let incarnation = session["incarnation"].as_str().unwrap();

            // Admission itself is a birth event even before any output.
            let admission = invoke(
                &engine,
                "poll-admit",
                "session.events.poll",
                json!({"afterSeq": base, "waitMs": 0}),
            );
            assert!(!admission["bootId"].as_str().unwrap().is_empty());
            let birth = event_for(&admission["events"], id);
            assert_eq!(birth["agentState"], "unknown");
            let cursor = admission["nextSeq"].as_u64().unwrap();

            // A harness wait signal pushes `needs_input` immediately.
            let waited = invoke(
                &engine,
                "hook-wait",
                "session.hook_event",
                json!({"sessionId": id, "incarnation": incarnation, "event": "ToolApprovalRequested"}),
            );
            assert_eq!(waited["agentState"], "needs_input");
            let pushed = invoke(
                &engine,
                "poll-wait",
                "session.events.poll",
                json!({"afterSeq": cursor, "waitMs": 0}),
            );
            let wait_event = event_for(&pushed["events"], id);
            assert_eq!(wait_event["agentState"], "needs_input");
            assert_eq!(wait_event["agentStateAt"], waited["agentStateAt"]);
            assert_eq!(wait_event["workspaceId"], session["workspaceId"]);
            let cursor = pushed["nextSeq"].as_u64().unwrap();

            // Draining twice is idempotent: the second drain carries nothing
            // new for us (foreign tests may interleave their own events, and
            // the cursor may advance past them — both are fine).
            let redrain = invoke(
                &engine,
                "poll-redrain",
                "session.events.poll",
                json!({"afterSeq": cursor, "waitMs": 0}),
            );
            assert!(
                redrain["events"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|event| event["sessionId"] != id)
            );
            assert!(redrain["nextSeq"].as_u64().unwrap() >= cursor);

            // PTY output on a waiting session clears the wait and pushes the
            // cleared state in the same step. Regression cover: the record
            // used to snapshot before the clear ran, so the push carried the
            // stale `needs_input` (a no-change no-op) and the cleared state
            // never pushed at all.
            invoke(
                &engine,
                "write",
                "session.write",
                json!({"sessionId": id, "incarnation": incarnation, "dataBase64": "eA=="}),
            );
            // The reader thread records the clear asynchronously, so drain
            // until OUR event lands: a blocking poll can wake early on a
            // foreign test's event and return without it.
            let (active_event, cursor) = wait_for_event(&engine, id, cursor);
            assert_eq!(active_event["agentState"], "working");

            // The resumption signal clears back out of `needs_input`. The
            // session already works again from the echo above, so this may
            // legitimately push nothing new — but never a `needs_input`.
            let cleared = invoke(
                &engine,
                "hook-clear",
                "session.hook_event",
                json!({"sessionId": id, "incarnation": incarnation, "event": "AgentStart"}),
            );
            assert_ne!(cleared["agentState"], "needs_input");
            let repushed = invoke(
                &engine,
                "poll-clear",
                "session.events.poll",
                json!({"afterSeq": cursor, "waitMs": 0}),
            );
            for event in repushed["events"].as_array().unwrap() {
                if event["sessionId"] == id {
                    assert_ne!(event["agentState"], "needs_input");
                }
            }
            let cursor = repushed["nextSeq"].as_u64().unwrap();

            // Stopping pushes the terminal `exited` truth with no stamp.
            let stopped = invoke(
                &engine,
                "stop",
                "session.stop",
                json!({"sessionId": id, "incarnation": incarnation}),
            );
            assert_eq!(stopped["verdict"], "exited");
            let (exit_event, _cursor) = wait_for_event(&engine, id, cursor);
            assert_eq!(exit_event["agentState"], "exited");
            assert!(exit_event["agentStateAt"].is_null());
        }
    }

    #[test]
    fn wire_shape_carries_the_renderer_fields() {
        let mut log = SessionEventLog::default();
        let event = log
            .record(&snapshot("s9", "needs_input", Some("t9")))
            .unwrap();
        assert_eq!(
            event.wire(),
            json!({
                "seq": event.seq,
                "sessionId": "s9",
                "workspaceId": "w1",
                "agentState": "needs_input",
                "agentStateAt": "t9",
                "agentPromptPreview": null,
                "cacheIdleAt": null,
            })
        );
    }
}
