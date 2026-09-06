//! Parity port of the Orca agent-session claim-identity capability.
//!
//! Public behavior is tested through the actual drogon-core library export.
//! Only the private Windows string seam is path-included for host-independent
//! tests; that does not prove native Windows behavior. The frozen source
//! suite — `src/main/runtime/agent-session-claim-identity.test.ts` at source
//! revision c97906287bb7a390b25e2025b600d9fb3c25d9c3 (3 cases / 7 assertion
//! evaluations) — is mapped case-by-case to the `source_case_*` tests below
//! and recorded in
//! tests/parity/ports/WP-ENG-RUNTIME/native-claim-identity/child-report.md.

#[path = "../src/claim_identity/windows_path.rs"]
mod windows_path;

use std::fs;
use std::path::Path;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use drogon_core::claim_identity::{
    self, AGENT_SESSION_CLAIM_DIGEST_VERSION, AgentProviderSessionKey,
    AgentProviderSessionMetadata, AgentSessionClaimSigner, COORDINATION_KEY_FILE,
    CanonicalAgentSessionIdentity, ClaimIdentityError, ProviderExecutionNamespace,
    RESUMABLE_TUI_AGENTS, ResumableTuiAgent, TRANSCRIPT_PATH_MAX_BYTES,
    canonicalize_agent_session_identity, create_ephemeral_agent_session_claim_signer,
    get_agent_resume_argv, has_unsafe_provider_session_id_chars, is_resumable_tui_agent,
    load_agent_session_claim_signer, normalize_agent_provider_session,
};
use serde_json::{Value, json};
use windows_path::normalize_windows_canonical_path;

fn fixed_key() -> [u8; 32] {
    std::array::from_fn(|i| i as u8)
}

fn namespace() -> ProviderExecutionNamespace {
    ProviderExecutionNamespace {
        machine: "machine".to_string(),
        principal: "user".to_string(),
        container: "native".to_string(),
        provider_root: "default".to_string(),
    }
}

fn codex_identity() -> CanonicalAgentSessionIdentity {
    canonicalize_agent_session_identity("codex", &json!({"key": "session_id", "id": "session-1"}))
        .expect("codex session-1 canonicalizes")
}

fn fixed_signer(domain: &str) -> AgentSessionClaimSigner {
    AgentSessionClaimSigner::try_new(domain, &fixed_key()).expect("fixed key is valid")
}

fn is_base64url(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn decode_hex(hex: &str) -> Vec<u8> {
    assert!(hex.len().is_multiple_of(2), "hex must have even length");
    (0..hex.len() / 2)
        .map(|i| u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).expect("valid hex"))
        .collect()
}

fn vectors_path() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(concat!(
        "../../tests/parity/ports/WP-ENG-RUNTIME/native-claim-identity/",
        "reference-vectors/vectors.json"
    ))
}

fn session_key_from_wire(wire: &str) -> AgentProviderSessionKey {
    match wire {
        "session_id" => AgentProviderSessionKey::SessionId,
        "conversation_id" => AgentProviderSessionKey::ConversationId,
        other => panic!("unsupported session key in vectors: {other}"),
    }
}

// ---------------------------------------------------------------------------
// Frozen source suite — case 1: "creates stable opaque identity and worktree
// digests" (source lines 11-36, 4 assertion evaluations).
// ---------------------------------------------------------------------------

#[test]
fn source_case_stable_opaque_identity_and_worktree_digests() {
    let signer = create_ephemeral_agent_session_claim_signer("profile-1")
        .expect("ephemeral signer from system entropy");
    let identity = codex_identity();
    let namespace = namespace();

    let first = signer.create_claim(&namespace, &identity, "worktree-1");
    let second = signer.create_claim(&namespace, &identity, "worktree-1");
    let other_worktree = signer.create_claim(&namespace, &identity, "worktree-2");

    // Source assertion 1: identical inputs produce equal claims (JS toEqual).
    assert_eq!(first, second);
    // Source assertion 2: the identity digest is opaque.
    assert!(!first.identity_digest.contains("session-1"));
    // Source assertion 3: the identity digest is stable across worktrees.
    assert_eq!(other_worktree.identity_digest, first.identity_digest);
    // Source assertion 4: the worktree scope digest changes across worktrees.
    assert_ne!(
        other_worktree.worktree_scope_digest,
        first.worktree_scope_digest
    );
    assert_eq!(first.digest_version, AGENT_SESSION_CLAIM_DIGEST_VERSION);
}

// ---------------------------------------------------------------------------
// Frozen source suite — case 2: "rejects malformed and unsupported provider
// identity" (source lines 38-45, 2 assertion evaluations).
// ---------------------------------------------------------------------------

#[test]
fn source_case_rejects_malformed_and_unsupported_provider_identity() {
    // Source assertion 5: a leading-hyphen Codex session id is rejected with
    // agent_session_identity_required.
    let err = canonicalize_agent_session_identity(
        "codex",
        &json!({"key": "session_id", "id": "-unsafe"}),
    )
    .expect_err("leading-hyphen id must be rejected");
    assert_eq!(err, ClaimIdentityError::IdentityRequired);
    assert_eq!(err.to_string(), "agent_session_identity_required");
    // Source assertion 6: an unsupported provider is rejected with
    // agent_session_identity_required.
    let err = canonicalize_agent_session_identity(
        "blank",
        &json!({"key": "session_id", "id": "session-1"}),
    )
    .expect_err("unsupported agent must be rejected");
    assert_eq!(err, ClaimIdentityError::IdentityRequired);
}

// ---------------------------------------------------------------------------
// Frozen source suite — case 3: "canonicalizes Prime identity by its
// transcript path" (source lines 47-70, 1 assertion evaluation).
// ---------------------------------------------------------------------------

#[test]
fn source_case_canonicalizes_prime_identity_by_transcript_path() {
    let dir = tempfile::tempdir().expect("temp dir");
    let transcript_path = dir.path().join("session.jsonl");
    fs::write(&transcript_path, "{}\n").expect("write transcript");

    // Source assertion 7: Prime keeps agent/provider values but replaces the
    // transcript path with its real canonical file path.
    let identity = canonicalize_agent_session_identity(
        "prime-agent",
        &json!({
            "key": "session_id",
            "id": "prime-session-1",
            "transcriptPath": transcript_path.to_str().expect("utf-8 temp path"),
        }),
    )
    .expect("prime identity with existing transcript canonicalizes");
    assert_eq!(identity.agent, ResumableTuiAgent::PrimeAgent);
    assert_eq!(
        identity.provider_session.key,
        AgentProviderSessionKey::SessionId
    );
    assert_eq!(identity.provider_session.id, "prime-session-1");
    let canonical = fs::canonicalize(&transcript_path).expect("canonical transcript path");
    assert_eq!(
        identity.provider_session.transcript_path.as_deref(),
        canonical.to_str()
    );
}

