# Native mail group fanout (`SendTarget::Group`)

## Scope and ownership

This task owned exactly three files: `crates/drogon-core/src/coordination_mail_groups.rs`,
`crates/drogon-core/tests/native_mail_groups.rs`, and this document. Root owns
`crates/drogon-core/src/lib.rs` (the `mod coordination_mail_groups;`
declaration) and `crates/drogon-core/src/coordination_mail_rpc.rs` (the
`SendTarget::Group` arm of `commit_send`), and wired both during this task
after the signature below was agreed live. Neither file is edited here.

Correction: the worker temporarily edited `lib.rs` for a compile check,
causing a duplicate module declaration alongside root wiring. Root removed
the duplicate; this was an ownership violation, not a product regression.
After stable handoff root reproduced and fixed inclusion of already-reported
recipients, added task identity validation and bounded SQL projection before
allocating stored state. Root added a real Engine regression covering these
cases and rollback when the second recipient insert fails. Historical worker
test claims below precede those acceptance corrections.

Wiring, confirmed present at handoff:

```rust
// lib.rs
mod coordination_mail_groups;

// coordination_mail_rpc.rs, commit_send's recipient match:
Some(SendTarget::Group { .. }) => {
    return crate::coordination_mail_groups::send_group_in_tx(tx, scope, sender, params, origin_request_id);
}
```

## Signature and contract

```rust
pub(crate) fn send_group_in_tx(
    tx: &Transaction<'_>,
    scope: &CoordinatorScope,
    sender: &MailActor,
    params: &SendParams,        // params.to must be Some(SendTarget::Group { name })
    origin_request_id: &str,
) -> Result<Value, RpcError>    // an already-encoded SendResult{ batch: Some(...) }
```

