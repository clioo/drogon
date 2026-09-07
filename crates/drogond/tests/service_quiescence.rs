//! Server-side admission evidence for `runtime.shutdown`
//! (`docs/migration/service-quiescence-contract.md`).
//!
//! These tests exercise the real Unix-socket server: core admission (fences,
//! durable receipt, `Engine::is_quiescent`) already exists in `drogon-core`;
//! what is proven here is the *server's* side of the contract — the reply is
//! delivered (or delivery is known to have failed) before the listener stops,
//! the owned serving thread actually exits, the exclusive data-dir lock is
//! released, idle connections are drained rather than waited out, and every
//! refusal leaves the service fully available.
//!
//! Every fixture is test-owned and self-terminating: the accept source is
//! nonblocking with an unbounded transient budget plus an `abort` switch that
//! feeds the loop a fatal `EBADF`, so even against a pre-quiescence server
//! (which never observes shutdown) the serving thread ends deterministically
//! instead of leaking.

#![cfg(unix)]

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

/// Generous upper bound for the owned serving thread to observe an authorized
/// shutdown. Every quiescence mechanism here is millisecond-scale; this is a
/// liveness bound, not an expected duration.
const SHUTDOWN_EXIT_DEADLINE: Duration = Duration::from_secs(3);

/// One client connection with its own reader so sequential requests on the
/// same socket cannot lose buffered bytes between helper calls.
struct Client {
    writer: UnixStream,
    reader: BufReader<UnixStream>,
}

impl Client {
    fn send(&mut self, request: &Request) {
        let mut bytes = serde_json::to_vec(request).unwrap();
        bytes.push(b'\n');
        self.writer.write_all(&bytes).unwrap();
    }

    fn recv(&mut self) -> Response {
        let mut line = String::new();
        self.reader.read_line(&mut line).unwrap();
        serde_json::from_str(&line).unwrap()
    }
}

/// Owns the whole serving stack the way `drogond::serve` does — exclusive
/// data-dir lock, endpoint, token, engine, accept loop on its own thread —
/// and guarantees the serving thread terminates even when the server under
/// test never observes quiescence (the RED configuration).
struct ServingFixture {
    dir: tempfile::TempDir,
    token: String,
    socket_path: std::path::PathBuf,
    thread: Option<std::thread::JoinHandle<std::io::Result<()>>>,
    abort: Arc<AtomicBool>,
}

impl ServingFixture {
    fn start() -> Self {
        Self::start_with_idle_timeout(Duration::from_secs(60))
    }

    fn start_with_idle_timeout(idle_timeout: Duration) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let token = drogond::auth::ensure_token(dir.path()).unwrap();
        let engine = Arc::new(Engine::open(dir.path()).unwrap());
        let socket_path = dir.path().join(drogond::endpoint::SOCKET_FILE_NAME);
        let dir_path = dir.path().to_path_buf();