// ---------------------------------------------------------------------------
// Deterministic independent Node crypto reference vectors.
// ---------------------------------------------------------------------------

#[test]
fn node_reference_vectors_match_production_digests() {
    let raw = fs::read_to_string(vectors_path()).expect("read reference vectors");
    let parsed: Value = serde_json::from_str(&raw).expect("parse reference vectors");
    assert_eq!(
        parsed["sourceRevision"],
        "c97906287bb7a390b25e2025b600d9fb3c25d9c3"
    );
    let vectors = parsed["vectors"].as_array().expect("vectors array");
    assert_eq!(vectors.len(), 20);
    for vector in vectors {
        let name = vector["name"].as_str().expect("vector name");
        let key = decode_hex(vector["keyHex"].as_str().expect("key hex"));
        let signer = AgentSessionClaimSigner::try_new(
            vector["authorityDomainId"].as_str().expect("domain"),
            &key,
        )
        .expect("vector key is 32 bytes");
        assert_eq!(
            signer.key_id(),
            vector["expectedKeyId"].as_str().unwrap(),
            "{name} key id"
        );
        let ns = vector["namespace"].as_object().expect("namespace object");
        let namespace = ProviderExecutionNamespace {
            machine: ns["machine"].as_str().unwrap().to_string(),
            principal: ns["principal"].as_str().unwrap().to_string(),
            container: ns["container"].as_str().unwrap().to_string(),
            provider_root: ns["providerRoot"].as_str().unwrap().to_string(),
        };
        let agent = ResumableTuiAgent::from_agent_name(vector["agent"].as_str().expect("agent"))
            .expect("vector agent is resumable");
        let session = AgentProviderSessionMetadata {
            key: session_key_from_wire(vector["sessionKey"].as_str().expect("session key")),
            id: vector["sessionId"]
                .as_str()
                .expect("session id")
                .to_string(),
            transcript_path: vector["transcriptPath"]
                .as_str()
                .map(std::string::ToString::to_string),
        };
        let identity = CanonicalAgentSessionIdentity {
            agent,
            provider_session: session,
        };
        let claim = signer.create_claim(
            &namespace,
            &identity,
            vector["canonicalWorktreeId"].as_str().expect("worktree id"),
        );
        assert_eq!(
            claim.identity_digest,
            vector["expectedIdentityDigest"].as_str().unwrap(),
            "{name} identity digest"
        );
        assert_eq!(
            claim.worktree_scope_digest,
            vector["expectedWorktreeScopeDigest"].as_str().unwrap(),
            "{name} worktree scope digest"
        );
        assert_eq!(claim.digest_version, 1, "{name} digest version");
        assert_eq!(claim.agent, agent, "{name} claim agent passthrough");
    }
}

// ---------------------------------------------------------------------------
// Supported agents and provider-key rules.
// ---------------------------------------------------------------------------

#[test]
fn all_supported_resumable_agents_are_recognized() {
    for agent in RESUMABLE_TUI_AGENTS {
        assert!(is_resumable_tui_agent(agent), "{agent} must be resumable");
    }
    for unsupported in [
        "",
        "blank",
        "amp",
        "cursor",
        "command-code",
        "hermes",
        "Claude",
        "CLAUDE",
    ] {
        assert!(
            !is_resumable_tui_agent(unsupported),
            "{unsupported:?} must not be resumable"
        );
    }
}

/// Test-owned transcript file for Pi/Prime identity tests. RAII: the temp
/// dir (and its transcript) is removed when the fixture drops; canonicalization
/// resolves the file synchronously during the call, so the fixture only needs
/// to outlive that call.
struct TranscriptFixture {
    _dir: tempfile::TempDir,
    transcript: std::path::PathBuf,
}

impl TranscriptFixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("temp dir");
        let transcript = dir.path().join("session.jsonl");
        fs::write(&transcript, "{}\n").expect("write transcript");
        Self {
            _dir: dir,
            transcript,
        }
    }

    /// Provider-session metadata JSON naming this fixture's transcript.
    fn metadata_json(&self, agent: &str) -> Value {
        json!({
            "key": "session_id",
            "id": format!("{agent}-session-1"),
            "transcriptPath": self.transcript.to_str().expect("utf-8 temp path"),
        })
    }
}

#[test]
fn every_supported_agent_canonicalizes_with_its_provider_key_rule() {
    // session_id-keyed agents.
    for agent in [
        "claude",
        "codex",
        "gemini",
        "opencode",
        "mimo-code",
        "droid",
        "grok",
        "devin",
        "omp",
        "copilot",
        "kimi",
    ] {
        let identity = canonicalize_agent_session_identity(
            agent,
            &json!({"key": "session_id", "id": "session-1"}),
        )
        .unwrap_or_else(|err| panic!("{agent} with session_id must canonicalize: {err}"));
        assert_eq!(identity.agent.as_str(), agent);
        assert_eq!(
            identity.provider_session.key,
            AgentProviderSessionKey::SessionId
        );
    }
    // antigravity requires conversation_id.
    let identity = canonicalize_agent_session_identity(
        "antigravity",
        &json!({"key": "conversation_id", "id": "agy-1"}),
    )
    .expect("antigravity with conversation_id must canonicalize");
    assert_eq!(
        identity.provider_session.key,
        AgentProviderSessionKey::ConversationId
    );
    // Pi and Prime require an absolute transcript path naming a regular file.
    for agent in ["pi", "prime-agent"] {
        let fixture = TranscriptFixture::new();
        let identity = canonicalize_agent_session_identity(agent, &fixture.metadata_json(agent))
            .unwrap_or_else(|err| panic!("{agent} with transcript must canonicalize: {err}"));
        assert!(identity.provider_session.transcript_path.is_some());
    }
}

