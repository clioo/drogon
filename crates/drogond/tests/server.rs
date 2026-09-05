//! End-to-end tests against the real Unix-socket server: auth, frame
//! errors, and client disconnect/reconnect. Unix-only for this slice.
#![cfg(unix)]

use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::sync::Arc;
use std::time::Duration;

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::json;

struct TestServer {
    dir: tempfile::TempDir,
    token: String,
}

fn start_server() -> TestServer {
    let dir = tempfile::tempdir().unwrap();
    let listener = drogond::endpoint::establish(dir.path()).unwrap();
    let token = drogond::auth::ensure_token(dir.path()).unwrap();
    let engine = Arc::new(Engine::open(dir.path()).unwrap());
    let token_arc: Arc<str> = Arc::from(token.as_str());
    std::thread::spawn(move || {
        drogond::server::accept_loop(listener, engine, token_arc);
    });
    // Give the accept loop a moment to be actively listening; connect()
    // to a bound-but-not-yet-`accept`-ing socket still succeeds (queued in
    // the kernel backlog), so this is a generous margin, not a requirement.
    std::thread::sleep(Duration::from_millis(20));
    TestServer { dir, token }
}

fn start_server_with_limits(max_connections: usize, idle_timeout: Duration) -> TestServer {
    let dir = tempfile::tempdir().unwrap();
    let listener = drogond::endpoint::establish(dir.path()).unwrap();
    let token = drogond::auth::ensure_token(dir.path()).unwrap();
    let engine = Arc::new(Engine::open(dir.path()).unwrap());
    let token_arc: Arc<str> = Arc::from(token.as_str());
    std::thread::spawn(move || {
        drogond::server::accept_loop_with_limits(
            listener,
            engine,
            token_arc,
            max_connections,
            idle_timeout,
        );
    });
    std::thread::sleep(Duration::from_millis(20));
    TestServer { dir, token }
}

fn connect(server: &TestServer) -> UnixStream {
    UnixStream::connect(server.dir.path().join("runtime-v1.sock")).unwrap()
}

fn send(stream: &mut UnixStream, request: &Request) {
    let mut bytes = serde_json::to_vec(request).unwrap();
    bytes.push(b'\n');
    stream.write_all(&bytes).unwrap();
}

fn recv(reader: &mut BufReader<UnixStream>) -> Response {
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    serde_json::from_str(&line).unwrap()
}

fn status_request(request_id: &str, auth: Option<&str>) -> Request {
    serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": request_id,
        "auth": auth,
        "method": "status",
        "params": {}
    }))
    .unwrap()
}

#[test]
fn authenticated_status_round_trips() {
    let server = start_server();
    let mut stream = connect(&server);
    send(&mut stream, &status_request("r1", Some(&server.token)));
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let response = recv(&mut reader);
    assert!(response.ok);
    assert_eq!(response.request_id, "r1");
}

#[test]
fn missing_or_wrong_token_is_unauthorized() {
    let server = start_server();
    let mut stream = connect(&server);
    send(&mut stream, &status_request("r1", Some("wrong-token")));
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let response = recv(&mut reader);
    assert!(!response.ok);
    assert_eq!(response.error.unwrap().code, "unauthorized");

    let mut stream2 = connect(&server);
    send(&mut stream2, &status_request("r2", None));
    let mut reader2 = BufReader::new(stream2.try_clone().unwrap());
    let response2 = recv(&mut reader2);
    assert!(!response2.ok);
    assert_eq!(response2.error.unwrap().code, "unauthorized");
}

#[test]
fn client_disconnect_does_not_affect_a_fresh_reconnect() {
    let server = start_server();
    {
        let mut stream = connect(&server);
        send(&mut stream, &status_request("r1", Some(&server.token)));
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        assert!(recv(&mut reader).ok);
        // stream drops here: an abrupt client-side disconnect.
    }
    let mut stream2 = connect(&server);
    send(&mut stream2, &status_request("r2", Some(&server.token)));
    let mut reader2 = BufReader::new(stream2.try_clone().unwrap());
    let response = recv(&mut reader2);
    assert!(
        response.ok,
        "server must keep serving new connections after a disconnect"
    );
    assert_eq!(response.request_id, "r2");
}

#[test]
fn a_single_connection_serves_multiple_sequential_requests() {
    let server = start_server();
    let mut stream = connect(&server);
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    for i in 0..3 {
        send(
            &mut stream,
            &status_request(&format!("multi-{i}"), Some(&server.token)),
        );
        let response = recv(&mut reader);
        assert!(response.ok);
        assert_eq!(response.request_id, format!("multi-{i}"));
    }
}

