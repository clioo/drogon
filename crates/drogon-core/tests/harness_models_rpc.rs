//! `harness.models` dispatch arm: the per-harness host model catalog RPC
//! that closes the held selection_gate seam. Every response is proven
//! against fixture executables — no real harness CLIs, no user config, no
//! network, no model inference, no PTY sessions (the probe runs the
//! fixture's own read-only enumeration command under the probe's
//! credential-free isolation).
//!
//! Honesty contract under test: real entries carry real provenance;
//! unavailable/failed/unsupported surfaces are reported as exactly that —
//! never substituted with invented model rows.

use std::path::PathBuf;

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

fn call(engine: &Engine, method: &str, params: Value) -> drogon_protocol::Response {
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: uuid::Uuid::new_v4().to_string(),
        auth: None,
        method: method.into(),
        params,
    })
}

/// The exact fixed-column shape `pi --list-models` prints on Pi 0.85.1,
/// reduced to two rows.
const FAKE_PI_TABLE: &str = "\
provider      model                context  max-out  thinking  images
kimi-coding   kimi-for-coding      262.1K   32.8K    yes       yes
zai           glm-5.3-flash        1M       131.1K   yes       no
";

fn fake_pi(list_models_body: &str) -> String {
    format!(
        "#!/bin/sh\n\
         case \"$1\" in\n\
         \x20 --version) echo '0.85.1'; exit 0 ;;\n\
         \x20 --list-models) cat <<'PIEOF'\n{list_models_body}PIEOF\n\
         \x20 exit 0 ;;\n\
         *) echo \"unexpected argv: $1\" >&2; exit 2 ;;\n\
         esac\n"
    )
}

fn fake_opencode(models_body: &str) -> String {
    format!(
        "#!/bin/sh\n\
         case \"$1\" in\n\
         \x20 --version) echo '1.18.30'; exit 0 ;;\n\
         \x20 models) cat <<'OCEOF'\n{models_body}OCEOF\n\
         \x20 exit 0 ;;\n\
         *) echo \"unexpected argv: $1\" >&2; exit 2 ;;\n\
         esac\n"
    )
}

/// A temp bin dir with one executable fixture; returns (bin, script path).
fn fixture_bin(name: &str, body: &str) -> (tempfile::TempDir, PathBuf) {
    let bin = tempfile::tempdir().unwrap();
    let path = bin.path().join(name);
    std::fs::write(&path, body).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    (bin, path)
}

/// Engine with a settings file overriding one harness's command to an
/// absolute fixture path — the same resolution `harness.start` launches
/// with, so the catalog provably describes the binary that would run.
/// `agentDefaultEnv` pins the probe's config sources at nonexistent paths
/// so the default tests run the credential-free isolated probe
/// deterministically, regardless of the developer's real harness config.
fn engine_with_override(override_id: &str, command: &str) -> (tempfile::TempDir, Engine) {
    engine_with_env_override(
        override_id,
        command,
        json!({
            "pi": { "PI_CODING_AGENT_DIR": "/nonexistent/drogon-probe-test-pi-agent" },
            "opencode": {
                "OPENCODE_CONFIG_DIR": "/nonexistent/drogon-probe-test-opencode",
                "XDG_DATA_HOME": "/nonexistent/drogon-probe-test-data"
            }
        }),
    )
}

/// Like [`engine_with_override`], but with an explicit `agentDefaultEnv`
/// (used to hand the probe a real fixture config root).
fn engine_with_env_override(
    override_id: &str,
    command: &str,
    harness_env: Value,
) -> (tempfile::TempDir, Engine) {
    let dir = tempfile::tempdir().unwrap();
    let envelope = json!({
        "version": 1,
        "settings": {
            "defaultTuiAgent": null,
            "disabledTuiAgents": [],
            "agentCmdOverrides": { override_id: command },
            "agentDefaultArgs": {},
            "agentDefaultEnv": harness_env,
            "agentStatusHooksEnabled": true,
            "tabAutoGenerateTitle": false,
            "promptCacheTimerEnabled": false,
            "promptCacheTtlMs": 300000,
            "codexSessionSourceHome": ""
        }
    });
    std::fs::write(
        dir.path().join("agent-settings.json"),
        serde_json::to_vec(&envelope).unwrap(),
    )
    .unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    (dir, engine)
}

fn catalog_of(response: drogon_protocol::Response) -> Value {
    assert!(response.ok, "harness.models must answer: {response:?}");
    response.result.unwrap()["catalog"].clone()
}