        // The serving thread owns the whole `drogond::serve` stack in order —
        // exclusive lock first, then the endpoint — so when it exits, the
        // lock release through the normal drop path is itself under test.
        //
        // The accept source is nonblocking so the serving thread can never
        // sleep in `accept` beyond the test's control: against the
        // quiescence-aware loop the authorized flag is observed at the top
        // of each accept retry; against the pre-quiescence server a
        // `WouldBlock` is just a transient error. The unbounded budget
        // keeps a RED server retrying (it never self-exits, which is
        // exactly what the exit assertions must catch), and `abort` feeds
        // the loop a fatal EBADF so even a RED serving thread terminates
        // deterministically once the test gives up.
        // Accepted sockets are put back to blocking so handler semantics
        // match production exactly (a paused client must not look like a
        // transport error to its handler).
        let abort = Arc::new(AtomicBool::new(false));
        let abort_for_loop = abort.clone();
        let engine_for_loop = engine;
        let token_for_loop: Arc<str> = Arc::from(token.as_str());
        let thread = std::thread::spawn(move || -> std::io::Result<()> {
            let _lock = drogond::lock::acquire_exclusive(&dir_path)?;
            let listener = drogond::endpoint::establish(&dir_path)?;
            listener.set_nonblocking(true)?;
            drogond::server::run_accept_loop(
                move || {
                    if abort_for_loop.load(Ordering::Acquire) {
                        return Err(std::io::Error::from_raw_os_error(libc::EBADF));
                    }
                    listener.accept().map(|(stream, _)| {
                        let _ = stream.set_nonblocking(false);
                        stream
                    })
                },
                engine_for_loop,
                token_for_loop,
                64,
                idle_timeout,
                Duration::from_millis(1),
                u32::MAX,
            )
        });
        // connect() to a bound-but-not-yet-accepting socket is queued in the
        // kernel backlog, so this is a generous margin, not a requirement.
        std::thread::sleep(Duration::from_millis(20));
        ServingFixture {
            dir,
            token,
            socket_path,
            thread: Some(thread),
            abort,
        }
    }

    fn connect(&self) -> Client {
        let stream = UnixStream::connect(&self.socket_path).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        Client {
            writer: stream.try_clone().unwrap(),
            reader: BufReader::new(stream),
        }
    }

    fn request(&self, request_id: &str, method: &str, params: Value) -> Request {
        self.request_with_auth(request_id, method, params, Some(self.token.as_str()))
    }

    fn request_with_auth(
        &self,
        request_id: &str,
        method: &str,
        params: Value,
        auth: Option<&str>,
    ) -> Request {
        serde_json::from_value(json!({
            "protocol": PROTOCOL_VERSION,
            "requestId": request_id,
            "auth": auth,
            "method": method,
            "params": params,
        }))
        .unwrap()
    }

    fn round_trip(&self, client: &mut Client, request: &Request) -> Response {
        client.send(request);
        client.recv()
    }

    fn status(&self, client: &mut Client, request_id: &str) -> Response {
        self.round_trip(client, &self.request(request_id, "status", json!({})))
    }

    /// Polls until the owned serving thread exits; on timeout arms `abort`
    /// (so `drop` can join a terminating thread) and reports failure.
    fn wait_for_exit(&mut self, deadline: Duration) -> bool {
        let until = std::time::Instant::now() + deadline;
        while std::time::Instant::now() < until {
            if self.thread.as_ref().is_some_and(|t| t.is_finished()) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        self.abort.store(true, Ordering::Release);
        false
    }
}