#[test]
fn provider_key_mismatches_are_rejected() {
    // Every session_id-keyed agent rejects conversation_id metadata.
    for agent in [
        "claude",
        "codex",
        "gemini",
        "opencode",
        "mimo-code",
        "droid",
        "grok",
        "devin",
        "omp",
        "copilot",
        "kimi",
        "pi",
        "prime-agent",
    ] {
        let err = canonicalize_agent_session_identity(
            agent,
            &json!({"key": "conversation_id", "id": "session-1"}),
        )
        .expect_err(&format!("{agent} with conversation_id must be rejected"));
        assert_eq!(err, ClaimIdentityError::IdentityRequired, "{agent}");
    }
    // antigravity rejects session_id metadata.
    let err = canonicalize_agent_session_identity(
        "antigravity",
        &json!({"key": "session_id", "id": "agy-1"}),
    )
    .expect_err("antigravity with session_id must be rejected");
    assert_eq!(err, ClaimIdentityError::IdentityRequired);
    // Pi/Prime without a transcript path have no resume argv.
    for agent in ["pi", "prime-agent"] {
        let err = canonicalize_agent_session_identity(
            agent,
            &json!({"key": "session_id", "id": "session-1"}),
        )
        .expect_err(&format!("{agent} without transcript must be rejected"));
        assert_eq!(err, ClaimIdentityError::IdentityRequired, "{agent}");
    }
}

#[test]
fn resume_argv_matches_source_rules_for_every_agent() {
    let session_id = |id: &str| AgentProviderSessionMetadata {
        key: AgentProviderSessionKey::SessionId,
        id: id.to_string(),
        transcript_path: None,
    };
    let transcript = "/tmp/pi-session.jsonl".to_string();
    let pi_session = AgentProviderSessionMetadata {
        transcript_path: Some(transcript.clone()),
        ..session_id("s1")
    };
    type ResumeArgvCase<'a> = (
        &'a str,
        AgentProviderSessionMetadata,
        Option<&'a str>,
        Option<Vec<&'a str>>,
    );
    let cases: &[ResumeArgvCase<'_>] = &[
        (
            "claude",
            session_id("s1"),
            None,
            Some(vec!["claude", "--resume", "s1"]),
        ),
        (
            "codex",
            session_id("s1"),
            None,
            Some(vec!["codex", "resume", "s1"]),
        ),
        (
            "gemini",
            session_id("s1"),
            None,
            Some(vec!["gemini", "--resume", "s1"]),
        ),
        (
            "antigravity",
            AgentProviderSessionMetadata {
                key: AgentProviderSessionKey::ConversationId,
                id: "s1".to_string(),
                transcript_path: None,
            },
            None,
            Some(vec!["agy", "--conversation", "s1"]),
        ),
        (
            "opencode",
            session_id("s1"),
            None,
            Some(vec!["opencode", "--session", "s1"]),
        ),
        (
            "pi",
            pi_session.clone(),
            None,
            Some(vec!["pi", "--session", "/tmp/pi-session.jsonl"]),
        ),
        (
            "mimo-code",
            session_id("s1"),
            None,
            Some(vec!["mimo", "--session", "s1"]),
        ),
        (
            "droid",
            session_id("s1"),
            None,
            Some(vec!["droid", "--resume", "s1"]),
        ),
        (
            "grok",
            session_id("s1"),
            None,
            Some(vec!["grok", "--resume", "s1"]),
        ),
        (
            "devin",
            session_id("abc12345"),
            None,
            Some(vec!["devin", "--resume", "abc12345"]),
        ),
        (
            "omp",
            session_id("s1"),
            None,
            Some(vec!["omp", "--resume", "s1"]),
        ),
        (
            "prime-agent",
            AgentProviderSessionMetadata {
                transcript_path: Some("/tmp/prime-session.jsonl".to_string()),
                ..session_id("s1")
            },
            None,
            Some(vec!["prime-agent", "--resume", "/tmp/prime-session.jsonl"]),
        ),
        (
            "copilot",
            session_id("s1"),
            None,
            Some(vec!["copilot", "--resume=s1"]),
        ),
        (
            "kimi",
            session_id("session_431324d7"),
            None,
            Some(vec!["kimi", "--session", "session_431324d7"]),
        ),
        // Provider-key mismatches and missing Pi transcripts yield no argv.
        (
            "claude",
            AgentProviderSessionMetadata {
                key: AgentProviderSessionKey::ConversationId,
                id: "s1".to_string(),
                transcript_path: None,
            },
            None,
            None,
        ),
        ("antigravity", session_id("s1"), None, None),
        ("pi", session_id("s1"), None, None),
        ("prime-agent", session_id("s1"), None, None),
        // omp prefers a non-blank resume file path (JS trim semantics).
        (
            "omp",
            session_id("s1"),
            Some("  /tmp/omp.json \n"),
            Some(vec!["omp", "--resume", "/tmp/omp.json"]),
        ),
        (
            "omp",
            session_id("s1"),
            Some("   "),
            Some(vec!["omp", "--resume", "s1"]),
        ),
        (
            "omp",
            session_id("s1"),
            Some(""),
            Some(vec!["omp", "--resume", "s1"]),
        ),
    ];
    for (agent, session, omp_path, expected) in cases {
        let agent = ResumableTuiAgent::from_agent_name(agent).expect("resumable agent");
        let argv = get_agent_resume_argv(agent, session, *omp_path);
        let expected_owned: Option<Vec<String>> = expected
            .as_ref()
            .map(|argv| argv.iter().map(|s| (*s).to_string()).collect());
        assert_eq!(argv.as_deref(), expected_owned.as_deref(), "{agent:?} argv");
    }
}

// ---------------------------------------------------------------------------
// Metadata normalization: JS UTF-16 length, JS trim and control characters.
// ---------------------------------------------------------------------------

#[test]
fn provider_session_id_utf16_length_and_trim_boundaries() {
    let normalize_id = |id: &str| {
        normalize_agent_provider_session(&json!({"key": "session_id", "id": id}))
            .map(|session| session.id)
    };
    // 512 UTF-16 code units accepted, 513 rejected (JS String.length semantics).
    assert_eq!(
        normalize_id(&"a".repeat(512)).as_deref(),
        Some("a".repeat(512).as_str())
    );
    assert_eq!(normalize_id(&"a".repeat(513)), None);
    // 256 astral chars = 512 UTF-16 units accepted; 257 astral chars rejected.
    assert_eq!(
        normalize_id(&"😀".repeat(256)).as_deref(),
        Some("😀".repeat(256).as_str())
    );
    assert_eq!(normalize_id(&"😀".repeat(257)), None);
    // Mixed BMP + astral: 512 units accepted; 516 rejected.
    let mixed_ok = format!("{}😀b", "a".repeat(509));
    assert_eq!(normalize_id(&mixed_ok).as_deref(), Some(mixed_ok.as_str()));
    let mixed_bad = format!("{}😀b", "a".repeat(513));
    assert_eq!(normalize_id(&mixed_bad), None);
}

