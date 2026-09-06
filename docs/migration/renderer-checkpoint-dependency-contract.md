# Renderer checkpoint dependency boundary

2026-09-06. Root direction for Sol-UI Task `task_356786067bc3`, delivered as
`msg_49b2ca1ed928` with a terminal nudge. This is a dependency-injection decision,
not a persisted schema, durability implementation or reduced session model.

Root read the complete original checkpoint persist/guard/main-IPC modules and
breadcrumb recorder, plus the host-snapshot type and relevant persisted-UI fields.
Source pin: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. Source baselines still
require the original full tests and verified dependency closures in isolated
rewrite stages. Do not execute with the reference repository as cwd.

## Payloads remain intact

The renderer checkpoint policy never inspects snapshot or UI members: it captures
payloads and passes them unchanged to staging. Its TypeScript factory/dependency
types may therefore carry `TSnapshot` and `TUi extends object` type parameters.
No `any` coercion, fabricated generic domain record, field filtering or serialization
is permitted. These parameters do not replace the full source types. Root's future
caller must bind the complete host-qualified workspace snapshot and UI-state types,
including editor drafts, terminal state, layout and existing Drogon additions.

Tests must prove the same object contents and host provenance reach staging.
Dirty draft refusal, capture ordering, failed sleeping-agent capture, retry-before-
degradation, intentional-shutdown-only degradation and independent abort/reset
must retain the source behavior. An empty session list is allowed only where the
source's explicit degradation policy allows it; it is not a default shortcut.

## Diagnostics are explicit dependencies

The source leaf recorder sends best-effort breadcrumbs through its existing
renderer bridge. The rewrite does not yet have that bridge. Do not call a
nonexistent `window.api` or copy the entire crash-report backend to satisfy an
import. Inject a required breadcrumb sink into the persist dependency object and
guard factory; preserve exact source event names and data. Sink exceptions must
never replace or hide the original checkpoint verdict. Keep console and DOM
failure-reason/event behavior intact.

Root must provide a real recorder when wiring production callers; a no-op sink
is not accepted integration. Candidate test adapters may inject the existing
recording spy while preserving every original assertion. No test adapter may
implement the policy under test, silently change its behavior or replace actual
checkpoint modules with expected-value logic. Source baselines stay byte-exact;
signature-only candidate adaptation needs an explicit source-to-test mapping.

## Unchanged ownership and next gates

GLM owns only the two assigned renderer modules and their scoped test/evidence
directory; Sol directs and reviews. Shared events/preparation are already reusable.
Root owns full snapshot types, IPC admission, durable native staging/flush,
caller integration, real Electron acceptance and packaging. No new backend,
database, global setting, user-profile write, updater feed or service launch is
authorized by this dependency decision.

The main source handler distinguishes synchronous staging from asynchronous
durability, with a 20-second flush deadline. Future caller integration must join
real durability and refuse restart on failure; do not wire a resolved-promise
checkpoint merely to make the accepted preparation module callable. Preserve
mixed-host scope and prior durable state on restore/checkpoint failure. These
obligations remain open until actual integrated failure/restart/recovery tests pass.

## Review gate: test adapters are not product failures

At 16:58 UTC root observed the GLM worker labeling 6 failures / 23 passes from
unbound diagnostic sinks and a misbound abandon argument as genuine behavioral
RED. These are candidate-harness signature/admission errors caused by the approved
dependency change, not evidence of wrong checkpoint policy in a correctly bound
production module. Retain them as adapter failures. Signature-only test adaptation
is permitted with all original assertions intact, but changing the adapter to make
those failures disappear does not prove a production behavioral correction.

The unchanged correctly bound regression suite must demonstrate a real policy
failure before its production fix to claim RED/GREEN; otherwise report the missing
historical behavioral RED honestly. Do not fabricate a defect or weaken assertions
to fill an evidence field. Typecheck the adapted tests as well as product code so
missing required sinks/generic arguments cannot be hidden by transpile-only tests.
The three source renderer manifests declare 12 + 15 + 4 = 31 cases; reconcile any
29-case execution with exact original test names/parameter rows and setup failures.
The source preload/main baselines add 6 + 8 = 14 separate cases, not renderer
candidate coverage. Root verified all 149 manifest source/license entries across
135 unique paths; this proves bytes/provenance only, not execution or closure.