#[test]
fn pi_catalog_enumerates_real_entries_with_provenance_and_freshness() {
    let (_bin, pi) = fixture_bin("pi", &fake_pi(FAKE_PI_TABLE));
    let (_dir, engine) = engine_with_override("pi", &pi.to_string_lossy());
    let host_id = call(&engine, "status", json!({})).result.unwrap()["hostId"].clone();
    let response = call(&engine, "harness.models", json!({"harnessId": "pi"}));
    assert!(response.ok, "harness.models must answer: {response:?}");
    let result = response.result.unwrap();
    let catalog = result["catalog"].clone();
    assert_eq!(catalog["harness"], "pi");
    assert_eq!(catalog["availability"], "available");
    assert_eq!(catalog["status"], "enumerated");
    // macOS temp roots carry symlinked (/var) vs resolved (/private/var)
    // spellings; compare resolved paths.
    assert_eq!(
        PathBuf::from(catalog["executable"].as_str().unwrap())
            .canonicalize()
            .unwrap(),
        pi.canonicalize().unwrap()
    );
    let entries = catalog["entries"].as_array().unwrap();
    assert_eq!(
        entries.len(),
        2,
        "exactly what the fixture reported: {catalog}"
    );
    let kimi = entries
        .iter()
        .find(|entry| entry["provider"] == "kimi-coding")
        .expect("kimi entry");
    assert_eq!(kimi["id"], "kimi-for-coding");
    assert_eq!(kimi["context"], "262.1K");
    assert_eq!(kimi["maxOutput"], "32.8K");
    assert_eq!(kimi["thinking"], true);
    assert_eq!(kimi["images"], true);
    // Provenance is the real probe record: source, version, argv, scope.
    let provenance = &catalog["provenance"];
    assert_eq!(provenance["version"], "0.85.1");
    assert_eq!(provenance["argv"], json!(["--list-models"]));
    assert_eq!(
        PathBuf::from(provenance["executable"].as_str().unwrap())
            .canonicalize()
            .unwrap(),
        pi.canonicalize().unwrap()
    );
    assert!(
        provenance["configScope"]
            .as_str()
            .unwrap()
            .contains("credential-free")
    );
    // Freshness is a real epoch-ms timestamp of this probe.
    let probed_at = provenance["probedAtEpochMs"].as_u64().expect("epoch ms");
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    assert!(
        probed_at > now_ms - 60_000,
        "freshly probed: {probed_at} vs {now_ms}"
    );
    // Scope note and host identity ride along; nothing was retained.
    let note = catalog["note"].as_str().unwrap();
    assert!(
        note.contains("provenance") || note.contains("not proof"),
        "note points at the recorded scope: {note}"
    );
    assert_eq!(catalog["retainedRoots"], json!([]));
    assert_eq!(result["hostId"], host_id);
    // Read-only: no session was ever spawned.
    let sessions = call(&engine, "session.list", json!({})).result.unwrap()["sessions"]
        .as_array()
        .unwrap()
        .len();
    assert_eq!(sessions, 0);
}

#[test]
fn failed_enumeration_is_reported_honestly_not_substituted() {
    // The enumeration child exits 1: the honest answer is a probe_failed
    // catalog with zero entries — never fabricated rows or an "empty
    // means fine" relabel.
    let script = "#!/bin/sh\n\
                  case \"$1\" in\n\
                  \x20 --version) echo '0.9.9'; exit 0 ;;\n\
                  \x20 --list-models) echo 'auth expired' >&2; exit 1 ;;\n\
                  *) exit 2 ;;\n\
                  esac\n";
    let (_bin, pi) = fixture_bin("pi", script);
    let (_dir, engine) = engine_with_override("pi", &pi.to_string_lossy());
    let catalog = catalog_of(call(&engine, "harness.models", json!({"harnessId": "pi"})));
    assert_eq!(catalog["status"], "probe_failed", "{catalog}");
    assert!(catalog["entries"].as_array().unwrap().is_empty());
    let note = catalog["note"].as_str().unwrap();
    assert!(note.contains('1'), "note carries the exit code: {note}");
    // ...and the provenance of the ATTEMPT still rides along.
    assert_eq!(catalog["provenance"]["version"], "0.9.9");
}