#[test]
fn provider_session_id_uses_javascript_trim_and_rejects_unsafe_chars() {
    let normalize_id = |id: &str| {
        normalize_agent_provider_session(&json!({"key": "session_id", "id": id}))
            .map(|session| session.id)
    };
    // Every JS WhiteSpace/LineTerminator trim code point is stripped.
    for pad in [
        '\u{9}', '\u{a}', '\u{b}', '\u{c}', '\u{d}', '\u{20}', '\u{a0}', '\u{1680}', '\u{2000}',
        '\u{2001}', '\u{2002}', '\u{2003}', '\u{2004}', '\u{2005}', '\u{2006}', '\u{2007}',
        '\u{2008}', '\u{2009}', '\u{200a}', '\u{2028}', '\u{2029}', '\u{202f}', '\u{205f}',
        '\u{3000}', '\u{feff}',
    ] {
        let padded = format!("{pad}ok{pad}");
        assert_eq!(normalize_id(&padded).as_deref(), Some("ok"), "trim {pad:?}");
    }
    // Inner control characters are rejected, not trimmed.
    for bad in [
        "bad\nid",
        "bad\tid",
        "bad\u{b}id",
        "bad\u{c}id",
        "bad\rid",
        "bad\u{0}id",
        "bad\u{7f}id",
    ] {
        assert_eq!(normalize_id(bad), None, "reject {bad:?}");
    }
    // Leading hyphen (after trim) rejected; astral and Unicode letters allowed.
    assert_eq!(normalize_id("-last"), None);
    assert_eq!(normalize_id("  -last"), None);
    assert_eq!(normalize_id("id-"), Some("id-".to_string()));
    assert_eq!(normalize_id("会话-🚀"), Some("会话-🚀".to_string()));
    // Whitespace-only and empty ids rejected.
    assert_eq!(normalize_id("   "), None);
    assert_eq!(normalize_id(""), None);
}

#[test]
fn unsafe_provider_session_id_char_classification() {
    assert!(!has_unsafe_provider_session_id_chars(""));
    assert!(!has_unsafe_provider_session_id_chars("safe-会话_🚀"));
    for code in 0u32..=0x1f {
        let c = char::from_u32(code).unwrap();
        assert!(
            has_unsafe_provider_session_id_chars(&format!("a{c}b")),
            "reject U+{code:04X}"
        );
    }
    assert!(has_unsafe_provider_session_id_chars("a\u{7f}b"));
    assert!(!has_unsafe_provider_session_id_chars("a\u{80}b"));
}

#[test]
fn normalize_agent_provider_session_metadata_rules() {
    // Non-object or null raw values.
    for raw in [
        Value::Null,
        json!("x"),
        json!(7),
        json!(["session_id"]),
        json!(true),
    ] {
        assert_eq!(normalize_agent_provider_session(&raw), None, "raw {raw}");
    }
    // Key must be exactly session_id or conversation_id as a string.
    assert_eq!(
        normalize_agent_provider_session(&json!({"key": "sessionId", "id": "x"})),
        None
    );
    assert_eq!(
        normalize_agent_provider_session(&json!({"key": 7, "id": "x"})),
        None
    );
    assert_eq!(normalize_agent_provider_session(&json!({"id": "x"})), None);
    // Non-string id rejected.
    assert_eq!(
        normalize_agent_provider_session(&json!({"key": "session_id", "id": 7})),
        None
    );
    // conversation_id round-trip.
    let session = normalize_agent_provider_session(&json!({"key": "conversation_id", "id": "agy"}))
        .expect("conversation_id metadata");
    assert_eq!(session.key, AgentProviderSessionKey::ConversationId);
    assert_eq!(session.id, "agy");
    assert_eq!(session.transcript_path, None);
}

#[test]
fn normalize_transcript_path_rules() {
    // Only the camelCase transcriptPath key is read during normalization;
    // the snake_case hook key is ignored (hook extraction is resume-side and
    // outside this capability).
    let session = normalize_agent_provider_session(&json!({
        "key": "session_id",
        "id": "ok",
        "transcriptPath": " /tmp/x.jsonl "
    }))
    .expect("transcript metadata");
    assert_eq!(session.transcript_path.as_deref(), Some("/tmp/x.jsonl"));
    let session = normalize_agent_provider_session(&json!({
        "key": "session_id",
        "id": "ok",
        "transcript_path": "/tmp/hook.jsonl"
    }))
    .expect("snake_case ignored");
    assert_eq!(session.transcript_path, None);
    // Control characters, empty and whitespace-only transcript paths are
    // dropped (not fatal to the id).
    for bad in ["", "   ", "/tmp/bad\npath.jsonl", "/tmp/bad\u{7f}.jsonl"] {
        let session = normalize_agent_provider_session(&json!({
            "key": "session_id",
            "id": "ok",
            "transcriptPath": bad
        }))
        .expect("bad transcript path drops");
        assert_eq!(session.transcript_path, None, "transcript {bad:?}");
    }
    // Non-string transcript paths are ignored.
    let session = normalize_agent_provider_session(&json!({
        "key": "session_id",
        "id": "ok",
        "transcriptPath": 42
    }))
    .expect("non-string transcript ignored");
    assert_eq!(session.transcript_path, None);
}

// ---------------------------------------------------------------------------
// Pi/Prime transcript path canonicalization on the execution host.
// ---------------------------------------------------------------------------

fn prime_metadata(transcript_path: &Path) -> Value {
    json!({
        "key": "session_id",
        "id": "prime-session-1",
        "transcriptPath": transcript_path.to_str().expect("utf-8 path")
    })
}

#[test]
fn transcript_path_must_be_absolute() {
    let err = canonicalize_agent_session_identity(
        "prime-agent",
        &prime_metadata(Path::new("relative/session.jsonl")),
    )
    .expect_err("relative transcript path must be rejected");
    assert_eq!(err, ClaimIdentityError::IdentityRequired);
}

#[test]
fn transcript_path_over_the_utf8_byte_bound_is_rejected_before_filesystem_access() {
    // 16 KiB + 1 UTF-8 bytes: rejected by the bound alone, no fs error.
    let long_name = format!("/{}", "a".repeat(TRANSCRIPT_PATH_MAX_BYTES));
    let err =
        canonicalize_agent_session_identity("prime-agent", &prime_metadata(Path::new(&long_name)))
            .expect_err("over-bound transcript path must be rejected");
    assert_eq!(err, ClaimIdentityError::IdentityRequired);
    // Exactly 16 KiB bytes passes the bound; such a path cannot exist on
    // Darwin (PATH_MAX ~1024), so the failure surfaces as a native fs error.
    let edge_name = format!("/{}", "a".repeat(TRANSCRIPT_PATH_MAX_BYTES - 1));
    let err =
        canonicalize_agent_session_identity("prime-agent", &prime_metadata(Path::new(&edge_name)))
            .expect_err("exactly-bound nonexistent transcript must fail");
    assert!(
        matches!(err, ClaimIdentityError::Io { .. }),
        "expected native fs error, got {err:?}"
    );
}

