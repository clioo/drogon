//! Releases the terminal sessions finished automation runs leave behind.
//!
//! Every automation run starts its own headless session, and a session
//! record outlives its process until something closes it. Nothing did, so
//! an hourly automation added one exited tab (and one retained output ring)
//! to its workspace every hour, forever. The scheduler tick now calls
//! [`release_superseded_run_sessions`]: each automation keeps at most its
//! newest run's session, and an older run's session is released once it
//! has provably exited, after its output is copied into the run's stored
//! snapshot so run history keeps showing it.
//!
//! A live or unverifiable session is never released: forgetting a live PTY
//! would orphan it, and loss of contact never proves exit.

use std::collections::HashMap;

use rusqlite::params;

use super::records::{
    AutomationRun, AutomationRunOutputFormat, AutomationRunOutputSnapshot, AutomationRunStatus,
};
use super::storage as automations_storage;
use crate::Engine;

/// Upper bound on the output a released run keeps in its stored snapshot.
/// A headless run prints its final answer, far below this; the bound keeps
/// a chatty run from copying its whole 1 MiB ring into run history.
pub const RELEASED_SNAPSHOT_MAX_BYTES: usize = 64 * 1024;

/// One run whose session row still exists, with that row's identity.
struct RecordedRunSession {
    run: AutomationRun,
    session_id: String,
    session_incarnation: String,
    session_verdict: String,
}

/// A superseded run's session that has proven its exit, ready to release.
struct Release {
    run_id: String,
    session_id: String,
    session_incarnation: String,
    snapshot: Option<AutomationRunOutputSnapshot>,
}

/// Releases every exited session that belongs to an automation run older
/// than that automation's newest run still holding a session. Returns how
/// many sessions were released. Holds no database guard while reading a
/// session handle, and never holds both the database and session-map locks.
pub fn release_superseded_run_sessions(engine: &Engine, now_ms: f64) -> usize {
    let recorded = match recorded_run_sessions(engine) {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("[automations] run session scan failed: {e}");
            return 0;
        }
    };
    let mut released = 0;
    for candidate in superseded(recorded) {
        let Some(release) = prove_exit(engine, candidate, now_ms) else {
            continue;
        };
        match commit_release(engine, &release) {
            Ok(true) => {
                drop_handle(engine, &release.session_id, &release.session_incarnation);
                released += 1;
            }
            Ok(false) => {}
            Err(e) => eprintln!(
                "[automations] releasing session {} of run {} failed: {e}",
                release.session_id, release.run_id
            ),
        }
    }
    released
}