Called from inside the caller's single `coordination_mutation` transaction
(the same one that also produces the send's own ledger receipt). Internally:
one `coordination_mail::append_message_in_tx` call per matched member, all in
that one transaction — never one transaction per member, so a partial fanout
can never commit (this is `coordination_mail_domain`'s "group addressing is
root's fanout responsibility" note, now discharged). A `question`-kind group
send correlates each appended message via
`coordination_mail_questions::correlate_question_in_tx`, exactly like the
existing single-recipient `send`/`ask` paths, so each recipient's question is
independently repliable.

Lifecycle kinds (`heartbeat`, `finalReport`) can never reach this function in
practice: `SendParams::validate_shape` already refuses them for any non-run-home
target before `commit_send` runs. A matching check here is a defensive
invariant only, not business logic of its own.

## Group name grammar and semantics

Pinned to the read-only migration reference at revision
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`
(`src/main/runtime/orchestration/groups.ts`,
`src/main/runtime/rpc/methods/orchestration-send-group.ts`). A `name` arrives
either with or without its leading `@` (the CLI's `group:` prefix already
strips one layer; the source wire always carried the `@`), and keyword
matching (`all` / `idle` / `worktree:` / the nine agent-name groups)
case-folds exactly like the source's `to.toLowerCase()`. A `worktree:<id>` id
is sliced from the *original*-case string, matching the source's
`to.slice(...)` (not the lowercased copy), so the id itself is never
case-mangled.

| Selector | Native membership | Source parity |
|---|---|---|
| `all` | Every current, unfenced attempt in the sender's own host/run, excluding the sender's own dispatch (if the sender is a dispatch) | `@all`: every terminal except the sender |
| `worktree:<id>` | Attempts whose `WorkerStartResult.workspace_id == id`, sender excluded | `@worktree:<id>`: terminals in that worktree, sender excluded |
| `claude`, `openclaude`, `codex`, `opencode`, `gemini`, `droid`, `grok`, `cursor` | Attempts whose `LaunchPreferences.harness_id` equals the selector name | `AGENT_NAME_GROUPS`, matched against the host-published `agentIdentity` |
| `mimo` | Attempts whose `harness_id == "mimo-code"` | Source's `GROUP_AGENT_IDS.mimo === 'mimo-code'` |
| `idle` | **Refused, `unsupported_feature`** | `@idle`: terminals whose TUI reports idle status |
| Anything else | **Refused, `unsupported_feature`** | Source resolves to an empty member list |

### Deliberate departures from source, and why

- **Membership source.** The source resolves against a live terminal
  registry (`RuntimeTerminalSummary[]`); this domain has no terminal
  registry, so membership is drawn from `orchestration_attempts` rows that
  are `is_current = 1 AND fenced = 0` for the sender's exact `(host_id,
  run_id)` — i.e., attempts a coordinator could otherwise message
  individually right now. A fenced (stopped/abandoned) or historical
  (superseded) attempt is never a member, matching the run/host isolation
  and no-stale-authority guarantees the rest of the mail domain already
  holds.
- **`@idle` has no native signal.** The source's idle status comes from a
  live TUI process observation this layer never sees. Rather than infer
  "idle" from `AssignmentState::Ready` or the absence of a pending
  question — either of which would silently misroute a message under a
  claim this domain cannot actually verify — `idle` is refused outright
  with `unsupported_feature`. This is the one explicitly acknowledged gap
  against source parity.
- **Empty-but-valid vs. no-such-group.** The source resolves an unknown
  group name to an empty member array, which its RPC caller then turns into
  a generic "no recipients resolved" error — indistinguishable, at that
  point, from a *recognized* selector that currently has zero members. This
  implementation keeps the two apart on purpose: a recognized selector
  (`all`, `worktree:<id>`, or one of the nine agent names) with zero current
  matches is `not_found`; a name that matches none of those is
  `unsupported_feature`. A caller can tell "valid group, nobody home right
  now" from "no such group exists" without parsing message text.

## Bounds

- **Recipient cap: 50**, the same order of magnitude as the mail domain's
  own `MAX_MAIL_BATCH`. The scan of current unfenced attempts is itself
  capped (`LIMIT 51`) and fails closed with `result_too_large` the moment a
  51st row would be read — before any decoding, filtering, or append —
  mirroring `coordination_attempts::history`'s existing 500-row bound
  pattern exactly. A run with more than 50 simultaneously current unfenced
  attempts cannot safely expand a group address at all today; this is a
  named limitation, not a silent truncation.
- **Per-attempt read bound.** Each attempt's `state_json` is length-checked
  (64 KiB) before JSON decoding, and its decoded `dispatch_id`/`run_id` are
  cross-checked against the row's own columns before it is trusted as a
  candidate — the same identity-crosscheck discipline
  `coordination_attempts::show` already applies.
- **Result bound.** The final encoded `SendResult` is checked against the
  mail domain's own `RESPONSE_BUDGET_BYTES` (512 KiB) before it is returned.
  With at most 50 small receipts this can never realistically trip, but it
  is checked rather than assumed safe by construction — the same posture
  every other mail response in this domain takes.

## Test evidence

- Domain-level unit tests (inline `#[cfg(test)] mod tests` in
  `coordination_mail_groups.rs`, no Engine, an in-memory `rusqlite`
  connection with both the mail and attempts schemas migrated directly):
  selector parsing (`@`-optional, case-folding, `worktree:` id-case
  preservation, `idle` always refused, unknown names refused), fanout
  correctness (all/harness/worktree matching, sender exclusion, fenced
  attempts excluded, host/run isolation), the 50-recipient cap tripping
  `result_too_large` before any append, and question correlation rows
  created per recipient. `cargo test --offline -p drogon-core --lib
  coordination_mail_groups`: 9/9 passed.
- Real-`Engine` regressions (`tests/native_mail_groups.rs`, real
  `Engine::open`/`dispatch`/`dispatch_authenticated`, no mock domain):
  `@all` fanout with real per-recipient delivery via `orchestration.check`;
  harness-name and `worktree:<id>` selection; `@idle` refused as
  `unsupported_feature` with no delivery to anyone; a dispatch-originated
  group send excluding only itself; **host/run isolation** (a second run on
  the same host never receives another run's group broadcast); **same
  -request-id replay** returning an identical result with no second
  message appended (idempotent through the existing ledger, not a new
  mechanism); an unmatched-but-recognized selector as `not_found`; an
  unrecognized selector as `unsupported_feature`. This exercises the real
  wiring end to end, not a stub. `cargo test --offline -p drogon-core --test
  native_mail_groups`: 9/9 passed.
- Full crate regression after wiring: `cargo test --offline -p drogon-core`:
  all suites green (0 failed), including the pre-existing `native_mail_rpc`
  (24/24) and `native_question_rpc` suites, unaffected by this change.
- `cargo clippy --offline -p drogon-core --lib --tests -- -D warnings`:
  clean. `rustfmt` applied to both owned Rust files.

## Explicit non-claims

- This is not full source parity: `@idle` remains a parity obligation pending
  a native idle-status signal. This change does not waive that obligation.
- FIFO delivery ordering and ACK/replay semantics for the *delivered*
  messages are the pre-existing, already-accepted `coordination_mail`
  domain's job (`native-mail-domain-implementation.md`,
  `native-mail-rpc-implementation.md`); this task only proves group fanout
  composes correctly with that existing machinery, not that the machinery
  itself is new or re-verified end to end here.
- The 50-current-unfenced-attempt scan cap is a real, load-bearing
  limitation for very large runs, not a soft default; raising it needs a
  deliberate re-review of the per-row and response-budget math above, not a
  constant bump.