#[test]
fn missing_transcript_path_is_a_native_filesystem_error_not_identity_rejection() {
    let dir = tempfile::tempdir().expect("temp dir");
    let missing = dir.path().join("missing.jsonl");
    let err = canonicalize_agent_session_identity("prime-agent", &prime_metadata(&missing))
        .expect_err("missing transcript must fail");
    assert!(
        matches!(err, ClaimIdentityError::Io { .. }),
        "expected native fs error, got {err:?}"
    );
}

#[test]
fn directory_transcript_path_is_identity_rejected() {
    let dir = tempfile::tempdir().expect("temp dir");
    let err = canonicalize_agent_session_identity("pi", &prime_metadata(dir.path()))
        .expect_err("directory transcript must be rejected");
    assert_eq!(err, ClaimIdentityError::IdentityRequired);
}

#[cfg(unix)]
#[test]
fn symlink_transcript_resolves_to_its_regular_file_target() {
    use std::os::unix::fs::symlink;
    let dir = tempfile::tempdir().expect("temp dir");
    let target = dir.path().join("target.jsonl");
    fs::write(&target, "{}\n").expect("write target");
    let link = dir.path().join("link.jsonl");
    symlink(&target, &link).expect("symlink");
    let identity = canonicalize_agent_session_identity("prime-agent", &prime_metadata(&link))
        .expect("symlink to regular file resolves");
    let canonical_target = fs::canonicalize(&target).expect("canonical target");
    assert_eq!(
        identity.provider_session.transcript_path.as_deref(),
        canonical_target.to_str()
    );
    // A symlink to a directory is not a regular file: identity rejection.
    let dir_link = dir.path().join("dir-link");
    symlink(dir.path(), &dir_link).expect("dir symlink");
    let err = canonicalize_agent_session_identity("prime-agent", &prime_metadata(&dir_link))
        .expect_err("symlink to directory must be rejected");
    assert_eq!(err, ClaimIdentityError::IdentityRequired);
    // A broken symlink is a native filesystem error (realpath fails).
    let broken = dir.path().join("broken.jsonl");
    symlink(dir.path().join("nowhere.jsonl"), &broken).expect("broken symlink");
    let err = canonicalize_agent_session_identity("prime-agent", &prime_metadata(&broken))
        .expect_err("broken symlink must fail");
    assert!(
        matches!(err, ClaimIdentityError::Io { .. }),
        "expected native fs error, got {err:?}"
    );
}

#[test]
fn dot_segments_and_platform_aliases_are_canonicalized() {
    let dir = tempfile::tempdir().expect("temp dir");
    let transcript = dir.path().join("sub").join("session.jsonl");
    fs::create_dir_all(transcript.parent().expect("parent")).expect("mkdir");
    fs::write(&transcript, "{}\n").expect("write transcript");
    // Feed a path containing `.` and `..` segments; canonicalization must
    // resolve them to the same canonical identity as the direct path.
    let messy = dir
        .path()
        .join("sub")
        .join(".")
        .join("..")
        .join("sub")
        .join("session.jsonl");
    let identity = canonicalize_agent_session_identity("prime-agent", &prime_metadata(&messy))
        .expect("messy path canonicalizes");
    let canonical = fs::canonicalize(&transcript).expect("canonical");
    assert_eq!(
        identity.provider_session.transcript_path.as_deref(),
        canonical.to_str()
    );
}

#[cfg(target_os = "macos")]
#[test]
fn darwin_canonicalizes_var_aliases() {
    // Darwin resolves the /var -> /private/var alias exactly like Node's
    // realpathSync. This expectation is Darwin-only; see child-report.md for
    // the honest Windows/Linux posture.
    assert_eq!(
        fs::canonicalize("/tmp").expect("canonical /tmp"),
        std::path::PathBuf::from("/private/tmp")
    );
    let dir = tempfile::tempdir().expect("temp dir");
    let canonical = fs::canonicalize(dir.path()).expect("canonical tempdir");
    assert!(
        canonical.starts_with("/private/var/folders"),
        "macOS tempdir canonicalizes under /private/var/folders, got {canonical:?}"
    );
}

// ---------------------------------------------------------------------------
// Windows canonical-path normalization (pure seam).
//
// Rust's fs::canonicalize documents extended-length (`\\?\`) output on
// Windows, while the pinned source signs Node 24.19.0 realpathSync spellings
// (lib/fs.js: realpathSync is a pure-JS walk over path.resolve output that
// returns ordinary spellings and preserves only explicitly typed device
// namespaces). These pure string tests pin the exact mapping on any host;
// they prove the transformation only — no Windows runtime parity is claimed
// from macOS. cfg(windows) real-filesystem tests below execute only on
// Windows.
// ---------------------------------------------------------------------------

#[test]
fn windows_pure_normalization_ordinary_drive_strips_extended_prefix() {
    // Ordinary drive input: Node realpathSync returns the ordinary spelling;
    // Rust canonicalize returns `\\?\C:\...`. Sign the Node spelling.
    assert_eq!(
        normalize_windows_canonical_path("C:\\Foo\\Bar.txt", "\\\\?\\C:\\Foo\\Bar.txt"),
        "c:\\foo\\bar.txt"
    );
    // Forward-slash input shape resolves identically on both sides.
    assert_eq!(
        normalize_windows_canonical_path("C:/Foo/Bar.txt", "\\\\?\\C:\\Foo\\Bar.txt"),
        "c:\\foo\\bar.txt"
    );
}

#[test]
fn windows_pure_normalization_ordinary_unc_maps_to_double_slash() {
    // Ordinary UNC input: Node returns `\\server\share\...`; Rust
    // canonicalize returns `\\?\UNC\server\share\...`.
    assert_eq!(
        normalize_windows_canonical_path(
            "\\\\Server\\Share\\X.jsonl",
            "\\\\?\\UNC\\Server\\Share\\X.jsonl"
        ),
        "\\\\server\\share\\x.jsonl"
    );
}

