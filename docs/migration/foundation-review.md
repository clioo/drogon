# Foundation review — 2026-09-05

Target: [PR #1](https://github.com/clioo/drogon/pull/1), `edcc2e9..09c728f`. The read-only phase finished at unchanged HEAD `09c728f7a70e94a016a78b4b064f56dc0b01c3e2` and clean status. No worker modified repository files during review. This document begins the subsequent, already-authorized correction phase.

## P0

None confirmed.

## P1

- `crates/drogond/src/server.rs:58`: any accept error breaks the service loop. A transient OS failure can end the service, not merely reject that client. Fix with retry/backoff and an injected-error regression. The worker's claim that the process necessarily remains alive was inaccurate: `main` returns after `serve` returns.

## P2

- `crates/drogon-core/src/session.rs:38`: exited sessions retain native PTY resources for the service lifetime. Repeated short sessions can exhaust descriptors. Release native handles after exit and output drain while preserving retained output; memory/durable-output retention remains a separate policy.
- `crates/drogon-core/src/session.rs:166`: inherited `DROGON_*` context can point a child at a different service than the explicit daemon target. Strip stale control context; later native dispatch injects its own scoped identity.
- `crates/drogon-core/src/lib.rs:344`: distinguish a never-existing identity from a persisted session whose handle cannot be verified, consistently across operations.
- Coordinator inspection: renderer transport loss leaves a cached `live` badge; explicitly dismissed tabs return after reload; non-start session responses lack exact identity matching. Correct and add rendered recovery/dismissal probes.
- Coordinator inspection: the launch form only retains an ambiguous admission while open. Persist recoverable intent across dismissal/reload and require an explicit retry with the same identity.

## NIT / additional hardening

Panic-safe completion of request waiters, bounded retained-output memory, storage-failure retry resource limits, deterministic ordering and real live-child crash recovery need follow-up evidence. Never replace honest persistence uncertainty with false success just to bound a retry.

## Rejected or downgraded worker claims

- The alleged unbounded JSON recursion is false for the pinned dependency: `serde_json 1.0.151` initializes a 128-level limit and returns `RecursionLimitExceeded`. No code enables unbounded recursion.
- The claim that no rendered tests exist is false: `scripts/accept-desktop.mjs` and `scripts/probe-rendered-harness.mjs` execute real Electron/CDP checks; the coordinator reports and screenshots were also inspected. Absence of `.test.tsx` files is not absence of rendered coverage.
- `Popover.Anchor` without `asChild` is intentional here: the child is a non-DOM menu root. The prior broken composition was reproduced and fixed; actual position bounds and screenshots passed.
- AGY's prompt flag is not an observed injection defect: the reviewed installed parser consumes its following value. Speculative future parser changes do not establish a current P2.
- Client/server symlink policy consistency is worth hardening, but the proposed malicious-same-user takeover is not a demonstrated P1 authentication boundary: that principal can read the same private token and alter the same files already. Do not claim OS isolation from cooperative local credentials. Preserve legitimate platform parent aliases while tightening final-path handling if implemented.

## Coverage and settlement

Orca run `run_1a839b8fab20`: GLM lifecycle `task_a22a58cfa57d/ctx_00991230c4cc`; Sonnet isolation `task_e0166dae0ad6/ctx_887d02a2ccbb`; Sonnet clients `task_24e3386bca18/ctx_8dc9928482b2`. Three scoped passes across two provider contexts, not three independent models; the two Sonnet passes shared context, so their repeated path claim is not independent corroboration. All accepted dispatches were released; existing external terminals were retained with no process action. All delivery batches were acknowledged.

Lifecycle/isolation submissions stayed below 180,000 characters. Client diff was capped at 180,000 of 279,479 characters, with remaining committed files read separately by the reviewer. These were static worker reviews; the coordinator's separately recorded acceptance supplies runtime evidence. Worker reports contained unsupported assertions and were not treated as approval by majority. Current-head CI passed in [run 33991792649](https://github.com/clioo/drogon/actions/runs/33991792649).