#[test]
fn opencode_catalog_enumerates_its_own_surface() {
    let (_bin, opencode) = fixture_bin(
        "opencode",
        &fake_opencode("anthropic/claude-sonnet-4-5\nkimi-coding/kimi-for-coding\n"),
    );
    let (_dir, engine) = engine_with_override("opencode", &opencode.to_string_lossy());
    let catalog = catalog_of(call(
        &engine,
        "harness.models",
        json!({"harnessId": "opencode"}),
    ));
    assert_eq!(catalog["status"], "enumerated");
    let entries = catalog["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0]["provider"], "anthropic");
    assert_eq!(entries[0]["id"], "claude-sonnet-4-5");
    assert_eq!(catalog["provenance"]["argv"], json!(["models"]));
}

#[test]
fn empty_enumeration_is_an_honest_empty_answer_with_scope() {
    // Pi's auth-gated surface with no auth configured reports "No models
    // available": enumerated, empty, and the scope note says why — never
    // dressed up as a success count.
    let (_bin, pi) = fixture_bin(
        "pi",
        &fake_pi("No models available. Use /login to log into a provider via OAuth or API key.\n"),
    );
    let (_dir, engine) = engine_with_override("pi", &pi.to_string_lossy());
    let catalog = catalog_of(call(&engine, "harness.models", json!({"harnessId": "pi"})));
    assert_eq!(catalog["status"], "enumerated");
    assert!(catalog["entries"].as_array().unwrap().is_empty());
    let note = catalog["note"].as_str().unwrap();
    assert!(note.contains("unverified"), "scope must say why: {note}");
}

#[test]
fn no_enumeration_surface_is_reported_not_hidden() {
    // Claude exposes no model enumeration command on this host: the
    // response must SAY that (unsupported_surface, empty entries) — a
    // caller then knows an entered id rides unverified.
    let script = "#!/bin/sh\n case \"$1\" in\n\x20 --version) echo '2.1.0'; exit 0 ;;\n*) exit 0 ;;\n esac\n";
    let (_bin, claude) = fixture_bin("claude", script);
    let (_dir, engine) = engine_with_override("claude", &claude.to_string_lossy());
    let catalog = catalog_of(call(
        &engine,
        "harness.models",
        json!({"harnessId": "claude"}),
    ));
    assert_eq!(catalog["status"], "unsupported_surface", "{catalog}");
    assert!(catalog["entries"].as_array().unwrap().is_empty());
    assert!(catalog["note"].is_string());
}

#[test]
fn missing_executable_is_not_installed_not_an_empty_catalog() {
    let (_dir, engine) = engine_with_override("pi", "/nonexistent/drogon-models-test-pi");
    let catalog = catalog_of(call(&engine, "harness.models", json!({"harnessId": "pi"})));
    assert_eq!(catalog["availability"], "missing");
    assert_eq!(catalog["status"], "not_installed");
    assert!(catalog["entries"].as_array().unwrap().is_empty());
    assert!(catalog["executable"].is_null());
}

#[test]
fn malformed_or_unknown_ids_refuse_as_caller_bugs() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    for params in [
        json!({}),
        json!({"harnessId": ""}),
        json!({"harnessId": "not-a-harness"}),
    ] {
        let response = call(&engine, "harness.models", params.clone());
        let error = response
            .error
            .unwrap_or_else(|| panic!("must refuse: {params:?}"));
        assert_eq!(error.code, "invalid_argument", "{params:?}");
    }
    // The unknown-harness refusal names the accepted vocabulary.
    let error = call(&engine, "harness.models", json!({"harnessId": "nope"}))
        .error
        .unwrap();
    assert!(error.message.contains("claude"), "{}", error.message);
    assert!(
        call(&engine, "session.list", json!({})).result.unwrap()["sessions"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn catalog_matches_the_discovery_host_identity() {
    // Overridden to a path that cannot exist: the honest answer is
    // not_installed (never an invented catalog), and the response names
    // THIS engine's host identity.
    let (_dir, engine) = engine_with_override("antigravity", "/nonexistent/drogon-models-test-agy");
    let result = call(
        &engine,
        "harness.models",
        json!({"harnessId": "antigravity"}),
    )
    .result
    .unwrap();
    let status = call(&engine, "status", json!({})).result.unwrap();
    assert_eq!(result["hostId"], status["hostId"]);
    assert_eq!(result["catalog"]["status"], "not_installed");
    assert_eq!(result["catalog"]["availability"], "missing");
}

#[test]
fn pi_catalog_links_the_configured_agent_dir_read_only() {
    // A fake pi that only enumerates when the probe's own
    // PI_CODING_AGENT_DIR actually contains the user's auth.json: the
    // config the user configured must reach the child, as a read-only
    // link, without the daemon reading or copying its contents.
    let script = "#!/bin/sh\n\
                  case \"$1\" in\n\
                  \x20 --version) echo '0.85.1'; exit 0 ;;\n\
                  \x20 --list-models)\n\
                  \x20 if [ -e \"$PI_CODING_AGENT_DIR/auth.json\" ]; then\n\
                  \x20   printf 'provider      model                context  max-out  thinking  images\\n';\n\
                  \x20   printf 'kimi-coding   kimi-for-coding      262.1K   32.8K    yes       yes\\n';\n\
                  \x20 else\n\
                  \x20   echo 'No models available.';\n\
                  \x20 fi\n\
                  \x20 exit 0 ;;\n\
                  *) exit 2 ;;\n\
                  esac\n";
    let (_bin, pi) = fixture_bin("pi", script);
    let agent = tempfile::tempdir().unwrap();
    for (name, body) in [
        ("models.json", "{\"providers\":{}}"),
        ("models-store.json", "{}"),
        (
            "auth.json",
            "{\"kimi-coding\":{\"apiKey\":\"fixture-not-a-real-secret\"}}",
        ),
    ] {
        std::fs::write(agent.path().join(name), body).unwrap();
    }
    let before = std::fs::read_to_string(agent.path().join("auth.json")).unwrap();
    let (_dir, engine) = engine_with_env_override(
        "pi",
        &pi.to_string_lossy(),
        json!({ "pi": { "PI_CODING_AGENT_DIR": agent.path().to_string_lossy() } }),
    );
    let catalog = catalog_of(call(&engine, "harness.models", json!({"harnessId": "pi"})));
    assert_eq!(catalog["status"], "enumerated", "{catalog}");
    let entries = catalog["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 1, "{catalog}");
    assert_eq!(entries[0]["id"], "kimi-for-coding");
    let scope = catalog["provenance"]["configScope"].as_str().unwrap();
    assert!(scope.contains("user config linked read-only"), "{scope}");
    assert!(
        scope.contains("auth.json"),
        "scope names what was linked: {scope}"
    );
    assert!(
        scope.contains("models.json"),
        "scope names what was linked: {scope}"
    );
    // The user's config dir is untouched: same bytes, exactly the files we
    // wrote (the probe linked them into its own private root, never wrote
    // through the links).
    assert_eq!(
        std::fs::read_to_string(agent.path().join("auth.json")).unwrap(),
        before
    );
    let mut names: Vec<String> = std::fs::read_dir(agent.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(names, vec!["auth.json", "models-store.json", "models.json"]);
}

#[test]
fn opencode_catalog_links_the_configured_config_and_data_dirs_read_only() {
    let script = "#!/bin/sh\n\
                  case \"$1\" in\n\
                  \x20 --version) echo '1.18.30'; exit 0 ;;\n\
                  \x20 models)\n\
                  \x20 if [ -e \"$OPENCODE_CONFIG_DIR/opencode.json\" ] && [ -e \"$XDG_DATA_HOME/auth.json\" ]; then\n\
                  \x20   echo 'anthropic/claude-sonnet-4-5';\n\
                  \x20 else\n\
                  \x20   echo 'opencode/big-pickle';\n\
                  \x20 fi\n\
                  \x20 exit 0 ;;\n\
                  *) exit 2 ;;\n\
                  esac\n";
    let (_bin, opencode) = fixture_bin("opencode", script);
    let config = tempfile::tempdir().unwrap();
    std::fs::write(config.path().join("opencode.json"), "{\"provider\":{}}").unwrap();
    let data = tempfile::tempdir().unwrap();
    std::fs::create_dir(data.path().join("opencode")).unwrap();
    std::fs::write(
        data.path().join("opencode").join("auth.json"),
        "{\"anthropic\":{\"type\":\"api\",\"key\":\"fixture\"}}",
    )
    .unwrap();
    let (_dir, engine) = engine_with_env_override(
        "opencode",
        &opencode.to_string_lossy(),
        json!({
            "opencode": {
                "OPENCODE_CONFIG_DIR": config.path().to_string_lossy(),
                "XDG_DATA_HOME": data.path().to_string_lossy()
            }
        }),
    );
    let catalog = catalog_of(call(
        &engine,
        "harness.models",
        json!({"harnessId": "opencode"}),
    ));
    assert_eq!(catalog["status"], "enumerated", "{catalog}");
    let entries = catalog["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 1, "{catalog}");
    assert_eq!(entries[0]["id"], "claude-sonnet-4-5");
    let scope = catalog["provenance"]["configScope"].as_str().unwrap();
    assert!(scope.contains("user config linked read-only"), "{scope}");
    assert!(scope.contains("opencode.json"), "{scope}");
    assert!(scope.contains("auth.json"), "{scope}");
    // Source dirs untouched: exactly the files we wrote, and OpenCode's
    // plugin node_modules landed in the probe's private root, not here.
    let mut config_names: Vec<String> = std::fs::read_dir(config.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    config_names.sort();
    assert_eq!(config_names, vec!["opencode.json"]);
    assert!(data.path().join("opencode").join("auth.json").is_file());
}