#[test]
fn windows_pure_normalization_namespaced_drive_input_preserves_prefix() {
    // Explicitly namespaced drive input: Node's path.win32.resolve treats
    // `\\?` as a device root (lib/path.js firstPart === '?') and realpathSync
    // preserves it, so the signed bytes keep the prefix. Rust canonicalize
    // also keeps the extended-length form for such inputs.
    assert_eq!(
        normalize_windows_canonical_path("\\\\?\\C:\\Foo", "\\\\?\\C:\\Foo"),
        "\\\\?\\c:\\foo"
    );
    assert_eq!(
        normalize_windows_canonical_path("//?/C:/Foo", "\\\\?\\C:\\Foo"),
        "\\\\?\\c:\\foo"
    );
}

#[test]
fn windows_pure_normalization_namespaced_unc_input_preserves_prefix() {
    assert_eq!(
        normalize_windows_canonical_path(
            "\\\\?\\UNC\\Server\\Share\\X",
            "\\\\?\\UNC\\Server\\Share\\X"
        ),
        "\\\\?\\unc\\server\\share\\x"
    );
}

#[test]
fn windows_pure_normalization_dot_namespace_drive_reconstructs_source_spelling() {
    // Node path.win32.resolve (lib/path.js line 280-289) treats a leading
    // `\\.` as a device root and preserves the typed namespace verbatim;
    // realpathSync keeps it (fs.js splitRoot). Rust canonicalize reports the
    // same file as `\\?\C:\...`, so the seam must reconstruct the source's
    // `\\.` spelling instead of keeping the canonical `\\?`.
    assert_eq!(
        normalize_windows_canonical_path("\\\\.\\C:\\Foo", "\\\\?\\C:\\Foo"),
        "\\\\.\\c:\\foo"
    );
    // Separator normalization is established: isPathSeparator accepts '/'
    // and '\' (lib/path.js line 65-67), and resolve rewrites the tail to
    // backslashes, so `//./C:/Foo` signs exactly like `\\.\C:\Foo`.
    assert_eq!(
        normalize_windows_canonical_path("//./C:/Foo", "\\\\?\\C:\\Foo"),
        "\\\\.\\c:\\foo"
    );
}

#[test]
fn windows_pure_normalization_dot_namespace_unc_reconstructs_source_spelling() {
    // `\\.\UNC\server\share` is the valid device-namespace UNC form; Node
    // preserves the `\\.` device root through resolve/realpathSync just like
    // a drive device path.
    assert_eq!(
        normalize_windows_canonical_path(
            "\\\\.\\UNC\\Server\\Share\\X",
            "\\\\?\\UNC\\Server\\Share\\X"
        ),
        "\\\\.\\unc\\server\\share\\x"
    );
}

#[test]
fn windows_pure_normalization_unprefixed_canonical_passes_through_lowercased() {
    // Robustness: a canonical spelling without the prefix (not produced by
    // canonicalize for ordinary Windows paths) is lowercased unchanged, and
    // volume-GUID forms are never remapped.
    assert_eq!(
        normalize_windows_canonical_path("C:\\Foo", "C:\\Foo"),
        "c:\\foo"
    );
    assert_eq!(
        normalize_windows_canonical_path(
            "\\\\?\\Volume{26ee5c40-7a1a-21db-a13b-000000000001}\\Foo",
            "\\\\?\\Volume{26ee5c40-7a1a-21db-a13b-000000000001}\\Foo"
        ),
        "\\\\?\\volume{26ee5c40-7a1a-21db-a13b-000000000001}\\foo"
    );
}

#[cfg(windows)]
#[test]
fn windows_real_filesystem_transcript_canonicalization_uses_node_spellings() {
    // Executes only on Windows (untested on the macOS development host; no
    // runtime parity is claimed until a Windows run records it).
    let dir = tempfile::tempdir().expect("temp dir");
    let transcript = dir.path().join("Session.JSONL");
    fs::write(&transcript, "{}\n").expect("write transcript");
    let identity = canonicalize_agent_session_identity(
        "prime-agent",
        &json!({
            "key": "session_id",
            "id": "win-session-1",
            "transcriptPath": transcript.to_str().expect("utf-8 path"),
        }),
    )
    .expect("Windows canonicalization");
    let canonical = identity
        .provider_session
        .transcript_path
        .expect("canonical transcript path");
    assert!(
        !canonical.starts_with("\\\\?\\"),
        "extended-length prefix must be stripped for ordinary inputs: {canonical}"
    );
    assert_eq!(
        canonical,
        canonical.to_lowercase(),
        "signed path must be en-US lowercased: {canonical}"
    );
    let rust_canonical = fs::canonicalize(&transcript).expect("rust canonicalize");
    let expected = normalize_windows_canonical_path(
        transcript.to_str().expect("utf-8 path"),
        rust_canonical.to_str().expect("utf-8 path"),
    );
    assert_eq!(canonical, expected);
}

#[cfg(windows)]
#[test]
fn windows_real_filesystem_symlink_transcript_resolves_to_prefix_free_target() {
    // Symlink-to-target: both the source's realpathSync walk and Rust's
    // canonicalize resolve to the final target; the seam must only strip the
    // prefix. Requires Windows developer mode or SeCreateSymbolicLinkPrivilege.
    use std::os::windows::fs::symlink_file;
    let dir = tempfile::tempdir().expect("temp dir");
    let target = dir.path().join("Target.jsonl");
    fs::write(&target, "{}\n").expect("write target");
    let link = dir.path().join("Link.jsonl");
    symlink_file(&target, &link).expect("symlink_file privileges");
    let identity = canonicalize_agent_session_identity(
        "prime-agent",
        &json!({
            "key": "session_id",
            "id": "win-session-1",
            "transcriptPath": link.to_str().expect("utf-8 path"),
        }),
    )
    .expect("Windows symlink canonicalization");
    let canonical = identity
        .provider_session
        .transcript_path
        .expect("canonical transcript path");
    assert!(
        !canonical.starts_with("\\\\?\\"),
        "extended-length prefix must be stripped after symlink resolution: {canonical}"
    );
    let rust_target = fs::canonicalize(&target).expect("rust canonicalize target");
    let expected = normalize_windows_canonical_path(
        target.to_str().expect("utf-8 path"),
        rust_target.to_str().expect("utf-8 path"),
    );
    assert_eq!(canonical, expected);
}

