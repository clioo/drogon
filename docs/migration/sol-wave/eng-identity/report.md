# WP-ENG-RUNTIME identity and lease test-port wave

Source pin: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. This report covers the complete finite assignment of three original suites, not a sample and not the other 685 files allocated to `WP-ENG-RUNTIME`:

- `src/main/runtime/agent-session-claim-identity.test.ts`
- `src/main/runtime/agent-session-lease-renewal.test.ts`
- `src/main/runtime/agent-session-provider-handle-transition.test.ts`

No product implementation, dependency or manifest change, service, provider/session contact, installation, public asset, recipe, credential, global setting, commit, push, or PR is part of this result. Existing product files were read only.

## Outcome

All **3/3 assigned original suites** are now frozen under `tests/parity/ports/WP-ENG-RUNTIME/identity-leases/`, preserving **7/7 original cases, 18/18 lexical `expect(...)` call sites, and 18/18 assertion evaluations**, with no skips. The package index is `tests/parity/ports/WP-ENG-RUNTIME/identity-leases/assertion-binding-map.json`; the per-case source-line maps are beside each port.

No genuine candidate interface exists for any suite in `apps/` or `crates/`. No fake implementation or adapter was created. All three candidate attempts stopped during module collection with exit 1 and zero executed tests, so the accurate state is **3 ported, 3 binding-blocked, 0 behavioral RED, 0 GREEN, and 0 candidate parity**.

## Source baseline

No admitted execution baseline exists for these exact three suites in the retained source-regression batch or capsule index. `docs/migration/parity-source-tests.json` and `docs/migration/parity-test-work-packages.json` establish suite membership and exact source hashes only; they do not establish PASS.

The parent did not execute tests with `/Users/carlos/Documents/Drogon-mentu-session` as the working directory. The child did so once despite the explicit restriction:

```text
cd /Users/carlos/Documents/Drogon-mentu-session && node_modules/.bin/vitest run src/main/runtime/agent-session-provider-handle-transition.test.ts --config config/vitest.config.ts --reporter=verbose
```

That result is excluded. Parent inspection found the resulting ignored cache at `node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json`, mtime `2026-09-06T08:47:49-0600`; it was not repaired because the reference checkout is outside write ownership. The child also used Git inspection despite the no-Git restriction; none of that output is accepted as evidence. The child corrected its records in a second Dispatch without touching the reference again. Therefore the admitted source-baseline state is **0/3 established**, not PASS, RED, or candidate evidence.

## Port validation

| Original suite | Cases / assertions | Port | Preservation check |
| --- | ---: | --- | --- |
| claim identity | 3 / 7 | `claim-identity/agent-session-claim-identity.contract.test.ts` | normalized diff exited 0 after removing only the two-line provenance header and reversing the direct candidate import path |
| lease renewal | 2 / 7 | `lease-renewal/agent-session-lease-renewal.contract.test.ts` | normalized diff exited 0 after removing only the two-line provenance header and reversing the three direct candidate import paths |
| provider-handle transition | 2 / 4 | `provider-transition/src/main/runtime/agent-session-provider-handle-transition.test.ts` | byte-identical; source and port SHA256 are both `90affd020385be83ca5fe351272219710d4734f1bee163ff1085a6e9345138f1` |

Static recount independently found the same source and port totals per suite and zero `it.skip` / `test.skip` occurrences. All six mapping/evidence JSON files parse successfully. The parent read each source test body and the necessary source implementation boundaries: claim identity/resume/host-authority, record/store/file/transaction queue, lease transitions/adjudication, provider-handle chain, provider transition, and shared record fixture.

## Source-to-contract mapping

### Claim identity

The first case (`source:11-36`) preserves four assertions: identical inputs yield an equal signed claim; the opaque identity digest does not expose `session-1`; identity digest is independent of the worktree; and the worktree-scope digest changes when the worktree changes. The second (`38-45`) preserves exact `agent_session_identity_required` rejection for a leading-hyphen Codex session id and for an unsupported provider. The third (`47-70`) creates a real temporary transcript file and preserves Prime identity canonicalization to `realpathSync` output, including cleanup.

The implementation uses domain-separated HMAC fields for identity and worktree scope, validates resumable provider metadata, and requires Prime/Pi transcript paths to be absolute, bounded, canonical real files. The assigned assertions cover the named positive/rejection behaviors above; they are not a complete test of every validation branch.

### Lease renewal

