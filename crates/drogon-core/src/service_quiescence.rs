//! `runtime.shutdown` per `docs/migration/service-quiescence-contract.md`.
//! `Engine` fields (`lifecycle_gate`, `quiescent`), dispatch wiring, the
//! ledger call, and the exclusive admission gate's acquire/retain span all
//! live in `lib.rs` because they are shared with every other mutating
//! method; this module owns only the wire-facing input fences and the
//! atomic all-exited admission check that the gate guards.

use serde_json::{Value, json};

use drogon_protocol::RpcError;

use crate::{Engine, error, require_str};

/// "Validate these fences before looking up historical receipts: an old
/// instance's receipt cannot stop a replacement." Called by `lib.rs` before
/// the request-ledger lookup, so a stale requestId from a prior incarnation
/// never reaches the ledger for this method at all.
pub(crate) fn validate_fences(engine: &Engine, params: &Value) -> Result<(), RpcError> {
    let host_id = require_str(params, "hostId")?;
    if host_id != engine.host_id {
        return Err(error::unsupported_host());
    }
    let service_instance_id = require_str(params, "serviceInstanceId")?;
    if service_instance_id != engine.service_instance_id {
        return Err(error::stale_incarnation());
    }
    Ok(())
}

/// The admission *check*, run by `do_runtime_shutdown` while it holds the
/// exclusive lifecycle gate (try-acquired there and retained through the
/// durable receipt persist and the freeze store — see its doc comment for
/// why that span is atomic). A single query decides whether every persisted
/// session has positively exited. Never mutates a session itself: a live,
/// pending or unverifiable row is refused, not stopped, on the caller's
/// behalf.
pub(crate) fn check_all_sessions_exited(engine: &Engine) -> Result<Value, RpcError> {
    let unsettled: i64 = {
        let conn = engine.db.lock().unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM sessions WHERE verdict != 'exited'",
            [],
            |r| r.get(0),
        )
        .map_err(error::from_sqlite)?
    };
    if unsettled > 0 {
        return Err(error::runtime_busy(
            "one or more sessions are pending, live or unverifiable",
        ));
    }
    Ok(json!({
        "hostId": engine.host_id,
        "serviceInstanceId": engine.service_instance_id,
        "accepted": true,
    }))
}

#[cfg(test)]
mod admission_window_tests {
    use std::sync::{Arc, Condvar, Mutex};
    use std::time::{Duration, Instant};

    use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
    use serde_json::{Value, json};

    use crate::Engine;

    fn call(engine: &Engine, request_id: &str, method: &str, params: Value) -> Response {
        engine.dispatch(Request {
            protocol: PROTOCOL_VERSION,
            request_id: request_id.into(),
            auth: None,
            method: method.into(),
            params,
        })
    }

    fn ok(response: Response) -> Value {
        assert!(response.ok, "expected ok: {:?}", response.error);
        response.result.unwrap()
    }

    fn err_code(response: Response) -> String {
        assert!(response.error.is_some(), "expected error: {:?}", response);
        response.error.unwrap().code
    }

    fn fences(engine: &Engine) -> Value {
        let status = ok(call(engine, "status", "status", json!({})));
        json!({
            "hostId": status["hostId"],
            "serviceInstanceId": status["serviceInstanceId"],
        })
    }

    #[derive(Clone, Copy, PartialEq, PartialOrd)]
    enum Phase {
        Idle,
        Signaled,
        Entered,
    }

    fn set_phase(phase: &(Mutex<Phase>, Condvar), target: Phase) {
        let (lock, cvar) = phase;
        *lock.lock().unwrap() = target;
        cvar.notify_all();
    }

    fn wait_for_phase(phase: &(Mutex<Phase>, Condvar), target: Phase, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let (lock, cvar) = phase;
        let mut guard = lock.lock().unwrap();
        while *guard < target {
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            let (next, _) = cvar.wait_timeout(guard, deadline - now).unwrap();
            guard = next;
        }
        true
    }