#[cfg(windows)]
#[test]
fn windows_long_path_survives_production_canonicalization_validation_and_signed_mapping() {
    // Windows-gated exercise, not yet executed on the macOS development host.
    // When actually run on Windows, this test exercises that a transcript
    // path longer than MAX_PATH (260) survives the production flow:
    // fs::canonicalize, raw-PathBuf regular-file validation, and the
    // signed-string mapping seam, and it asserts the resulting signed string.
    // Whether the pinned Node source actually rejects ordinary >MAX_PATH
    // inputs on Windows (its pure-JS realpath stats unprefixed components)
    // while Rust std succeeds via its internal verbatim switch is an OPEN
    // QUESTION requiring a real Windows Node 24 vs Rust run — this test by
    // itself proves neither that ordering claim nor any parity/divergence.
    // If it ever fails when run, the first suspect is validation being
    // reordered onto the prefix-stripped spelling.
    let base = tempfile::tempdir().expect("temp dir");
    let mut long_path = base.path().to_path_buf();
    // Filesystem mutations use an explicit `\\?\`-prefixed absolute spelling
    // so the >MAX_PATH fixture can be created and cleaned up at all; the
    // production input below stays the ordinary spelling. Each component
    // stays well under the 255-component limit.
    let mut fs_path = std::path::PathBuf::from(format!("\\\\?\\{}", base.path().display()));
    while long_path.display().to_string().len() < 300 {
        let component = format!("segment-{:04}", long_path.components().count());
        long_path.push(&component);
        fs_path.push(&component);
        fs::create_dir_all(&fs_path).expect("create long-path directory");
    }
    let transcript = long_path.join("Session.JSONL");
    let transcript_fs = fs_path.join("Session.JSONL");
    fs::write(&transcript_fs, "{}\n").expect("write long-path transcript");
    let ordinary = transcript.to_str().expect("utf-8 path");
    assert!(
        ordinary.len() > 260,
        "fixture path must exceed MAX_PATH, got {} bytes",
        ordinary.len()
    );

    let identity = canonicalize_agent_session_identity(
        "prime-agent",
        &json!({
            "key": "session_id",
            "id": "win-long-path-1",
            "transcriptPath": ordinary,
        }),
    )
    .expect("long-path canonicalization validates the raw prefixed PathBuf");
    let signed = identity
        .provider_session
        .transcript_path
        .expect("signed transcript path");
    assert!(
        !signed.starts_with("\\\\?\\"),
        "signed string is mapped to the source spelling: {signed}"
    );
    assert_eq!(
        signed,
        signed.to_lowercase(),
        "signed path must be en-US lowercased: {signed}"
    );
    assert!(signed.ends_with("session.jsonl"), "signed path: {signed}");
    let rust_canonical = fs::canonicalize(&transcript).expect("rust canonicalize");
    let expected =
        normalize_windows_canonical_path(ordinary, rust_canonical.to_str().expect("utf-8 path"));
    assert_eq!(signed, expected);
}

// ---------------------------------------------------------------------------
// Claim structure, key-id derivation, domain and namespace separation.
// ---------------------------------------------------------------------------

#[test]
fn claim_wire_shape_matches_source_contract() {
    let signer = fixed_signer("profile-1");
    let claim: claim_identity::AgentSessionExecutionClaim =
        signer.create_claim(&namespace(), &codex_identity(), "worktree-1");
    assert_eq!(claim.digest_version, 1);
    // key id: base64url(sha256(key)) truncated to 22 chars.
    assert_eq!(signer.key_id().len(), 22);
    assert!(is_base64url(signer.key_id()));
    // digests: 32-byte HMAC-SHA256 as 43-char base64url without padding.
    for digest in [&claim.identity_digest, &claim.worktree_scope_digest] {
        assert_eq!(digest.len(), 43, "digest {digest}");
        assert!(is_base64url(digest));
        assert!(!digest.contains('='));
    }
    assert_eq!(claim.agent, ResumableTuiAgent::Codex);
}

#[test]
fn fixed_test_key_derives_expected_key_id() {
    // base64url(sha256(0x00..0x1f)) truncated to 22 chars, computed with the
    // pinned Node 24 runtime and cross-checked by every reference vector's
    // expectedKeyId field.
    let signer = fixed_signer("profile-1");
    assert_eq!(signer.key_id(), "Yw3NKWbEM2aRElRIu7JbT_");
}

#[test]
fn domain_namespace_and_worktree_separation() {
    let base =
        fixed_signer("profile-1").create_claim(&namespace(), &codex_identity(), "worktree-1");
    // A different authority domain id re-keys both digests.
    let other_domain =
        fixed_signer("profile-2").create_claim(&namespace(), &codex_identity(), "worktree-1");
    assert_ne!(other_domain.identity_digest, base.identity_digest);
    assert_ne!(
        other_domain.worktree_scope_digest,
        base.worktree_scope_digest
    );
    // Each namespace field contributes to both digests.
    for (field, value) in [
        ("machine", "other-machine"),
        ("principal", "other-principal"),
        ("container", "other-container"),
        ("provider_root", "other-provider-root"),
    ] {
        let mut ns = namespace();
        match field {
            "machine" => ns.machine = value.to_string(),
            "principal" => ns.principal = value.to_string(),
            "container" => ns.container = value.to_string(),
            _ => ns.provider_root = value.to_string(),
        }
        let claim = fixed_signer("profile-1").create_claim(&ns, &codex_identity(), "worktree-1");
        assert_ne!(claim.identity_digest, base.identity_digest, "{field}");
        assert_ne!(
            claim.worktree_scope_digest, base.worktree_scope_digest,
            "{field}"
        );
    }
    // A different agent changes the identity digest.
    let claude = canonicalize_agent_session_identity(
        "claude",
        &json!({"key": "session_id", "id": "session-1"}),
    )
    .expect("claude identity");
    let claim = fixed_signer("profile-1").create_claim(&namespace(), &claude, "worktree-1");
    assert_ne!(claim.identity_digest, base.identity_digest);
    // Swapping the worktree id into the identity does not collide: labels and
    // field order keep the two HMAC domains apart.
    let swapped =
        fixed_signer("profile-1").create_claim(&namespace(), &codex_identity(), "session-1");
    assert_ne!(swapped.worktree_scope_digest, base.identity_digest);
    // Different session id changes the identity digest but not the worktree digest.
    let other_id = canonicalize_agent_session_identity(
        "codex",
        &json!({"key": "session_id", "id": "session-2"}),
    )
    .expect("codex session-2");
    let claim = fixed_signer("profile-1").create_claim(&namespace(), &other_id, "worktree-1");
    assert_ne!(claim.identity_digest, base.identity_digest);
    assert_eq!(claim.worktree_scope_digest, base.worktree_scope_digest);
}