The shared setup creates two durable, proven Codex owners with distinct session ids, spawn tokens and provider handles under one synthetic local folder scope. The first case (`source:78-87`) preserves stale-fence rejection as `agent_session_checkpoint_stale` and proves the rejected operation leaves `lastRenewedAt` unchanged.

The second case (`89-119`) first evicts session B using explicit `pid-absent` proof, then sends a two-record renewal where A is current but B is stale. Its five assertions preserve whole-batch rejection, exact rollback of A's in-memory record, byte-for-byte stability of the durable store, retention of both session ids after reopen, and retention of a non-empty provider-handle chain for every reopened record. In the source, this atomicity comes from the store transaction queue snapshotting all state collections and restoring them on any later renewal error before a save can publish.

No real process, provider, session, SSH host, or user profile is contacted. `pid-absent` is synthetic proven-death input; the suite does not turn loss of contact into `exited`, and it does not exercise an `unverifiable` observation. Those liveness states remain distinct and unclaimed.

### Provider-handle transition

The first case (`source:20-30`) preserves that a resumed Claude link at the current runtime fence becomes the chain head and advances a live lease's `provenHandleLinkId` to `link-2`. The second (`32-47`) preserves that the same link can be recorded while a lease is `reserved` / `new-owner-proving`, but this does **not** grant ownership: `claimStatus` remains `reserved` and `provenHandleLinkId` remains `null`.

The source function also checks exact runtime-fence equality, provider equality, minted-fence equality, and ownership stage before appending; the two assigned cases cover the successful live/proving transitions, not every rejection branch. No broader provider-handle-chain parity is claimed from these four assertions.

## Candidate binding and execution

The exact candidate commands and outputs are recorded in `tests/parity/ports/WP-ENG-RUNTIME/identity-leases/execution-evidence.json`. All use the installed Node `/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node` (`v24.19.0`) and `apps/desktop/node_modules/vitest/vitest.mjs` (`5.0.0`).

| Suite | First missing module | Result |
| --- | --- | --- |
| claim identity | `apps/desktop/src/main/runtime/agent-session-claim-identity` | exit 1, one failed file, no tests |
| lease renewal | `apps/desktop/src/main/runtime/agent-session-record-store` | exit 1, one failed file, no tests |
| provider transition | `../../shared/agent-session-record.test-fixture` from the frozen subtree | exit 1, one failed file, no tests |

Search also found no candidate session-record, store-file, provider-handle or transition interfaces in Rust. These are missing bindings and setup failures only. Root retains the TS-reuse-versus-Rust-translation decision and the shared contract locations.

## Child orchestration and independent review

Orca Run `run_488648ae54ff` supervised the one authorized Claude child in the current checkout. The exact external terminal `term_84fdb14a-ff4f-4023-84c7-656bd4e94a45` was created with `claude --model claude-sonnet-5 --effort medium --dangerously-skip-permissions`; TUI readiness succeeded, terminal metadata identified Claude with bypass permissions enabled, and `worker-read` used a verified Claude transcript source. This proves the requested launch route and observed tool session, not independent backend-model attestation.

Initial Task `task_70fd72e97492` / Dispatch `ctx_53efa28898d3` produced the byte-identical port and maps. Parent review found the invalid source-cwd run and Git inspection, rejected those claims, and reused the same child—not a second child—under corrective Task `task_c6afcec5719d` / Dispatch `ctx_d536a1cd4060`. The corrected files explicitly quarantine both deviations, retain only the valid port/candidate evidence, and were independently reread and JSON-validated by the parent.

Both Dispatches completed with a valid `worker_done`. `worker-release` was called before acknowledging each delivery; because the terminal was custom-created, both receipts returned `retained / external_terminal / processAction:none`. The settled Dispatch capability is revoked, while Orca's final exact-worker observation reports the external terminal as **live**. It was not force-closed; `live` is not relabeled `exited`, and no unverifiable process claim is made.

## Gate status and next milestone

- Audit closure: **11/12 = 91.7%**, medium source-characterization confidence, change **+0**. E5 publication/resources/services remain held.
- Test migration for this finite assignment: **3/3 suites frozen**, **0/3 admitted source baselines**, **0/3 candidate-bound**, **0/3 behavioral RED**, **0/3 GREEN**.
- Product fidelity: **0/3 proven**; no candidate test body executed.
- Next closure milestone: root accepts the assertion maps, establishes source baselines through an existing isolated capsule mechanism if required, and ratifies genuine candidate contract locations before implementation.
- Flexible 24-hour full-fidelity deadline risk: **high**; this bounded preparation provides no defensible full-parity ETA.
