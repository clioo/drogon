# Native claim identity — root boundary decision

The next finite implementation is the complete source claim-identity capability,
not the entire session store. Source pin is
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`. Root read the full
`agent-session-claim-identity.ts`, `agent-session-resume.ts` and host-authority
claim contract. Root also verified all three ENG baseline receipts/results and
their manifest hashes; the existing verifier independently matched staged bytes
and four lease dependency trees. The original claim suite's 3 cases / 7 assertions
are admitted; leases/handle transitions remain separately baselined, not implemented.

## Direction and ownership

Sol-ENG directs one Kimi For Coding leaf through Orca depth 2 from the outset.
The leaf owns `crates/drogon-core/src/claim_identity/**`,
`crates/drogon-core/tests/claim_identity.rs` and
`tests/parity/ports/WP-ENG-RUNTIME/native-claim-identity/**`.
Sol owns only focused `docs/migration/sol-wave/eng-identity/native-claim.md/json`
review. Root owns library exports, manifests, lockfile, protocol, integration and
installation. No existing dirty Rust files may be edited by the leaf. Its Rust
test target may include the actual production module with `#[path]` until root
registers the public library export; this is not a second implementation.

## Required behavior

- Translate all canonicalization/signing/key-loading exports of the source module,
  not just the happy paths in the three tests. Preserve supported resumable agents,
  provider-key rules, metadata normalization, control-character rejection and JS
  UTF-16 length/trim semantics where they affect acceptance.
- Pi/Prime identity requires an absolute bounded transcript path and a canonical
  regular file on the execution host. Preserve platform canonicalization; report
  untested Windows/Linux behavior and genuine differences instead of silently
  equating it with Darwin evidence. No client-side remote filesystem access.
- Preserve digest version 1, the exact two domain-separation labels, field order,
  UTF-8 length-prefix encoding, HMAC-SHA256, base64url-without-padding and key-id
  derivation. Internal `orca-...` digest labels are compatibility bytes, not UI
  branding. Do not mint a new signing format while translating languages.
- Persistent keys are 32 bytes, created exclusively with restrictive Unix mode;
  corrupt/replaced keys fail closed without rotation. Concurrent first creators
  must not silently replace a winner. Ephemeral keys use system entropy. Never
  log, serialize or derive an exposing Debug representation of secret key bytes.
- Preserve relevant typed error codes (`agent_session_identity_required`,
  `agent_session_ownership_unknown`), and explicitly document native filesystem
  errors. A signing claim does not grant lease ownership or prove process liveness.

## Tests and acceptance

Map every original case/assertion to real Rust results. Record stub-stage
behavioral RED separately from compilation/import failures, then remove all
stubs and run GREEN against the production Rust module. Add deterministic Node
crypto/reference vectors, all supported-agent key rules, Unicode/control/length
boundaries, domain/namespace separation, corrupt/retained keys, concurrency and
test-owned transcript/path cases. Do not change frozen source tests or fabricate
equivalence through expected-value adapters. Translate additional relevant source
tests where available and identify what remains outside this finite capability.

Root prepared `hmac = 0.12.1` and existing `getrandom = 0.4.3` with current
sha2/base64 dependencies; `cargo check -p drogon-core` passes after the lock update.
Use these libraries rather than hand-written crypto. Reference APIs:
[RustCrypto HMAC](https://docs.rs/hmac/0.12.1/hmac/) and
[getrandom](https://docs.rs/getrandom/0.4.3/getrandom/).
Workers use `cargo ... --locked`; no dependency changes or global settings.

No session-store/lease/RPC implementation is implied by this decision. Public
library registration, caller wiring, protocol negotiation and packaged execution
are separate required integration steps. No new app installation or full-parity
claim follows from this module's tests alone. Source license attribution is required.
