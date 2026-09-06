# Renderer shutdown-checkpoint handoff

2026-09-06. This finite Sol-UI block ports the two pure renderer checkpoint
policy modules from pinned source revision
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`. It does not wire a caller,
implement IPC or durable storage, or establish whole-desktop parity.

## Outcome

The candidate now contains:

- `apps/desktop/src/renderer/src/app-shell/shutdown-checkpoint-persist.ts`
  (`3fc677478c98191551fe57796feedd3e77bec8bfd3252ebd3ea94757788fc911`)
- `apps/desktop/src/renderer/src/lib/shutdown-checkpoint-guard.ts`
  (`8ed519a27267ed96633ef8bc65110f8bc8bd8ea795f22509b93a2b90c680b17d`)

The behavior is source-faithful apart from the root-approved dependency seam.
`TSnapshot` and `TUi extends object` remain opaque and reach staging unchanged.
Both entry points require an injected `(name, data)` breadcrumb sink; sink
exceptions cannot mask the checkpoint verdict. No generic domain schema,
`window.api` substitute, no-op production recorder, main handler, or durable
implementation was introduced.

The port preserves capture ordering, sleeping-agent capture visibility,
dirty-draft refusal, first-failure retry, repeat-only degradation during an
intentional shutdown, no retry-budget burn from unrelated unloads, independent
abort reset, DOM failure-reason/event interoperability, and refusal to permit a
restart after a failed checkpoint.

## Three distinct evidence gates

### Source baseline

Five hash/license-verified suites were staged under
`.preflight/parity-baseline` and executed outside the read-only source cwd:

| Suite | Source cases | Manifest SHA256 | Raw result SHA256 |
| --- | ---: | --- | --- |
| renderer persist | 12/12 | `c97a62f4ac0e90ba9b300b89156e8d7f669ed880574f80fdbc5fe3b583d57a53` | `79b6dab2dc211233b3a879ffc35667181060d9b81875cb726e96475fa21c3507` |
| renderer guard | 15/15 | `b90f97a5686c3ad03ec651c036d449012c416cae96eb8dc5499b1ce06cf22483` | `fa89f77b5903cf56c3e7f3b771ae05971ed1abaff964b6349e56c089103fadbd` |
| renderer restart lifecycle | 4/4 | `7f663ecf6639cafda8e054b5e656210e6eff06749bfd52686e322d8083664c04` | `c1eac570f935b6979dd2457775902ec44f501bc8f85e1120b0a759aa35d3aa90` |
| main IPC checkpoint | 8/8 | `5f1196246c1cfbebfa24c3ce7caf7e84556de7f351412ea5321369d91dbde19d` | `0718af5682e307059c3b85370aec21e125f6a125ccfb9703bebdce4ea00903f3` |
| preload restart routing | 6/6 | `b94dcd7c017adc8ccc3b50007af09a8c69c6874e9db7a4d7c83b8368b1d58541` | `af95f3bf7a7c75fc4f01e668c2aa2a3f57baabd3e215799d7cab07f2b382571a` |

Total source result: **45/45**. Renderer policy accounts for **31** cases:
12 persist + 15 guard + 4 lifecycle. Main/preload add **14** separate baseline
cases and are root implementation-map inputs, not candidate renderer coverage.
The guard total includes two source-byte caller pins which remain open in the
candidate: “runs the quit checkpoint inside the window-close scope and
surfaces a vetoed quit (STA-5505/#15352)” and “wires dirty editor unload vetoes
to the paired-web checkpoint reset.”

The common executed capsule form used Node 24 with
`scripts/run-parity-baseline-capsule.mjs`, the matching manifest and approved
digest from the table, `--source-root /Users/carlos/Documents/Drogon-mentu-session`,
`--execute`, and source-pinned Vitest 4.1.11. This is a recorded limitation:
renderer dependencies and `zod` were staged from the pinned source runtime, so
the source-baseline execution did not meet a strict candidate-tooling-only
interpretation. The first preload attempt lacked staged `zod` and failed 6/6;
it remains setup evidence at
`.preflight/parity-baseline/preload-app-restart-checkpoint-routing-k66Eqc/`,
not behavioral RED. Root's 149 manifest entries across 135 unique paths prove
byte/license provenance only, not complete dependency closure.

### Port validation

The adapted candidate executes **29 original renderer behaviors**: 12 persist,
13 guard behavior cases, and 4 lifecycle parameter rows. The two guard caller
pins above are mapped/open. Five separately named `strengthening:` cases cover
opaque host-qualified payload identity, exact sleeping-capture breadcrumb data,
fallback formatting, and throwing-sink isolation. Therefore the focused
candidate result is **34/34**, not 31/31.

The retained `6 failed | 23 passed` run used missing required sinks and bound
the abandon callback into the new sink position. It is a signature-adapter
failure, **not behavioral RED**. Missing imports were also setup failure. No
correctly bound pre-fix suite demonstrated a product-policy defect, so
historical behavioral RED is honestly unavailable and none was manufactured.
Root independently compared expectation ASTs: all 71 expectation statements
match across the 28 original declarations (29 expanded cases), with only the
two documented caller pins absent.

Final lead commands from `/Users/carlos/Documents/Drogon-rewrite`:

```text
/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node apps/desktop/node_modules/vitest/vitest.mjs run tests/parity/ports/WP-UI-PRELOAD/shutdown-checkpoint/shutdown-checkpoint-persist.test.ts tests/parity/ports/WP-UI-PRELOAD/shutdown-checkpoint/shutdown-checkpoint-guard.test.ts tests/parity/ports/WP-UI-PRELOAD/shutdown-checkpoint/shutdown-checkpoint-restart-lifecycle.test.ts --environment node --reporter dot
# exit 0; 3 files passed; 34 tests passed

