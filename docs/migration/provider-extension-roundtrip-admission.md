# Provider-record extension roundtripping — admission report

## Root correction verification — 2026-09-06 21:29 UTC

Three independent read-only reviews of clean `3c91fff` completed through
Orca (Muse, Sonnet, Kimi); root triage is PR #5 comment 5562259983. The
launchEnv finding is addressed below. Root read the entire follow-up diff,
checked the three published correction hashes, and independently reran the
locked/offline workspace tests, all-target Clippy and fmt: all passed.
The extra fourth file is the retained behavioral-RED log; it is explicitly
admitted here as evidence, correcting the worker summary's three-file claim.
No source matrix or historical receipt was modified. Aggregate extension
resource policy remains open; no arbitrary limit was substituted for parity.

## Root integration verification — 2026-09-06 21:05 UTC

After worker settlement, root fast-forwarded this worktree to main 7269184
without conflicts or lost drafts. Independent full workspace tests passed
378/0, with one marker-only probe ignored in ordinary enumeration and run
by its owning test. Strict all-target Clippy (`-D warnings`), cargo fmt and
source/doc diff checks passed, locked/offline throughout. The raw GREEN logs
retain their captured trailing blank line and published hashes unchanged.
The 10 new extension tests,
51 authority tests and 6 matrix tests ran against the combined main changes.
The frozen source oracle file still hashes to
`948778eb0b27dfe203a19a9ec4e6b56ccac5eaa7a6ed52bfe353856f9812ae3c`.
Root reviewed known-key filtering, nested serialization, handle identity,
transition cloning and the actual two-test known-key assertion RED log.
This advances record fidelity only; durable authority and the other explicit
out-of-scope requirements below remain open. Independent PR review and CI
are still required before merge.

Date: 2026-09-06
Status: **slice complete, locally validated; awaiting root review/integration**
Task/Dispatch: `task_55886766bbb5` / `ctx_04f4f7e6d228` (direct depth-1 GLM leaf, no descendants)
Worktree: `codex/provider-extension-roundtrip` (base `b63719b`, branch `codex/provider-extension-roundtrip`)
Source pin: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`

## The assigned gap

`admit_persisted_record` admitted persisted records carrying unknown JSON
members (the source validators only inspect known fields), but the typed
`from_json`/`to_json` pair dropped every one of them, at every nesting level.
`record_agent_session_provider_handle` then propagated the lossy typed record.
In the pinned source, unknown members are load-bearing persisted state, so a
mixed-version peer's extra fields vanished on the first Rust read/write cycle.

## Verified source semantics (bounded `git show` from this worktree)

- Transition spreads — `src/main/runtime/agent-session-provider-handle-transition.ts:32-40`:
  the result is `{...record, providerHandleChain,
  lease: {...record.lease, ...(live ? {provenHandleLinkId: head.linkId} : {}),
  lastRenewedAt: args.now}, updatedAt: args.now}`. Known keys written after
  the spread win; during `new-owner-proving` `provenHandleLinkId` is not
  rewritten.
- Verbatim persistence — `src/main/runtime/agent-session-record-store-file.ts:147`
  stores the value that passed `isAgentSessionRecord` unchanged, and
  `src/main/runtime/agent-session-store-serialization.ts:6` writes it back
  verbatim. Every nested object (location, accountHome, ownerProcess,
  journalCheckpoint, deathEvidence, link, handle) is carried by reference and
  never rebuilt, so unknown members persist at all of those levels too.
- Chain append never rebuilds stored links —
  `src/shared/agent-session-provider-handle.ts:204,215` returns
  `[...chain]` (retry elision) or `[...chain, link]`.
- Handle equality ignores unknown members — `agentSessionProviderHandleKey`
  uses only the known identity fields, so an extension never changes retry
  dedupe or root comparison.
- Null is a written lease state —
  `src/main/runtime/agent-session-lease-transitions.ts:86,122,228,241`
  write `processlessAt: null` explicitly, so a persisted null must
  re-serialize as null, not collapse to absent (the pre-change port dropped
  it; fixed here with an optional-nullable `processless_at`).

## Fields the source intentionally drops (documented, none in this slice)

- `settlementRetryRequired`/`settlementRetryId`: the reservation transition
  writes them as `undefined`
  (`agent-session-lease-transitions.ts:92-93`), which `JSON.stringify` drops —
  a later-slice behavior, not part of the assigned transition.
- Options are replaced wholesale by `replaceAgentSessionRecordOptions`
  (`{...replacement.options}`), which by design discards previous members —
  again a later-slice transition; in this slice every options member is
  ordinary data and roundtrips.
- `launchEnv` is not dropped but refused outright on a schema-v2 record
  (`!Object.hasOwn`); admission quarantines such records as invalid, so it
  can never reach the typed model.
- Inside the assigned transition, nothing is dropped: extensions survive and
  known updates win.

## Implementation (one ownership representation, no competing stores)

Each object level carries `extensions: serde_json::Map<String, Value>`
(`session_authority::Extensions`) holding exactly the members beyond that
level's known keys, collected verbatim at `from_json`/admission and merged
back after the known fields at `to_json`. Levels: record, lease, location,
account home, owner process, journal checkpoint, death evidence, link, and
both handle shapes.

Root review found the initial merge-after-known ordering unsafe for a public
typed API: a caller could insert `updatedAt`/`runtimeFence`/`provider`-class
keys into an extensions map and override authority, and a shadow entry could
resurrect a known-optional key that is legitimately absent. The fix is a
single serialization rule (`session_authority::serialized_extensions`):
every `to_json` merge filters known keys out of the level's extensions map,
so known fields always serialize from typed state regardless of map contents
or merge order. Intake filtering (`split_extensions`) is unchanged. There is
no raw shadow of known fields, so updates cannot resurrect stale values.
Validators, guards, quarantine policy, supported schema version, and the
frozen 266-case oracle are untouched. `processless_at` is
`Option<Option<i64>>` (outer = present, inner = null) to keep the source's
three states distinct; `minimumNextFence` keeps its existing raw
`Option<Value>` preservation.

## Verification (actual commands, from this worktree)

```text
cargo test -p drogon-core --test provider_extension_roundtrip --locked --offline
  round 1 (extension preservation RED):  2 passed; 5 failed (exit 101)
  round 1 post-fix:                      7 passed; 0 failed
  round 2 (known-key smuggling RED):     8 passed; 2 failed (exit 101) —
        typed_known_keys_in_extensions_never_override_serialization and
        codex_handle_and_link_extensions_reject_known_smuggling_and_roundtrip
        fail pre-fix because merge-after-known let shadow entries win
  round 2 post-fix:                     10 passed; 0 failed