#[test]
fn ephemeral_signers_use_system_entropy_and_are_deterministic_per_signer() {
    let first = create_ephemeral_agent_session_claim_signer("profile-1").expect("ephemeral");
    let second = create_ephemeral_agent_session_claim_signer("profile-1").expect("ephemeral");
    assert_ne!(
        first.key_id(),
        second.key_id(),
        "system entropy keys differ"
    );
    let identity = codex_identity();
    let claim_a = first.create_claim(&namespace(), &identity, "worktree-1");
    let claim_b = first.create_claim(&namespace(), &identity, "worktree-1");
    assert_eq!(claim_a, claim_b, "same signer is deterministic");
}

#[test]
fn signer_rejects_wrong_length_keys_with_ownership_unknown() {
    for len in [0, 31, 33, 64] {
        let err = AgentSessionClaimSigner::try_new("profile-1", &vec![7u8; len])
            .expect_err("wrong-length key must fail");
        assert_eq!(err, ClaimIdentityError::OwnershipUnknown, "len {len}");
        assert_eq!(err.to_string(), "agent_session_ownership_unknown");
    }
}

#[test]
fn signer_debug_never_exposes_secret_key_bytes() {
    let key = fixed_key();
    let signer = AgentSessionClaimSigner::try_new("profile-1", &key).expect("signer");
    let debug = format!("{signer:?}");
    let hex_key: String = key.iter().map(|b| format!("{b:02x}")).collect();
    let b64_key = BASE64_STANDARD.encode(key);
    assert!(!debug.contains(&hex_key), "hex key leaked into Debug");
    assert!(!debug.contains(&b64_key), "base64 key leaked into Debug");
    assert!(
        debug.contains("redacted"),
        "Debug marks the key redacted: {debug}"
    );
    // Claims carry only digests and the key id — never raw key material.
    let claim = signer.create_claim(&namespace(), &codex_identity(), "worktree-1");
    let claim_debug = format!("{claim:?}");
    assert!(!claim_debug.contains(&hex_key));
    assert!(!claim_debug.contains(&b64_key));
}

// ---------------------------------------------------------------------------
// Persistent coordination keys: exclusive creation, fail-closed loading.
// ---------------------------------------------------------------------------

fn key_file(dir: &Path) -> std::path::PathBuf {
    dir.join(COORDINATION_KEY_FILE)
}

#[test]
fn persistent_key_is_created_exclusively_with_restrictive_permissions_and_reused() {
    let dir = tempfile::tempdir().expect("temp dir");
    let signer =
        load_agent_session_claim_signer(dir.path(), "profile-1").expect("first load creates");
    let bytes = fs::read(key_file(dir.path())).expect("read key file");
    assert_eq!(bytes.len(), 32, "persistent key is 32 bytes");
    // Restrictive Unix mode: the source opens with 0o600 subject to the
    // process umask, so no group/other bits may survive.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(key_file(dir.path()))
            .expect("key metadata")
            .permissions()
            .mode();
        assert_eq!(mode & 0o077, 0, "no group/other bits, got {mode:o}");
    }
    // Re-loading reuses the same key (no rotation, stable key id).
    let reloaded = load_agent_session_claim_signer(dir.path(), "profile-1").expect("reload");
    assert_eq!(reloaded.key_id(), signer.key_id());
    assert_eq!(fs::read(key_file(dir.path())).expect("reread"), bytes);
}

#[test]
fn corrupt_or_replaced_keys_fail_closed_without_rotation() {
    for (label, bytes) in [
        ("empty", vec![]),
        ("short-31", vec![9u8; 31]),
        ("long-33", vec![9u8; 33]),
        ("replaced-64", vec![9u8; 64]),
    ] {
        let dir = tempfile::tempdir().expect("temp dir");
        fs::write(key_file(dir.path()), &bytes).expect("seed corrupt key");
        let err = load_agent_session_claim_signer(dir.path(), "profile-1")
            .expect_err("corrupt key must fail closed");
        assert_eq!(err, ClaimIdentityError::OwnershipUnknown, "{label}");
        // Fail closed: the corrupt bytes are never rotated or rewritten.
        assert_eq!(
            fs::read(key_file(dir.path())).expect("reread"),
            bytes,
            "{label}"
        );
    }
}

#[test]
fn pre_seeded_valid_key_is_loaded_without_replacement() {
    let dir = tempfile::tempdir().expect("temp dir");
    let seeded: [u8; 32] = std::array::from_fn(|i| 0xa0 + i as u8);
    fs::write(key_file(dir.path()), seeded).expect("seed key");
    let signer = load_agent_session_claim_signer(dir.path(), "profile-1").expect("load seeded");
    let expected = AgentSessionClaimSigner::try_new("profile-1", &seeded).expect("signer");
    assert_eq!(
        signer.key_id(),
        expected.key_id(),
        "seeded key reused, not rotated"
    );
    assert_eq!(
        fs::read(key_file(dir.path())).expect("reread"),
        seeded.to_vec()
    );
}

#[test]
fn key_path_colliding_with_a_directory_is_a_native_filesystem_error() {
    let dir = tempfile::tempdir().expect("temp dir");
    fs::create_dir(key_file(dir.path())).expect("directory at key path");
    let err = load_agent_session_claim_signer(dir.path(), "profile-1")
        .expect_err("directory at key path must fail");
    assert!(
        matches!(err, ClaimIdentityError::Io { .. }),
        "expected native fs error, got {err:?}"
    );
}

#[test]
fn concurrent_first_creators_converge_on_one_winner() {
    let dir = tempfile::tempdir().expect("temp dir");
    let shared = dir.path().to_path_buf();
    let threads: Vec<_> = (0..8)
        .map(|_| {
            let path = shared.clone();
            std::thread::spawn(move || {
                load_agent_session_claim_signer(&path, "profile-1")
                    .expect("concurrent load")
                    .key_id()
                    .to_string()
            })
        })
        .collect();
    let key_ids: Vec<String> = threads
        .into_iter()
        .map(|t| t.join().expect("join"))
        .collect();
    let winner = key_ids[0].clone();
    assert!(
        key_ids.iter().all(|id| id == &winner),
        "all concurrent creators agree on one winner key"
    );
    assert_eq!(
        fs::read(key_file(dir.path())).expect("winner bytes").len(),
        32
    );
}

#[test]
fn distinct_profile_directories_hold_distinct_keys() {
    let first = tempfile::tempdir().expect("temp dir");
    let second = tempfile::tempdir().expect("temp dir");
    let a = load_agent_session_claim_signer(first.path(), "profile-1").expect("load");
    let b = load_agent_session_claim_signer(second.path(), "profile-1").expect("load");
    assert_ne!(a.key_id(), b.key_id());
}