/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node apps/desktop/node_modules/typescript/bin/tsc -p tests/parity/ports/WP-UI-PRELOAD/shutdown-checkpoint/tsconfig.json --noEmit
# exit 0; adapted tests typecheck

/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.json
# exit 0; desktop product typecheck
```

### Candidate parity

Candidate parity remains open. The two modules are not imported by production
callers. `updater-beforeunload.ts` exists only as a provenance-marked test-local
lifecycle closure, the full host-qualified snapshot/UI types are not bound, and
there is no real breadcrumb recorder, synchronous staging admission, native
durable write/flush join, 20-second deadline, or Electron restart/recovery
acceptance. A failed checkpoint must continue to block restart when root wires
these seams; a resolved-promise placeholder is not acceptable.

## Delegation and release

Sol reused one verified OpenCode 1.18.29 terminal showing
`Build auto · GLM-5.3-Flash Z.AI Coding Plan` from the approved
`opencode --model zai-coding-plan/glm-5.3-flash --auto` invocation. Run
`run_94251496baee` supervised initial Task `task_e205a588e3e9` / Dispatch
`ctx_31520c45530a`, review correction `task_e9fef7c6ca57` /
`ctx_fa1416f33b68`, and final consistency correction `task_2e9be5a45cf3` /
`ctx_6232b89c1402`. No second leaf or nested delegation was used.

The final release receipt `c4ba7f53-b852-440b-b289-9257d2eb2724` returned
`retained / external_terminal / processAction:none`; no process was killed, and
the final delivery was acknowledged afterward.

- Audit closure remains **11/12 = 91.7%**, medium confidence, change **+0**;
  this implementation does not close the remaining audit capability.
- Test migration: source baseline **45/45**; candidate **34/34** plus two
  caller pins mapped/open; both product and adapted-test typechecks pass.
- Product fidelity: two pure renderer policy modules are ported but remain
  unwired; no global GREEN is claimed.
- Next milestone: root binds real types/recorder/callers and implements native
  staging plus durability, then runs DOM/IPC/restart/recovery acceptance.
- Flexible 24-hour whole-product fidelity risk remains **high**. E5
  publication/resources/services remain held.

