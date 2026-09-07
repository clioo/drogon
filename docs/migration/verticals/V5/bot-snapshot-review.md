# V5 review — bot.snapshot commit `76eb5ff1fd1ec2ceb4166a71f1b20d6997ca2939`

2026-09-07. REVIEW ONLY: no tests executed, no installs, no pull/checkout;
the commit was inspected read-only via `git show` against the fetched object.
Files reviewed exactly as assigned: `crates/drogon-core/src/bot_snapshot_rpc.rs`
(new, 68 lines), `crates/drogon-core/src/lib.rs` (2-line hunk),
`crates/drogon-core/src/workspace.rs` (30-line hunk),
`crates/drogon-core/tests/native_bot_snapshot.rs` (new, 145 lines). The
commit also touches `docs/migration/verticals/root-integration-2026-09-07.md`
(out of assigned scope, not reviewed). Line numbers below refer to the
committed blob contents. Dependency context was read read-only at the same
commit: `bots/storage.rs` (`list_bots`, `history_for_bot`, schema, `delete_bot`),
`lib.rs` (`dispatch`/`dispatch_authenticated`/`dispatch_worker`/`mutating`),
`drogond/src/server.rs` (`dispatch_request`), `drogon-protocol` (`Request::validate`),
`drogond/src/framing.rs`.

Verdict: no P1 found. The host-scoping and fail-closed posture are genuinely
fenced (double host check in `owned_path`, deny-unknown-fields scope parse,
worker dispatcher's fixed method arms, malformed-store fails closed with
evidence preserved — all regression-tested). Two P2s and several NITs below
are actionable; the commit is NOT an ancestor of this branch's HEAD
(verified via `git merge-base --is-ancestor`), so it is an unmerged
integration candidate.

## Findings

### P2-1 — History re-attachment across scopes via bot-id reuse after delete

`bot_snapshot_rpc.rs:26-31` enumerates history with
`storage::history_for_bot(&tx, &self.host_id, &folder, &bot.id)`, but
`history_for_bot` (storage.rs:807-813) queries
`SELECT payload_json FROM bot_responsibility_runs WHERE bot_id = ?1` —
keyed on bot_id only, with no host/folder fence. That is safe only because
`bots.id` is a **global PRIMARY KEY** (storage.rs:182-183, 222-223) — until
`delete_bot` frees it: delete_bot (storage.rs:612-634) deliberately preserves
runs as "orphaned evidence", and the snapshot's own comment
(bot_snapshot_rpc.rs:27-28) acknowledges retention. Failure shape: bot `x`
exists in folder A with runs → `delete_bot("x", host, A)` (runs retained) →
a new bot `x` is created in folder B → `bot.snapshot` for workspace B calls
`history_for_bot(..., "x")`, `get_bot(host, B, "x")` succeeds (the new row),
and the returned history contains folder-A-era runs — stale evidence
attributed to a different workspace's bot in the same response the renderer
presents as this workspace's history. Minimal fix direction: fence the run
lookup to the resolved scope (carry host/folder on `bot_responsibility_runs`,
or join runs through the scoped bot row identity rather than the bare id, or
namespace/clear runs at delete instead of bare retention). Not a P1 because
it requires deliberate id reuse across folders and leaks only historical run
metadata within the same host.

### P2-2 — Snapshot materializes unbounded work before the size cap

`bot_snapshot_rpc.rs:26-45` builds the full history Vec (a query pair per
bot — `history_for_bot` re-reads the bot and deserializes every run, an N+1
pattern), sorts it, serializes the whole result with `serde_json::to_vec`,
and only then refuses with `snapshot_too_large` if it exceeds
`MAX_FRAME_BYTES / 2`. Failure shape: one workspace with many bots/runs pays
full O(bots × runs) allocation + deserialization + a full JSON serialization
on every call, then fails — repeatable with no pagination, no per-bot LIMIT,
and no early COUNT-based estimate. The cap does bound the response bytes
(consistent with `framing.rs:39-42`'s refusal to write frames over
MAX_FRAME_BYTES), but it bounds nothing about per-call work. Minimal fix
direction: cheap COUNT probe (or LIMIT'd queries with an explicit
`truncated`/refusal contract) before materializing; the N+1 can collapse
into one joined query.

### NIT-1 — Auth boundary untested for this method

`native_bot_snapshot.rs:13` drives every case through
`Engine::dispatch(...)` with `auth: None` — the crate's unauthenticated
entry (lib.rs:208-215, no auth check). The real socket path is
`dispatch_authenticated(request, token)` (server.rs:434-435), where a
worker credential would be routed to `dispatch_worker`'s fixed method arms
(lib.rs:~248-313) which end in `method_not_found` for `bot.snapshot`. The
fail-closed property is real but rests on code outside this commit's tests.
Minimal fix direction: add one `dispatch_authenticated` case asserting a
worker token gets a denial (not data) for `bot.snapshot`.