    /// P1 regression for the exact window the admission fix must close:
    /// from the durable persist of the accepted receipt until the
    /// `quiescent` store, the exclusive lifecycle admission must still be
    /// held. The instance-scoped `pre_freeze_hook` seam fires precisely
    /// inside that window, records the gate state there, and releases a
    /// real `workspace.register` through the public dispatch path.
    ///
    /// Determinism under load: the load-bearing assertion is the gate state
    /// recorded synchronously inside the window on the shutdown thread
    /// itself — a purely structural fact, no wall clock involved. The
    /// mutator's own outcome (`runtime_busy`, zero registered workspaces) is
    /// checked after a plain `join()`, so it is order/outcome-based too;
    /// only the handshake waits carry timeouts, and only so a broken
    /// handshake fails with a clear message instead of hanging.
    #[test]
    fn a_mutation_cannot_complete_between_durable_admission_and_freeze() {
        let dir = tempfile::tempdir().unwrap();
        let engine = Arc::new(Engine::open(dir.path()).unwrap());
        let params = fences(&engine);

        let phase = Arc::new((Mutex::new(Phase::Idle), Condvar::new()));
        // `None` = not yet observed; `Some(shared)` = inside the durable-
        // admission-to-freeze window the shared gate side was still
        // acquirable, i.e. a fresh mutation could have been admitted there.
        let gate_shared_during_window: Arc<Mutex<Option<bool>>> = Arc::new(Mutex::new(None));

        {
            let phase = phase.clone();
            let gate_shared_during_window = gate_shared_during_window.clone();
            // Instance-scoped seam: this hook fires only for shutdowns
            // dispatched through THIS engine, so parallel tests can never
            // consume each other's hook.
            *engine
                .pre_freeze_hook
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                Some(Box::new(move |engine: &Engine| {
                    // We are exactly between the durable receipt persist and
                    // the freeze store. Record the structural fact first —
                    // on the fixed engine the write guard is held right
                    // here, so the shared side must NOT be acquirable,
                    // whatever the machine load.
                    *gate_shared_during_window.lock().unwrap() =
                        Some(engine.lifecycle_gate.try_read().is_ok());
                    // Then release the mutator and let it race the
                    // remaining window for the behavioral half of the proof.
                    set_phase(&phase, Phase::Signaled);
                    assert!(
                        wait_for_phase(&phase, Phase::Entered, Duration::from_secs(30)),
                        "mutator never entered dispatch",
                    );
                }));
        }

        let m_engine = engine.clone();
        let m_phase = phase.clone();
        let m_path = dir.path().to_path_buf();
        let mutator = std::thread::spawn(move || {
            assert!(
                wait_for_phase(&m_phase, Phase::Signaled, Duration::from_secs(30)),
                "hook never released the mutator",
            );
            set_phase(&m_phase, Phase::Entered);
            // Entered is recorded before dispatch so the hook's observation
            // covers the whole gate/flag check path, not just its tail.
            call(
                &m_engine,
                "post-receipt-mutation",
                "workspace.register",
                json!({"path": m_path.to_string_lossy()}),
            )
        });

        let receipt = ok(call(
            &engine,
            "shutdown-during-window",
            "runtime.shutdown",
            params,
        ));
        assert_eq!(receipt["accepted"], true);
        assert!(engine.is_quiescent());

        assert_eq!(
            *gate_shared_during_window.lock().unwrap(),
            Some(false),
            "P1: between the durable admission receipt and the freeze \
             store the shared lifecycle side was still acquirable, so a \
             new mutation could be admitted there"
        );

        let mutation = mutator.join().unwrap();
        assert_eq!(
            err_code(mutation),
            "runtime_busy",
            "a mutation released inside the pre-freeze window must be \
             refused once the freeze lands, never admitted"
        );
        let listed = ok(call(&engine, "ws-list", "workspace.list", json!({})));
        assert_eq!(
            listed["workspaces"].as_array().unwrap().len(),
            0,
            "no workspace row may exist for a mutation that raced the freeze"
        );
    }

    /// The shutdown admission must try-acquire the exclusive lifecycle gate
    /// and refuse `runtime_busy` immediately while any mutation holds the
    /// shared side — never queue behind in-flight work. Unrelated read-only
    /// I/O must keep working while the gate is held: it is never serialized
    /// by the lifecycle gate at all.
    ///
    /// No elapsed-time bound: if the shutdown ever blocked on the gate, this
    /// test would deadlock on itself (the guard below is released only at
    /// the end), which the test harness reports — a load-independent
    /// failure mode, unlike a wall-clock threshold.
    #[test]
    fn shutdown_refuses_fast_while_a_mutation_holds_the_gate_and_normal_io_still_runs() {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::open(dir.path()).unwrap();
        let params = fences(&engine);

        // Held exactly the way `Engine::mutating` holds it mid-mutation,
        // for the whole rest of the test.
        let read_gate = engine.lifecycle_gate.read().unwrap();
        let code = err_code(call(&engine, "shutdown-race", "runtime.shutdown", params));
        assert_eq!(code, "runtime_busy");
        assert!(!engine.is_quiescent());

        assert!(
            call(&engine, "list", "session.list", json!({})).ok,
            "read-only I/O must not be serialized behind the lifecycle gate"
        );
        assert!(call(&engine, "status-2", "status", json!({})).ok);
        drop(read_gate);
    }
}