cargo test -p drogon-core --locked --offline
  PASS (exit 0): 147 passed; 0 failed (session_authority 51,
        provider_extension_roundtrip 10, provider_record_boundary_matrix 6,
        plus all pre-existing suites)

cargo test --workspace --locked --offline
  PASS (exit 0): 299 passed; 0 failed

cargo clippy --workspace --all-targets --locked --offline -- -D warnings
  PASS (exit 0): zero warnings

rustfmt --edition 2024 --check (all changed .rs files)
  PASS (exit 0)
```

Environment: `CARGO_BUILD_JOBS=2`, worktree-local `target/`, `--locked
--offline` throughout. The matrix suite re-asserted 266/266 validator and
198/198 admission agreement against the frozen oracle bytes
(`948778eb0b27dfe203a19a9ec4e6b56ccac5eaa7a6ed52bfe353856f9812ae3c`) and the
existing `minimumNextFence` raw-preservation cases stayed green.

## Evidence files (repeatable)

- `tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/red-round-extensions.txt`
  — round-1 pre-fix RED, sha256
  `72eb887beed82a1dd5a18fdd24e3f740c39ac5dfd0274b0cc8bc72a37cc319e0`.
- `tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/green-round-extensions.txt`
  — round-1 post-fix run of the three suites, sha256
  `74171251e58361f0201f6411047526c827074bb13083f67f86b9314954773dc3`.
- `tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/red-round-extensions-knownkeys.txt`
  — round-2 pre-fix RED for known-key smuggling (8 passed / 2 failed), sha256
  `9955c6578532dbfda19e4c4ced34af200d5144611f573f376bea767033e66729`.
- `tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/green-round-extensions-knownkeys.txt`
  — round-2 post-fix run (10 + 6 + 51 passed), sha256
  `c80a68e8e03db088fac5346b4e60413b913bdce7afc9458544b9f4aa3b6f2fb9`.

## Files changed (worker hashes before root review)

```text
4a676af56d3c1e9df30064098a3d09c52df4b9b145d30293734b34257886394d  crates/drogon-core/src/session_authority/record.rs
c8f947001e3258651b4d38dd6a055e6c06277467aba68f0f2041b3db6269eb01  crates/drogon-core/src/session_authority/provider_handle.rs
1a93926722c69595acc5292874061a7dc565a4c404f8d6111f5408f41172f24c  crates/drogon-core/src/session_authority/transition.rs
75fb349f04b99dc1bed9225b2809d5a0c0ce4e11aaeb4bfb80630a32f2381966  crates/drogon-core/src/session_authority/mod.rs
cdb5a0cd85abc1c555129f798bf82e8e1db299825c68f34dc01ab38a93b71882  crates/drogon-core/tests/provider_extension_roundtrip.rs (new)
6430a961a273ee5df478cc7094ce99f79ba25c5661ee0db15f434e68b2471615  crates/drogon-core/tests/session_authority.rs
15b2d63cba13592b7d8c0e1bb4f80c173afe9df5837624b6671fa52c24c00e90  crates/drogon-core/tests/provider_record_boundary_matrix.rs (unchanged; listed for completeness)
```

Test adaptations in `session_authority.rs` are API-shape only: struct
literals gained `extensions: serde_json::Map::new()` and the processlessAt
assertion became `Some(Some(12))`. No assertion was weakened; the pre-existing
51 tests pass unchanged in behavior.

## Out of scope / remaining (root-owned)

No durable DB, CAS, RPC, or frontend work; NUL scope-key format/equality and
Unicode transport handling untouched; this is mixed-version record fidelity
for the record slice, not a claim of complete durable authority. Lease
transitions that intentionally clear fields (reservation writing
`settlementRetryRequired: undefined`, wholesale options replacement) belong to
later root-owned slices and must preserve this extension contract when ported.

Extension allocation cost: the source sets no per-extension size or entry
bound (only the known fields are bounded), so this slice introduces none —
preserving verbatim values is parity, and any aggregate byte/entry budget for
persisted extensions belongs to the future root-owned durable-store policy,
not to an arbitrary parity reduction here.

## Round-3 correction — source-refused `launchEnv` reserved key (2026-09-06)

Root review found the one reserved key missing from the serialization filter:
`RECORD_KNOWN_KEYS` lacked `launchEnv`, which the source refuses outright on a
schema-v2 record (`!Object.hasOwn`, `agent-session-record.ts`), so a typed
caller could insert it into the public record extensions map and `to_json`
would persist it — producing output that no longer validates or re-admits.
Fix: `launchEnv` added to `RECORD_KNOWN_KEYS`; validation, guards, and the
frozen oracle are untouched. Round-3 checks (same owned files only): the new
`source_refused_launch_env_never_persists_through_extensions_smuggling` test,
extended link (`forkedFromKey`, `mintedAtFence`) and Claude-handle
(`leafUuid`, `provider`) reserved-key smuggling assertions, and
`processlessAt: null` admit-serialize-admit stability.

Actual evidence (all `CARGO_BUILD_JOBS=2 --locked --offline`, base
`3c91fff`, no Git actions):

```text
cargo test -p drogon-core --test provider_extension_roundtrip --locked --offline
  pre-fix RED:  10 passed; 1 failed (exit 101; sha256 of log
                102850a402873e29f449779788d323dd46a7915a830d80ff676c51b8957a056f,
                tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/red-round-launchenv.txt)
  post-fix:     11 passed; 0 failed
cargo test -p drogon-core --locked --offline      PASS (exit 0): 227 passed; 0 failed
cargo test --workspace --locked --offline         PASS (exit 0): 379 passed; 0 failed
cargo clippy --workspace --all-targets --locked --offline -- -D warnings
                                                  PASS (exit 0)
rustfmt --edition 2024 --check (changed .rs)      PASS (exit 0, after formatting)
```

Round-3 file hashes (historical sections above keep their published hashes):

```text
1dd021e9ef06f7cb88fa5c6e59f4f5da7f99a8a5047678c24ae70956e038af11  crates/drogon-core/src/session_authority/record.rs
f63ecbebd565c156b235f8c57fb6672d323269b0a9fe96805b2c32a4039bb594  crates/drogon-core/tests/provider_extension_roundtrip.rs
```
