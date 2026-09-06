# Mobile request ownership: bounded coordinator review

Source `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, read-only. Reviewed
2026-09-06 after `63c494f`. This accepts the contracts below, not the entire
31-site mobile leaf report, a mobile runtime, or candidate parity.

## Original baseline execution

Two independently reviewed runtime closures ran with unchanged original
assertions and imports. Both passed 5/5, zero failures/skips/todos, using
Node24.19.0 and original-root installed Vitest4.1.11 on macOS arm64.
The mobile-specific dependency installation is absent; no install was run.

- [Request coalescing evidence](reference-captures/c9790628-mobile-request-single-flight/README.md)
- [Capability advisory evidence](reference-captures/c9790628-mobile-runtime-capability-negotiation/README.md)

Each evidence directory includes the exact execution report, stage receipt and
results. The two manifests under `tests/parity/baseline-capsules/` pin all ten
runtime/test files and MIT LICENSE against both checkout and Git. Types-only
imports are erased, not evaluated. Original mobile setup only sets the React
act flag; that flag, React warning filtering, TSX discovery and OXC app-tsconfig
override are omitted by the capsule. No full configuration equivalence claimed.

## Preserved contracts and actual assertion boundaries

### MREQ-1: requests are scoped by client identity, host and kind

`mobile/src/transport/request-single-flight.ts` maintains a WeakMap keyed by
client, then maps keyed by host and request kind. A trigger arriving during an
in-flight read shares one *trailing* promise, not the old read's promise. The
trailing request runs after either success or failure of the leading request.
Cleanup only removes the entry it owns and prunes empty maps. Different client,
host or method cannot share a request.

All five original cases cover coalescing, fresh request after settlement,
queued recovery after failure, fresh retry after failure and key isolation.
Source additionally specifies latest trailing parameters win, synchronous send
throws become promise rejections and triggers during a trailing request queue
another follow-up. Those three behaviors are not separately asserted by this
five-case baseline; preserve and test them during the port. This mechanism is
not an exactly-once mutation protocol and must not be generalized to writes.

### MREQ-2: real home callers retain stale data on failed refresh

Full bodies independently read:

- `mobile/src/home/mobile-home-host-requests.ts:41,59,76-78` calls
  `stats.summary`, `accounts.list`, `settings.get`, `preflight.check`,
  `linear.status`. Statistics/accounts update only on `ok` and not disposed;
  failures are swallowed. Task-provider fallback preserves an existing host
  entry and otherwise starts with GitHub. Decoder/provider dependencies were
  not executed in this capsule.
- `mobile/src/worktree/home-host-worktree-fetch.ts:39` calls `worktree.ps` with
  the full-catalog limit constant. Success updates proven cache/counts; failure
  marks catalog unavailable through the domain helper, not an empty host.
  Only a logical cutover error receives up to two additional attempts. This
  caller body and `home-worktree-info.ts` were read, not the full cache/helper
  closure or their tests. The latter preserves existing counts and sets
  `catalogUnavailable`/`staleCounts`; without previous counts it returns a
  placeholder whose summary is 'Worktree list unavailable', not a proven zero.
  Its summary labels stale or unstamped/older-than-ten-minute counts 'Last known'.

This independently establishes `stats.summary` and `accounts.list` at the
two single-flight wrapper sites. The other 23 newly reported leaf names still
require their remaining caller review; do not promote the 188-name leaf total
to coordinator semantic acceptance from this slice alone.

### MREQ-3: request projection is narrow and changes parameters

Full `mobile/src/transport/mobile-rpc-request-projection.ts` body read:
only `worktree.ps` gains `supportsWorktreeVisibilitySourceDefaults: true`,
overriding a prior value. Other methods preserve the original parameter value.
For that method, null, arrays and non-objects become an empty object before the
flag is added; object own properties are spread into the new object.
`stable-logical-rpc-client.ts:75-110` confirms projection occurs before the
active physical session receives the request. This does not add a new method
name or prove all logical-session/cutover behavior. No projection test ran.

### MREQ-4: capability advisory failure is not automatically link failure

Full runtime closure was read and executed in the original five-case baseline:
`mobile-runtime-capability-negotiation.ts`, `mobile-runtime-client-capabilities.ts`,
`rpc-delivery-ambiguity.ts`, plus shared `protocol-version.ts`,
`remote-runtime-client-capabilities.ts`, `skill-install-capability.ts` and
`remote-server-update.ts`. The latter provides constants/types, not a live updater.

The bare-function request uses `runtime.clientCapabilities.update` with a fresh
capability-array copy: shared remote capabilities plus structured-session and
structured-hold capabilities. This request remains outside the member-call
syntax census; do not silently fold it into that census count.

An explicitly refused advisory or an error tagged by the module's WeakSet
settles permissively. An untagged error rejects, regardless of its wording.
The wrapper checks `current()` at settlement before delivering ready/failure.
The first three tests positively await callback delivery for tagged timeout,
tagged mid-flight interruption and an untagged interruption respectively.

**Coverage gap:** the final two tests use `vi.waitFor` on negative callback
assertions. They can pass before the relevant async chain settles, so passing
does not establish a robust stale-session fence. Keep the originals and add
deferred, explicitly settled cases for both success and rejection during the
port. Payload contents, explicit refusal and current-session success also need
direct assertions; these five cases are not comprehensive negotiation coverage.

### MREQ-5: ambiguity markers originate in transport state, not error text

`rpc-client-request-tracker.ts` and `relay-pending-requests.ts` were fully read,
but not executed here. Direct requests tag timeout errors and optionally tag
`rejectAll` errors; false `sendEncrypted` clears pending state/timer and rejects
untagged. Relay pending rejection tags only when there are pending entries.
In `mobile-relay-rpc-session.ts:170-245`, timeout is tagged while false
`sendFrame` removes the pending entry/timer and rejects untagged. Resume
confirmation awaits the advisory before publishing connected.

This bounded producer review is not proof of the complete transport ordering.
In particular, direct/relay send callbacks are assumed to honor their boolean
contract; synchronous throw cleanup is not established by the reviewed tests.
The direct request budget dependency and actual rejectAll callers still need
review, as do relay close races and stale confirmation. No network was opened.

## Additional source fingerprints

All eight below matched the pinned Git blobs and checkout. Full-body reads are
the first six; relay and logical client are partial at the intervals above.

| Source relative path | SHA256 |
| --- | --- |
| `mobile/src/home/mobile-home-host-requests.ts` | `0758445ede58d1a7746d43c7ac94129a7e30211b29937d7d35a4c6ce3f90e63b` |
| `mobile/src/worktree/home-host-worktree-fetch.ts` | `ca9b4aa84e0a47a469ebacee61251c3c2d29150988a7ef0a651160e7abad5988` |
| `mobile/src/transport/mobile-rpc-request-projection.ts` | `2e269f57d09703709e36c70c9a4462918652e83b3a9cafc7f3e1cfd0ed26f7cf` |
| `mobile/src/transport/rpc-client-request-tracker.ts` | `3dfb2ab034c36da4df5553879affdd5fe1ca8f19f6583ca2130a2a55f9d54421` |
| `mobile/src/transport/relay-pending-requests.ts` | `893cb713f769f8cc658c8d954769d286f8c6df3032df83cc2e55e417996df0d5` |
| `mobile/src/worktree/home-worktree-info.ts` | `586cf0bb6a0504c8aed087599bea747576db1481c526585dfd88f7351cc0acc5` |
| `mobile/src/transport/mobile-relay-rpc-session.ts` | `e5078b295f5a41647f892dcfd24c50233fc8e11773a46417c2c9fcab13c55885` |
| `mobile/src/transport/stable-logical-rpc-client.ts` | `e993541c1df724a5f185cbeff622d035f286f515d412752851d5879a944d3f48` |

The logical-client read interval does not claim its complete body.

## Remaining ownership

WP-CAP-MOBILE owns original test ports plus supplemental cases above, remaining
caller semantics, actual mobile session/UI behavior and request projection.
WP-ENG-REMOTE owns pairing/reconnect, actual ambiguity production and negotiated
mixed-version behavior. Coordinator must still review the remaining 31-site
report before accepting its full semantic map. All9037 original test-path
obligations and audit gates remain open; no product, preview or Mentu upstream
change was made by this review. A reproducible Mentu integration gap discovered
later still follows the justified English PR and pinned-local-test policy.