#[test]
fn garbled_frame_gets_a_synthesized_error_and_the_connection_stays_open() {
    let server = start_server();
    let mut stream = connect(&server);
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    stream.write_all(b"not json at all\n").unwrap();
    // The frame itself was well-formed (newline-terminated, under the size
    // bound); it just did not parse as a request envelope. There is no
    // requestId to correlate a reply to, so the server answers with a
    // synthesized error rather than silently dropping the frame or closing
    // a connection that is otherwise healthy.
    let response = recv(&mut reader);
    assert!(!response.ok);
    assert_eq!(response.error.unwrap().code, "invalid_argument");

    // The same connection must still be usable afterward.
    send(
        &mut stream,
        &status_request("after-garbage-same-conn", Some(&server.token)),
    );
    assert!(recv(&mut reader).ok);

    // The server itself must still be alive for new connections.
    let mut stream2 = connect(&server);
    send(
        &mut stream2,
        &status_request("after-garbage", Some(&server.token)),
    );
    let mut reader2 = BufReader::new(stream2.try_clone().unwrap());
    assert!(recv(&mut reader2).ok);
}

#[test]
fn oversized_frame_closes_the_connection_but_not_the_server() {
    let server = start_server();
    let mut stream = connect(&server);
    let oversized = vec![b'a'; drogon_protocol::MAX_FRAME_BYTES + 100];
    // Deliberately no trailing newline within the budget.
    let _ = stream.write_all(&oversized);
    let mut buf = Vec::new();
    let _ = stream.read_to_end(&mut buf);

    let mut stream2 = connect(&server);
    send(
        &mut stream2,
        &status_request("after-oversized", Some(&server.token)),
    );
    let mut reader2 = BufReader::new(stream2.try_clone().unwrap());
    assert!(recv(&mut reader2).ok);
}

#[test]
fn a_connection_cap_alone_does_not_permanently_exclude_clients() {
    // Regression for: with only a connection cap and no idle deadline,
    // clients that connect and never send anything hold their slots
    // forever, so once the cap fills the server is permanently unreachable
    // even though nothing is actually being served. A short idle timeout
    // (here, milliseconds instead of the production `DEFAULT_IDLE_TIMEOUT`)
    // must reclaim those slots.
    let server = start_server_with_limits(2, Duration::from_millis(400));

    // Fill the cap with connections that send nothing.
    let _idle_a = connect(&server);
    let _idle_b = connect(&server);

    // A third connection, over the cap, is refused (connection accepted at
    // the OS level, then immediately closed with no data — indistinguishable
    // from EOF to this client).
    let mut over_cap = connect(&server);
    over_cap.set_nonblocking(true).unwrap();
    let mut buf = [0u8; 1];
    let refusal_deadline = std::time::Instant::now() + Duration::from_millis(250);
    loop {
        match over_cap.read(&mut buf) {
            Ok(0) => break,
            Err(error) if error.kind() == std::io::ErrorKind::ConnectionReset => break,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                assert!(
                    std::time::Instant::now() < refusal_deadline,
                    "over-cap connection was not closed promptly"
                );
                std::thread::sleep(Duration::from_millis(5));
            }
            other => panic!("unexpected over-cap response: {other:?}"),
        }
    }

    // Once the two idle connections time out, their slots free up and a
    // fresh connection must succeed — well within a bounded wait.
    let mut reconnected = false;
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    while std::time::Instant::now() < deadline {
        // While the cap is still full, this connection is itself over-cap
        // and the server closes it immediately — a write into that half-closed
        // socket can legitimately fail (BrokenPipe/ConnectionReset), which
        // means exactly "not yet reconnected," not a test failure.
        let mut stream = connect(&server);
        let request = status_request("after-idle-timeout", Some(&server.token));
        let mut bytes = serde_json::to_vec(&request).unwrap();
        bytes.push(b'\n');
        // macOS can refuse socket options after the server has already closed an over-cap peer.
        if stream
            .set_read_timeout(Some(Duration::from_millis(200)))
            .is_ok()
            && stream.write_all(&bytes).is_ok()
        {
            let mut reader = BufReader::new(stream);
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap_or(0) > 0
                && let Ok(response) = serde_json::from_str::<Response>(&line)
                && response.ok
            {
                reconnected = true;
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(
        reconnected,
        "a connection cap must not permanently exclude clients once idle slots time out"
    );
}
