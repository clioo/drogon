# Native session authority — integration boundary

This is the next dependency block after native claim identity, not a replacement
for the full session migration. A signed identity, a durable permission to write,
and a retained operating-system process handle are three different facts.
None may stand in for another. Source pin:
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`.

## Reuse decision

Root inspected the admitted source implementations of provider handle append and
record transitions, lease renewal/transitions, record types, and the transactional
store queue. Mentu Navigator located the existing source-to-test maps; their bodies
and the source modules, not search rankings, informed this boundary.

The rewrite already has one host-owned SQLite connection in `Engine`, guarded
by `db.rs`, plus retained PTY handles in `session.rs`. Extend this architecture.
Do not introduce a desktop TypeScript authority store, a second SQLite database,
or a second process supervisor. Existing PTY session rows and durable provider
conversation records have different lifetimes; explicitly associate them at root
integration rather than equating their IDs or deleting conversation history when
a terminal closes. The current restart-to-unverifiable PTY behavior remains the
safe fallback until positive identity reconciliation is implemented and tested.

## Required dependency sequence

1. **Provider handle chain and record model.** Preserve the complete source record
   schema and pure handle/record transition contracts, with runtime validation.
2. **Lease transitions and durable transactions.** Reserve, commit process
   identity, prove, renew and evict through one execution-host-owned store. Port
   the source batch atomicity behavior before connecting live callers.
3. **Runtime integration.** Bind the actual harness lifecycle, claim signer,
   retained process identity and durable writer admission. Add versioned RPC/CLI
   operations only after host isolation and mixed-version negotiation tests.

These are ordered implementation slices, not permission to omit remaining source
restart handoff, reconciliation, recovery fences, unreadable-record handling,
operation deduplication, options, journals or settlement retries. Each stays in
the source-to-candidate map until its real integration tests pass. A passing
two-case renewal suite is insufficient to declare the whole store migrated.

## Provider handles and record invariants

- Structured handle providers are exactly Claude and Codex at the pinned source
  boundary. The fourteen resumable TUI agents in claim identity do not imply
  fourteen structured handle formats. Reject unknown discriminants; never treat
  them as Codex.
- Claude session ID is the identity root; its leaf UUID is the cursor. Codex's
  thread ID is the root and target. Preserve exact JSON-based key/root encoding,
  including escaping, null values and JS UTF-16 limits.
- First link must be created/adopted. Later links preserve provider and monotonic
  fence; resumes preserve root, forks change it and name the exact previous key.
  Same-handle/same-fence resume retries do not append. Link IDs remain unique;
  the 256-link bound refuses growth rather than truncating provenance. Preserve
  source validation and error precedence, not merely the two recorded examples.
- Recording a new leaf on a live record updates the proven link. Recording during
  new-owner-proving preserves reserved status and does not grant ownership. Stale
  fence, provider mismatch and unknown ownership retain their distinct errors.
- Preserve source schema version 2 fields: execution location, pinned account
  home, provider options/launch args, full handle chain, lease, timestamps and
  optional recovery/settlement metadata. Before choosing serialization policy,
  inspect the source validators/serializer and wire-compatibility contract.
  Unsupported persisted versions must never be rewritten as empty records.

## Lease and persistence invariants

- Scope by execution host, WSL distro and workspace ID/kind, including folder
  workspaces. A remote client never probes local PIDs/files for a remote lease.
- Reserve durably by compare-and-swap before spawn; commit the observed process
  identity at the same fence and matching reserved spawn token; only a proved
  provider handle admits a writer. Lease expiry or loss of contact is not death.
- Renewal requires the correct fence, reconciled record, owner process and a
  nonempty identity-match proof. Missing records and unreadable records preserve
  the source's different rejection codes. Defaults and explicit TTLs preserve
  source semantics; reject unsafe integer conversions at the native boundary.
- A batch is atomic in memory and on disk. If a later renewal is stale, an earlier
  renewal must not remain visible, survive reopen or alter the stored record set.
  Use the existing SQLite connection with a transaction; avoid mutating an
  in-memory cache until commit, or restore it on every failure.
- Proven eviction and acquisition are the only permitted fence-advancing paths.
  Persist recovery fences and settlement requirements; never lower a fence after
  rollback/reopen. Retained process handles are not reconstructed from PID alone.
- Mutations must not reach a different host/distro scope; unknown ownership is
  refused. Public liveness remains `live` / `unverifiable` / `exited`; source
  internal claim states such as reserved/released are not liveness synonyms.

## Tests-first evidence and integration gates

Reuse the admitted isolated source baselines and frozen bodies in
`tests/parity/ports/WP-ENG-RUNTIME/identity-leases/`. Do not run a test with the
reference checkout as cwd. The two provider-transition cases assert four values:
new Claude leaf/proven link when live, and new leaf/still-reserved/unproven during
acquisition. Port all of them, then extend with the entire chain validation
boundary rather than weakening tests to match the candidate.

The two renewal cases require stale-fence rejection with unchanged renewal time,
and an all-or-nothing batch where the second owner was superseded: unchanged first
record, unchanged durable content, both records present after reopen and their
handle histories retained. SQLite physical bytes need not match the source JSON
file layout; prove logical row equality plus atomic reopen, not fabricated file
equivalence. Add two-connection CAS, commit-failure rollback, cross-host/distro,
folder, expiry-without-death and proof-order tests using owned temporary fixtures.

For each slice retain setup failures separately, genuine assertion RED, production
GREEN, exact source/test mappings and untested platform gaps. Source baselines
are not candidate evidence. A final live vertical test must exercise the native
store through actual Drogon callers, not a test-only expected-value adapter.

## Ownership for the next dispatch

Root owns shared manifests/dependencies, existing `lib.rs`, `db.rs`, `session.rs`,
RPC/CLI contracts and integration. A future Sol-ENG Task must delegate code and
tests to one approved non-OpenAI leaf in
`crates/drogon-core/src/session_authority/**`,
`crates/drogon-core/tests/session_authority.rs`, and
`tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/**`.
The module can accept the caller's SQLite connection; test path inclusion is
temporary until root registration, never a parallel production backend.
Sol owns its focused review report only. No worker edits the active claim module,
existing shared files, Git state or installed application under this contract.
This document does not launch a worker or authorize overlapping implementation.