### NIT-2 — Two new failure paths untested in this commit

The `snapshot_too_large` cap (bot_snapshot_rpc.rs:45-52) and the
`LocaleOrdering → invalid_argument("Unsupported locale")` mapping
(bot_snapshot_rpc.rs:63-67, storage.rs:486-489) have no regression case in
`native_bot_snapshot.rs`.

### NIT-3 — Inconsistent scope validation

bot_snapshot_rpc.rs:17-19 validates `workspace_id` non-empty and
`locale` non-empty/≤128 bytes but not `host_id`; an empty `host_id` still
fails closed as `unsupported_host` in `owned_path` (workspace.rs:147-153),
so this is cosmetic asymmetry, not a hole.

### NIT-4 — Measurement-only full serialization

bot_snapshot_rpc.rs:45-46 serializes the entire result purely to measure
its length, then the framework serializes again at response write —
doubling serialization cost exactly on the largest responses. A size
estimate (or the P2-2 COUNT probe) avoids it.

### NIT-5 — Silent `startedAt` coercion in sort

bot_snapshot_rpc.rs:37-43 sorts with `as_f64().unwrap_or(0.0)`; a stored
run with a malformed `startedAt` silently sorts as oldest instead of
surfacing the malformed-store error that other payload corruption triggers.
Acceptable, but it is an inconsistency with the fail-closed stance tested in
`malformed_bot_remains_on_disk_and_is_not_hidden_as_empty`.

## Focus-area conclusions

**(a) Scope leaks — none beyond design-intent globals.** Bots are read via
`list_bots` fenced on (current host, `owned_path`-returned folder, locale);
`owned_path` (workspace.rs:146-175) double-fences — the caller's asserted
`hostId` must equal the engine host AND the workspace row's stored
`host_id` must equal it (the latter is regression-tested by rewriting the
row's host directly, `foreign_workspace_row_is_rejected_even_with_local_host_parameter`).
History joins only scoped bots' ids (see P2-1 for the delete/reuse edge).
Automation/responsibility names resolved in history entries come from global
automation records — global by schema design (no host/folder columns;
documented in storage.rs:617+), not a leak introduced here. No folder
override is possible (`deny_unknown_fields`, tested via the `folder` probe).

**(b) Malformed-data handling — solid.** Input side: frames are capped at
MAX_FRAME_BYTES before allocation (framing.rs:1-26), `Request::validate`
requires protocol match, object params, ≤128-char control-char-free
request_id/method (protocol lib.rs:39-58); the scope parse is
`deny_unknown_fields` with typed strings, so missing/mistyped/extra fields
(including hostile control characters in ids — they are SQL-bound
parameters, never concatenated) fail as `invalid_argument`. Stored-data
side: a corrupted `payload_json` fails the whole snapshot as
`storage_error` with the row untouched on disk (tested) — deliberate
fail-closed over silent omission.

**(c) Resource bounds — see P2-2.** Inputs are frame-bounded; outputs are
byte-capped post-hoc; no pagination or query limits; per-call work is
unbounded in bots×runs. No allocation sized directly from untrusted
integers was found (all collection growth is data-driven row iteration).

**(d) Auth/worker denial — fail-closed.** The daemon never calls the
unauthenticated `dispatch`: `dispatch_request` →
`dispatch_authenticated` (server.rs:434-435). Admin service credential →
`bot.snapshot` (lib.rs:310 arm); worker credentials can only reach the
fixed `dispatch_worker` arms, which do not include `bot.snapshot` →
`method_not_found`; wrong/absent token → `authorize_worker` failure. The
snapshot is additionally read-only (no `mutating` wrapper, no ledger write,
`unchecked_transaction` read view). Denial can only fail toward
`unsupported_host` / `invalid_argument` / `method_not_found` / `not_found`
— never toward data.

## V5 packaging/acceptance surface notes

- The commit is an unmerged candidate on this branch's HEAD — integration
  order is a ROOT decision; the surface it adds is one RPC method
  (`bot.snapshot`), three error codes (`snapshot_too_large`,
  `unsupported_host`, `storage_error`) and the reusable
  `workspace::owned_path` host fence for future read-only RPCs.
- Acceptance coverage will need the new method in the CLI/core acceptance
  probes and protocol documentation when integrated; the renderer must
  handle `snapshot_too_large` (non-empty history workspaces) as a distinct
  state, not as a generic failure.
- Tests write raw SQL into the engine's live fixture database (acceptable
  test practice; no packaging impact).

## Limits

Static read-only review of the named commit and its in-repo dependencies;
no execution, no tests, no verification by build. Severity calls are the
reviewer's; P2-1's exploitability depends on runtime id-reuse behavior not
exercised here.
