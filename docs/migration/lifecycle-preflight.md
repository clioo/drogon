# Lifecycle preflight — 2026-09-05

Run: `run_d97e86c69c2e`. This extends the earlier three-harness execution smoke; it does not test the rewritten product.

## Permission-mode launch

All three fresh terminals reached their requested model UI and accepted their Task input without a permission prompt: AGY with `--dangerously-skip-permissions`, Claude with `--dangerously-skip-permissions`, OpenCode with `--auto`. This was on the previously trusted checkout; first-ever workspace trust is a separate condition. No global permission settings changed.

## Controlled failure and Delivery replay

Task `task_bbfb58fb8174`, dispatch `ctx_afbd4b56f3c3`, ran the prescribed `node -e 'process.exit(23)'` once. The worker's report records observed exit status 23. Its live `worker_done` message `msg_cb8d8bd2a64f` used `outcome: failed`; Task, Dispatch and worker state were independently read as failed/settled. The coordinator did not relabel it as success or retry the task.

Delivery `delivery_6534186094bb` contained that completion and a sibling heartbeat. Reading again before acknowledgement returned the same Delivery, same message IDs, with `replayed: true`. The failure task still had only its original Dispatch; replay did not launch work. Both messages were processed before acknowledgement. This verifies coordinator Delivery replay handling, not every possible distributed idempotency failure.

The same terminal was explicitly transferred to a new cancellation Task, rather than left idle or duplicated.

## Exact cancellation

Task `task_a7ae05f3dc15`, dispatch `ctx_99edf4cb3370`, wrote its readiness artifact and blocked in an ask (`msg_e568a4966559`). No extra child workload was requested. The coordinator read the exact terminal, its current incarnation and the pending ask before stopping anything.

`worker-stop` returned **stop_unknown**, **processAction: none**, explaining that this was an external terminal. This is not successful process cancellation. Because custom CLI arguments require coordinator-created terminals, this ownership behavior is relevant to all three lanes.

The coordinator then closed only its confirmed disposable terminal `term_68be2508-4d4c-436b-8276-1cc573ce1811`, incarnation `ce0cd8d1-d28f-4e33-b4e2-f12ca3746b2c`. The close receipt reported `ptyKilled: true`. A subsequent `worker-show` reported:

- `state: failed`, `stage: process_exited`;
- `termination_reason: operator_close`;
- `connected: false`, `writable: false`;
- `observation.status: exited`, `exactWorker: true`.

`worker-release` afterward returned `released` with no further process action. Other workers and the coordinator were not targeted. No `worker_done` was fabricated for the stopped worker.

## Accepted coordinator procedure

The basic P0 gate is accepted for this local development setup: real model/tool execution, ask/reply, explicit failure settlement, same-Delivery replay, and exact owned cancellation have evidence. **Automatic `worker-stop` cleanup of externally created terminals is not supported by this observed route.** The coordinator must account for those resources explicitly and verify the returned liveness verdict. Unknown remote identity never authorizes local fallback or broad process cleanup.

Crash/restart, remote disconnect, process descendants, mixed versions and wire-level replay remain product acceptance tests; this bounded infrastructure test does not satisfy them.