/// Runs joined to the session rows they still hold on this host. The join
/// keeps the scan proportional to the open sessions, not to run history.
fn recorded_run_sessions(
    engine: &Engine,
) -> Result<Vec<RecordedRunSession>, automations_storage::StorageError> {
    let conn = engine.db.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT r.payload_json, s.id, s.incarnation, s.verdict
         FROM automation_runs r
         JOIN sessions s ON s.id = json_extract(r.payload_json, '$.terminalSessionId')
         WHERE s.host_id = ?1",
    )?;
    let rows = stmt
        .query_map(params![engine.host_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(
            |(payload, session_id, session_incarnation, session_verdict)| {
                Ok(RecordedRunSession {
                    run: serde_json::from_str(&payload)?,
                    session_id,
                    session_incarnation,
                    session_verdict,
                })
            },
        )
        .collect()
}

/// Everything but each automation's newest recorded run, restricted to
/// finalized runs whose recorded incarnation is the row's own. A run still
/// `Dispatched` is left to the reconciler that finalizes it.
fn superseded(recorded: Vec<RecordedRunSession>) -> Vec<RecordedRunSession> {
    let mut by_automation: HashMap<String, Vec<RecordedRunSession>> = HashMap::new();
    for row in recorded {
        by_automation
            .entry(row.run.automation_id.clone())
            .or_default()
            .push(row);
    }
    let mut out = Vec::new();
    for (_, mut rows) in by_automation {
        rows.sort_by(|a, b| {
            b.run
                .created_at
                .total_cmp(&a.run.created_at)
                .then_with(|| b.run.id.cmp(&a.run.id))
        });
        out.extend(rows.into_iter().skip(1).filter(|row| {
            row.run.status != AutomationRunStatus::Dispatched
                && row
                    .run
                    .session_incarnation
                    .as_ref()
                    .is_none_or(|inc| *inc == row.session_incarnation)
        }));
    }
    out
}

/// Proves the candidate's session exited and captures its output. With a
/// handle in this process the handle's own verdict is the proof and its
/// ring is the output; without one (a prior daemon instance) only a stored
/// `exited` verdict proves it, and there is no output left to capture.
fn prove_exit(engine: &Engine, row: RecordedRunSession, now_ms: f64) -> Option<Release> {
    let handle = engine
        .sessions
        .lock()
        .unwrap()
        .get(&row.session_id)
        .cloned();
    let snapshot = match handle {
        Some(handle) => {
            if handle.incarnation != row.session_incarnation {
                return None;
            }
            let verdict = crate::session::snapshot(&handle)
                .get("verdict")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string);
            if verdict.as_deref() != Some("exited") {
                return None;
            }
            if row.run.output_snapshot.is_some() {
                None
            } else {
                let tail = crate::session::read_tail(&handle);
                released_snapshot(
                    &String::from_utf8_lossy(&tail.bytes),
                    tail.truncated,
                    now_ms,
                )
            }
        }
        None => {
            if row.session_verdict != "exited" {
                return None;
            }
            None
        }
    };
    Some(Release {
        run_id: row.run.id,
        session_id: row.session_id,
        session_incarnation: row.session_incarnation,
        snapshot,
    })
}

/// The plain-text snapshot a released run keeps: terminal markup reduced
/// exactly as the run detail does, trimmed, and bounded to the newest
/// [`RELEASED_SNAPSHOT_MAX_BYTES`] on a character boundary. Empty output
/// yields no snapshot rather than an empty one.
pub fn released_snapshot(
    raw: &str,
    ring_truncated: bool,
    captured_at: f64,
) -> Option<AutomationRunOutputSnapshot> {
    let text = super::direct::plain_text_snapshot_tail(raw);
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    let (content, cut) = if text.len() > RELEASED_SNAPSHOT_MAX_BYTES {
        let mut start = text.len() - RELEASED_SNAPSHOT_MAX_BYTES;
        while !text.is_char_boundary(start) {
            start += 1;
        }
        (&text[start..], true)
    } else {
        (text, false)
    };
    Some(AutomationRunOutputSnapshot {
        format: AutomationRunOutputFormat::PlainText,
        content: content.to_string(),
        captured_at,
        truncated: ring_truncated || cut,
    })
}

/// Stores the snapshot and forgets the session row in one transaction,
/// guarded on the row still carrying the incarnation that proved its exit
/// (a user close racing this tick simply wins). Returns whether the row was
/// forgotten here.
fn commit_release(
    engine: &Engine,
    release: &Release,
) -> Result<bool, automations_storage::StorageError> {
    let conn = engine.db.lock().unwrap();
    let tx = automations_storage::begin_immediate(&conn)?;
    let forgotten = tx.execute(
        "DELETE FROM sessions WHERE id = ?1 AND incarnation = ?2",
        params![release.session_id, release.session_incarnation],
    )?;
    if forgotten != 1 {
        return Ok(false);
    }
    if let Some(snapshot) = &release.snapshot
        && let Some(mut run) = automations_storage::get_automation_run(&tx, &release.run_id)?
        && run.output_snapshot.is_none()
    {
        run.output_snapshot = Some(snapshot.clone());
        automations_storage::upsert_automation_run(&tx, &run)?;
    }
    tx.commit()?;
    Ok(true)
}

/// Drops the released session's handle (and its output ring), only when
/// the map still holds the incarnation that was released.
fn drop_handle(engine: &Engine, session_id: &str, incarnation: &str) {
    let mut sessions = engine.sessions.lock().unwrap();
    if sessions
        .get(session_id)
        .is_some_and(|handle| handle.incarnation == incarnation)
    {
        sessions.remove(session_id);
    }
}