impl Drop for ServingFixture {
    fn drop(&mut self) {
        // Deterministic teardown even for a RED server: `abort` makes the
        // next accept-source call return a fatal EBADF, so the loop unwinds
        // and the join below is bounded by the loop's backoff sleep.
        self.abort.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn shutdown_params(host_id: &str, instance_id: &str) -> Value {
    json!({ "hostId": host_id, "serviceInstanceId": instance_id })
}

fn current_identity(fixture: &ServingFixture, client: &mut Client) -> (String, String) {
    let status = fixture.status(client, "identity-status");
    assert!(status.ok, "{status:?}");
    let result = status.result.unwrap();
    (
        result["hostId"].as_str().unwrap().to_string(),
        result["serviceInstanceId"].as_str().unwrap().to_string(),
    )
}

#[test]
fn admitted_shutdown_stops_serving_thread_and_releases_lock() {
    let mut fixture = ServingFixture::start();
    // While serving, this process may not re-acquire its own exclusive lock.
    assert!(
        drogond::lock::acquire_exclusive(fixture.dir.path()).is_err(),
        "a live service must hold the exclusive data-dir lock"
    );

    let mut client = fixture.connect();
    let status = fixture.status(&mut client, "pre-status");
    assert!(status.ok, "{status:?}");
    let result = status.result.clone().unwrap();
    // The capability may only be claimed once the server half exists too;
    // this suite's exit assertions are that proof.
    assert!(
        result["capabilities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c == "runtime.quiescent-shutdown.v1"),
        "status must advertise runtime.quiescent-shutdown.v1: {result:?}"
    );
    // Kernel-observer correlation field, not signaling authority.
    assert_eq!(
        result["processId"].as_u64().map(|id| id as u32),
        Some(std::process::id()),
        "status processId must identify this serving process: {result:?}"
    );
    let host_id = result["hostId"].as_str().unwrap().to_string();
    let instance_id = result["serviceInstanceId"].as_str().unwrap().to_string();

    let reply = fixture.round_trip(
        &mut client,
        &fixture.request(
            "shutdown-1",
            "runtime.shutdown",
            shutdown_params(&host_id, &instance_id),
        ),
    );
    assert!(reply.ok, "{reply:?}");
    assert_eq!(reply.result.unwrap()["accepted"], true);

    // Admission is not an exited verdict: the owned serving thread must
    // actually stop, and only after the reply above was writable.
    assert!(
        fixture.wait_for_exit(SHUTDOWN_EXIT_DEADLINE),
        "serving thread did not exit after an admitted shutdown"
    );
    // Reap the exited thread.
    let _ = fixture.thread.take().unwrap().join();

    // The service stack released the data directory: a fresh exclusive lock
    // succeeds, which is also what allows a replacement instance to start.
    let _relock = drogond::lock::acquire_exclusive(fixture.dir.path())
        .expect("exclusive lock must be reacquirable after the owned exit");
}

#[test]
fn unauthorized_shutdown_is_refused_and_service_stays_up() {
    let mut fixture = ServingFixture::start();
    let mut client = fixture.connect();
    let refused = fixture.round_trip(
        &mut client,
        &fixture.request_with_auth(
            "shutdown-bad-auth",
            "runtime.shutdown",
            json!({ "hostId": "any", "serviceInstanceId": "any" }),
            Some("not-the-token"),
        ),
    );
    assert!(!refused.ok, "{refused:?}");
    assert_eq!(refused.error.unwrap().code, "unauthorized");

    // The service is still fully available, and a correctly authenticated
    // shutdown is still admitted afterwards.
    assert!(fixture.status(&mut client, "still-up").ok);
    let (host_id, instance_id) = current_identity(&fixture, &mut client);
    let reply = fixture.round_trip(
        &mut client,
        &fixture.request(
            "shutdown-ok",
            "runtime.shutdown",
            shutdown_params(&host_id, &instance_id),
        ),
    );
    assert!(reply.ok, "{reply:?}");
    assert!(
        fixture.wait_for_exit(SHUTDOWN_EXIT_DEADLINE),
        "serving thread did not exit after the refused-then-admitted shutdown"
    );
}

#[test]
fn stale_fences_refuse_shutdown_and_service_stays_up() {
    let mut fixture = ServingFixture::start();
    let mut client = fixture.connect();
    let (host_id, instance_id) = current_identity(&fixture, &mut client);

    let wrong_instance = fixture.round_trip(
        &mut client,
        &fixture.request(
            "shutdown-old-instance",
            "runtime.shutdown",
            shutdown_params(&host_id, "a-replaced-instance-id"),
        ),
    );
    assert!(!wrong_instance.ok, "{wrong_instance:?}");
    assert_eq!(wrong_instance.error.unwrap().code, "stale_incarnation");

    let wrong_host = fixture.round_trip(
        &mut client,
        &fixture.request(
            "shutdown-foreign-host",
            "runtime.shutdown",
            shutdown_params("some-other-host", &instance_id),
        ),
    );
    assert!(!wrong_host.ok, "{wrong_host:?}");
    assert_eq!(wrong_host.error.unwrap().code, "unsupported_host");

    // Refusals never touched the service: it answers, then admits the real
    // shutdown and actually exits.
    assert!(fixture.status(&mut client, "still-up").ok);
    let reply = fixture.round_trip(
        &mut client,
        &fixture.request(
            "shutdown-real",
            "runtime.shutdown",
            shutdown_params(&host_id, &instance_id),
        ),
    );
    assert!(reply.ok, "{reply:?}");
    assert!(
        fixture.wait_for_exit(SHUTDOWN_EXIT_DEADLINE),
        "serving thread did not exit after fence refusals then admission"
    );
}

#[test]
fn busy_service_refuses_shutdown_and_child_survives_then_accepts_after_exit() {
    let mut fixture = ServingFixture::start();
    let mut client = fixture.connect();

    let workspace = fixture.round_trip(
        &mut client,
        &fixture.request(
            "ws-register",
            "workspace.register",
            json!({ "path": fixture.dir.path().to_string_lossy() }),
        ),
    );
    assert!(workspace.ok, "{workspace:?}");
    let workspace_id = workspace.result.unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    let started = fixture.round_trip(
        &mut client,
        &fixture.request(
            "session-start",
            "session.start",
            json!({
                "workspaceId": workspace_id,
                "command": "/bin/sh",
                "args": ["-c", "sleep 30"],
                "cols": 80,
                "rows": 24
            }),
        ),
    );
    assert!(started.ok, "{started:?}");
    let started = started.result.unwrap();
    let session_id = started["id"].as_str().unwrap().to_string();
    let incarnation = started["incarnation"].as_str().unwrap().to_string();
    assert_eq!(started["verdict"], "live");

    let (host_id, instance_id) = current_identity(&fixture, &mut client);
    let busy = fixture.round_trip(
        &mut client,
        &fixture.request(
            "shutdown-busy",
            "runtime.shutdown",
            shutdown_params(&host_id, &instance_id),
        ),
    );
    assert!(!busy.ok, "{busy:?}");
    let busy_error = busy.error.unwrap();
    assert_eq!(busy_error.code, "runtime_busy");
    assert!(busy_error.retryable, "runtime_busy must be retryable");

    // The refusal must not have stopped or dropped the child: it is still
    // live, and the service is still answering.
    let listed = fixture.round_trip(
        &mut client,
        &fixture.request(
            "session-list",
            "session.list",
            json!({ "workspaceId": workspace_id }),
        ),
    );
    assert!(listed.ok, "{listed:?}");
    let sessions = listed.result.unwrap()["sessions"]
        .as_array()
        .unwrap()
        .clone();
    let row = sessions
        .iter()
        .find(|s| s["id"] == session_id)
        .expect("session row must survive the refused shutdown");
    assert_eq!(row["verdict"], "live");

    let stopped = fixture.round_trip(
        &mut client,
        &fixture.request(
            "session-stop",
            "session.stop",
            json!({ "sessionId": session_id, "incarnation": incarnation }),
        ),
    );
    assert!(stopped.ok, "{stopped:?}");
    assert_eq!(stopped.result.unwrap()["verdict"], "exited");

    let reply = fixture.round_trip(
        &mut client,
        &fixture.request(
            "shutdown-after-exit",
            "runtime.shutdown",
            shutdown_params(&host_id, &instance_id),
        ),
    );
    assert!(reply.ok, "{reply:?}");
    assert!(
        fixture.wait_for_exit(SHUTDOWN_EXIT_DEADLINE),
        "serving thread did not exit after the session exited and shutdown was admitted"
    );
}

#[test]
fn idle_connections_do_not_hold_server_lifetime() {
    // Idle clients (connected, nothing sent) must be drained by the
    // termination path, not waited out: the fixture's idle timeout is far
    // beyond the exit deadline, so exiting proves active disposal.
    let mut fixture = ServingFixture::start_with_idle_timeout(Duration::from_secs(600));
    let idle: Vec<Client> = (0..3).map(|_| fixture.connect()).collect();

    let (host_id, instance_id) = current_identity(&fixture, &mut fixture.connect());
    let mut operator = fixture.connect();
    let reply = fixture.round_trip(
        &mut operator,
        &fixture.request(
            "shutdown-idle",
            "runtime.shutdown",
            shutdown_params(&host_id, &instance_id),
        ),
    );
    assert!(reply.ok, "{reply:?}");
    assert!(
        fixture.wait_for_exit(SHUTDOWN_EXIT_DEADLINE),
        "idle connections must not hold the serving thread: it did not exit"
    );
    drop(idle);
}

#[test]
fn abrupt_disconnect_after_shutdown_request_still_drains() {
    let mut fixture = ServingFixture::start();
    let mut client = fixture.connect();
    let (host_id, instance_id) = current_identity(&fixture, &mut client);

    // Send the shutdown frame and drop the socket without reading the reply:
    // delivery is now uncertain from the client's perspective, and may be
    // from the server's too (a write into a closed socket can fail). The
    // admitted shutdown must still drain the service — never retry, signal a
    // PID, or stay up forever.
    client.send(&fixture.request(
        "shutdown-vanish",
        "runtime.shutdown",
        shutdown_params(&host_id, &instance_id),
    ));
    drop(client);

    assert!(
        fixture.wait_for_exit(SHUTDOWN_EXIT_DEADLINE),
        "delivery uncertainty must not hold the serving thread: it did not exit"
    );
}

#[test]
fn plain_client_eof_without_request_preserves_service() {
    let mut fixture = ServingFixture::start();
    {
        let _connect_and_vanish = fixture.connect();
        // Dropped with no frame: a normal EOF, no shutdown request. This
        // must never stop the service or touch any session.
    }
    let mut client = fixture.connect();
    let status = fixture.status(&mut client, "after-eof");
    assert!(
        status.ok,
        "service must survive a plain client EOF: {status:?}"
    );

    let (host_id, instance_id) = current_identity(&fixture, &mut client);
    let reply = fixture.round_trip(
        &mut client,
        &fixture.request(
            "shutdown-final",
            "runtime.shutdown",
            shutdown_params(&host_id, &instance_id),
        ),
    );
    assert!(reply.ok, "{reply:?}");
    assert!(
        fixture.wait_for_exit(SHUTDOWN_EXIT_DEADLINE),
        "serving thread did not exit after a normal EOF then an admitted shutdown"
    );
}

#[test]
fn production_accept_loop_exits_after_admitted_shutdown() {
    // Real production entry (`accept_loop_with_limits`, the same path
    // `drogond::serve` takes), with no abort switch: the PASS is produced
    // by the server's own bounded observation of the authorized shutdown,
    // and the loop's own return value must be a clean `Ok(())`.
    let dir = tempfile::tempdir().unwrap();
    let listener = drogond::endpoint::establish(dir.path()).unwrap();
    let token = drogond::auth::ensure_token(dir.path()).unwrap();
    let engine = Arc::new(Engine::open(dir.path()).unwrap());
    let socket_path = dir.path().join(drogond::endpoint::SOCKET_FILE_NAME);
    let token_arc: Arc<str> = Arc::from(token.as_str());
    let thread = std::thread::spawn(move || {
        drogond::server::accept_loop_with_limits(
            listener,
            engine,
            token_arc,
            64,
            Duration::from_secs(60),
        )
    });
    std::thread::sleep(Duration::from_millis(20));

    let mut client = {
        let stream = UnixStream::connect(&socket_path).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        Client {
            writer: stream.try_clone().unwrap(),
            reader: BufReader::new(stream),
        }
    };
    let send_recv = |client: &mut Client, request: &Request| {
        client.send(request);
        client.recv()
    };
    let request = |request_id: &str, method: &str, params: Value| {
        serde_json::from_value(json!({
            "protocol": PROTOCOL_VERSION,
            "requestId": request_id,
            "auth": token,
            "method": method,
            "params": params,
        }))
        .unwrap()
    };

    let status = send_recv(&mut client, &request("status", "status", json!({})));
    assert!(status.ok, "{status:?}");
    let result = status.result.unwrap();
    let reply = send_recv(
        &mut client,
        &request(
            "shutdown",
            "runtime.shutdown",
            shutdown_params(
                result["hostId"].as_str().unwrap(),
                result["serviceInstanceId"].as_str().unwrap(),
            ),
        ),
    );
    assert!(reply.ok, "{reply:?}");

    let mut exited = false;
    let deadline = std::time::Instant::now() + SHUTDOWN_EXIT_DEADLINE;
    while std::time::Instant::now() < deadline {
        if thread.is_finished() {
            exited = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(
        exited,
        "production accept loop did not exit after an admitted shutdown"
    );
    let outcome = thread.join().expect("serving thread must not panic");
    assert!(
        outcome.is_ok(),
        "production accept loop must return cleanly after drain: {outcome:?}"
    );
}

#[test]
fn finished_connections_are_reaped_during_normal_serving() {
    // One-shot RPCs must not accumulate handler resources while the service
    // keeps running: every finished connection's registry entry and
    // transport clone are retired by the handler itself, immediately.
    let fixture = ServingFixture::start();
    let one_shot = |request_id: &str| {
        let mut client = fixture.connect();
        let response = fixture.round_trip(
            &mut client,
            &fixture.request(request_id, "status", json!({})),
        );
        assert!(response.ok, "{response:?}");
        drop(client);
    };
    // Warm up, then measure: the descriptor count must return to baseline
    // after the burst instead of growing with the connection count.
    for i in 0..4 {
        one_shot(&format!("warmup-{i}"));
    }
    std::thread::sleep(Duration::from_millis(100));
    let baseline = std::fs::read_dir("/dev/fd").map(|d| d.count()).unwrap();
    for i in 0..64 {
        one_shot(&format!("burst-{i}"));
    }
    std::thread::sleep(Duration::from_millis(100));
    let after = std::fs::read_dir("/dev/fd").map(|d| d.count()).unwrap();
    // Slack absorbs unrelated parallel-test activity in this process; the
    // leak signal this guards against is two descriptors per connection
    // (handler stream plus registry clone), i.e. 128 here.
    assert!(
        after <= baseline + 16,
        "one-shot connections must not accumulate descriptors: baseline={baseline} after={after}"
    );
}

#[test]
fn injected_accept_errors_keep_fatal_and_budget_semantics() {
    // The quiescence-aware loop must not have changed the accept-error
    // contract: transient errors retry within the budget, a fatal error is
    // returned with its original errno.
    let dir = tempfile::tempdir().unwrap();
    let token = drogond::auth::ensure_token(dir.path()).unwrap();
    let engine = Arc::new(Engine::open(dir.path()).unwrap());
    let injected: std::cell::RefCell<Vec<std::io::Error>> = std::cell::RefCell::new(vec![
        std::io::Error::from_raw_os_error(libc::EMFILE),
        std::io::Error::from_raw_os_error(libc::EMFILE),
    ]);
    let outcome = drogond::server::run_accept_loop(
        move || {
            let mut injected = injected.borrow_mut();
            if !injected.is_empty() {
                return Err(injected.remove(0));
            }
            // Schedule exhausted (the budget tolerated both transient
            // errors): keep failing fatally so the loop returns.
            Err(std::io::Error::from_raw_os_error(libc::EBADF))
        },
        engine,
        Arc::from(token.as_str()),
        64,
        Duration::from_secs(60),
        Duration::from_millis(1),
        2,
    );
    let error = outcome.expect_err("the injected fatal error must surface");
    assert_eq!(error.raw_os_error(), Some(libc::EBADF));
}
