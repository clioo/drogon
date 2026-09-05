# Parity work packages — tests-first breakdown (proposal, CORRECTED v2)

Planning-only, no implementation, Sol hierarchy **not launched** by this
task. Machine companion: `docs/migration/parity-test-work-packages.json`
(schema `drogon.parity-test-work-packages/1`, `status: proposal`,
`dispatchable: false`, 46 packages). Independently validated with Node
(read-only): 9 037 unique paths partitioned with zero duplicates, zero
missing, zero hash mismatches against manifest sha256
`85ac41eb…f5caf83`; dependency DAG has no missing ids and no cycles;
measured max depth **5** (reported, not asserted — see §2).

- Source: `/Users/carlos/Documents/Drogon-mentu-session` @ `c9790628`;
  manifest entries 9 038 = 9 037 unique paths + 1 byte-identical twin
  (`native/computer-use-macos/Package.swift`, both roles preserved in JSON
  as `bothRoles`, allocated once to WP-SUP-CONFIG as support, not executed).
- JS/TS family 8 976 + 2 non-JS (`config/tsconfig.e2e.json` → WP-SUP-ASSETS;
  `runtime-render.test.ps1` → WP-UNRESOLVED-01). Filter difference, not a
  count error.
- File routing is an **allocation heuristic by source path**, NOT proof of
  behavior or coverage and NOT a capability enumeration. Packages holding
  hundreds of files are **ALLOCATION BUCKETS, not bounded worker tasks**:
  per-capability leaf cards with finite ownership and acceptance are
  required before any dispatch.
- Test-port wave and implementation wave are separate fields: tests port
  early (mostly W0/W1, contracts only) and never wait for missing product
  implementation. This resolves the prior wave contradictions (UI-WORK→CAP-INT,
  ENG-NATIVE→ENG-INSTALL) without dropping any acceptance check — the joint
  checks live in §3 integration groups.

## 1. Ownership model (future only)

Astra → three Sol area leads → leaf workers. Shared contracts, manifests,
lockfiles, and `.github` are **centrally owned by the coordinator**; workers
fork an immutable integrated base, never write shared files concurrently,
and land via worktree PRs with review + integration, then packaged
validation, then installation (per `rewrite-parity-plan.md` §§5–6, 9).
Test-port boundaries are mutually disjoint
`tests/parity/ports/<package-id>/**`. Product boundaries are **unratified
proposals only**, requiring exact future leaf-task carve-outs and exclusions;
shared protocol/manifests are assigned to **no** Sol writer (WP-ENG-SHARED
lead: Coordinator). Bridge/CLI census files
(`parity-source-bridges.json`, `parity-contract-enumeration.md` incl.
`parity-source-contracts.json`) are **active and unaccepted**: referenced
provisionally (WP-UI-PRELOAD, WP-ENG-CLI), never as frozen baselines.

## 2. Packages (counts exact; implementWave deps form a DAG, depth measured 5)

`TW` = testWave (port tests; contract deps only), `IW` = implementWave.
Full per-package runner/platforms/RED-GREEN/screenshots/pending lists are in
the JSON; counts below cross-checked against it (46 rows, 9 037 files).

| ID | Lead | Files | TW | IW | Depends on (IW) | Test-port boundary |
|---|---|---:|---|---|---|---|
| WP-UI-TERM | Sol-UI | 469 | W1 | W1 | ENG-DAEMON, ENG-IPC | ports/WP-UI-TERM |
| WP-UI-STATE | Sol-UI | 310 | W1 | W1 | — | ports/WP-UI-STATE |
| WP-UI-SHELL-NAV | Sol-UI | 290 | W1 | W1 | UI-STATE | ports/WP-UI-SHELL-NAV |
| WP-UI-WORK | Sol-UI | 262 | W1 | W3 | ENG-GIT (+INT-PROVIDER-UI) | ports/WP-UI-WORK |
| WP-UI-EDITOR | Sol-UI | 211 | W1 | W1 | UI-STATE | ports/WP-UI-EDITOR |
| WP-UI-SHELL-WIN | Sol-UI | 171 | W1 | W1 | UI-STATE, UI-PANES | ports/WP-UI-SHELL-WIN |
| WP-UI-SETTINGS | Sol-UI | 171 | W1 | W3 | ENG-SHARED | ports/WP-UI-SETTINGS |
| WP-UI-PANES | Sol-UI | 237 | W1 | W1 | UI-STATE | ports/WP-UI-PANES |
| WP-UI-AUX | Sol-UI | 160 | W1 | W3 | ENG-PLUGINS | ports/WP-UI-AUX |
| WP-UI-DASH | Sol-UI | 100 | W1 | W3 | UI-STATE | ports/WP-UI-DASH |
| WP-UI-AUTO | Sol-UI | 100 | W1 | W2 | CAP-AUTO | ports/WP-UI-AUTO |
| WP-UI-BROWSER | Sol-UI | 97 | W1 | W2 | ENG-BROWSER | ports/WP-UI-BROWSER |
| WP-UI-NCHAT | Sol-UI | 97 | W1 | W2 | ENG-NCHAT (+INT-NCHAT) | ports/WP-UI-NCHAT |
| WP-UI-CORE | Sol-UI | 829 | W1 | W1 | UI-STATE | ports/WP-UI-CORE |
| WP-UI-PRELOAD | Sol-UI | 15 | W1 | W1 | ENG-IPC, ENG-SHARED | ports/WP-UI-PRELOAD |
| WP-UI-JOURNEYS | Sol-UI | 396 | W1 | W1-steps/W4-full | ENG-RUNTIME, ENG-CLI, UI-CORE (+INT-PACKAGED) | ports/WP-UI-JOURNEYS |
| WP-ENG-RUNTIME | Sol-ENG | 688 | W1 | W1 | ENG-DAEMON, ENG-SHARED | ports/WP-ENG-RUNTIME |
| WP-ENG-SHARED | Coord | 628 | W0 | W0 | — (centrally owned) | ports/WP-ENG-SHARED |
| WP-ENG-IPC | Sol-ENG | 385 | W1 | W1 | ENG-SHARED (+INT-PROTO-BINDINGS) | ports/WP-ENG-IPC |
| WP-ENG-SHELL | Sol-ENG | 367 | W1 | W1 | ENG-DAEMON | ports/WP-ENG-SHELL |
| WP-ENG-HARNESS | Sol-ENG | 290 | W1 | W2 | ENG-CLI | ports/WP-ENG-HARNESS |
| WP-ENG-REMOTE | Sol-ENG | 282 | W1 | W1 | ENG-DAEMON, ENG-SHARED (+INT-GIT-REMOTE) | ports/WP-ENG-REMOTE |
| WP-ENG-DAEMON | Sol-ENG | 209 | W1 | W1 | ENG-SHARED | ports/WP-ENG-DAEMON |
| WP-ENG-BROWSER | Sol-ENG | 180 | W1 | W2 | ENG-REMOTE | ports/WP-ENG-BROWSER |
| WP-ENG-RELAY | Sol-ENG | 167 | W1 | W2 | ENG-REMOTE, ENG-GIT | ports/WP-ENG-RELAY |
| WP-ENG-NCHAT | Sol-ENG | 91 | W1 | W2 | ENG-SHARED (+INT-NCHAT) | ports/WP-ENG-NCHAT |
| WP-ENG-GIT | Sol-ENG | 147 | W1 | W1 | ENG-SHARED (+INT-GIT-REMOTE) | ports/WP-ENG-GIT |
| WP-ENG-PLUGINS | Sol-ENG | 132 | W1 | W2 | ENG-IPC | ports/WP-ENG-PLUGINS |
| WP-ENG-AGENTSVC | Sol-ENG | 166 | W1 | W2 | ENG-HARNESS | ports/WP-ENG-AGENTSVC |
| WP-ENG-CLI | Sol-ENG | 111 | W1 | W2 | ENG-RUNTIME, ENG-SHARED | ports/WP-ENG-CLI |
| WP-ENG-CLOUD | Sol-ENG | 146 | W1 | W2 | ENG-RELAY | ports/WP-ENG-CLOUD |
| WP-ENG-NATIVE | Sol-ENG | 33 | W1 | W3 | ENG-SHELL (+INT-PACKAGED) | ports/WP-ENG-NATIVE |
| WP-ENG-INSTALL | Sol-ENG | 44 | W1 | W3 | ENG-SHELL | ports/WP-ENG-INSTALL |
| WP-CAP-BOTS | Sol-CAP | 4 | W0 | W3 | ENG-HARNESS, ENG-IPC | ports/WP-CAP-BOTS |
| WP-CAP-MENTU | Sol-CAP | 28 | W0 | W3 | ENG-IPC, UI-CORE, ENG-SHELL | ports/WP-CAP-MENTU |
| WP-CAP-MEET | Sol-CAP | 5 | W0 | W3 | ENG-SHELL | ports/WP-CAP-MEET |
| WP-CAP-AUTO | Sol-CAP | 24 | W1 | W2 | ENG-RUNTIME | ports/WP-CAP-AUTO |
| WP-CAP-INT | Sol-CAP | 137 | W1 | W3 | ENG-GIT | ports/WP-CAP-INT |
| WP-CAP-MOBILE | Sol-CAP | 532 | W1 | W3 | ENG-REMOTE | ports/WP-CAP-MOBILE |
| WP-CAP-DEVICE | Sol-CAP | 62 | W1 | W3 | ENG-HARNESS | ports/WP-CAP-DEVICE |
| WP-CAP-DIAG | Sol-CAP | 57 | W1 | W3 | — | ports/WP-CAP-DIAG |
| WP-SUP-CONFIG | Coord | 15 | W0 | W0 | — | ports/WP-SUP-CONFIG |
| WP-SUP-CI | Coord | 15 | W0 | W0 | — | ports/WP-SUP-CI |
| WP-SUP-SCRIPTS | Coord | 174 | W0 | W0 | SUP-CONFIG | ports/WP-SUP-SCRIPTS |
| WP-SUP-ASSETS | Coord | 2 | W0 | W0 | — | ports/WP-SUP-ASSETS |
| WP-UNRESOLVED-01 | Coord | 1 | W0 | W0 | — | ports/WP-UNRESOLVED-01 |

Preservation rule (plan §6): already-implemented Bots/Meetings/Mentu
migrate **with** migration at IW W3 (testWave W0 triage first); only truly
preexisting pending work goes postmigration W5, recorded per package in
`pendingPostmigration` (Bots: reactive adapters/delegation UI/trigger UX/
flush barriers; Mentu: Qwen compat, recipe-81/90 follow-ups, rendered final
check; Meetings: shared-spaces model).

## 3. Integration groups (mutually coupled consumers; no package cycles)

| Group | Members | Wave | Joint acceptance (not deleted, relocated here) |
|---|---|---|---|
| INT-PROTO-BINDINGS | SHARED, IPC | W1 | TS bindings parity; unknown channel ⇒ typed error |
| INT-GIT-REMOTE | GIT, REMOTE | W1/W2 | git-over-SSH journeys; provider-unavailable typing; unverifiable-never-exited |
| INT-NCHAT | UI-NCHAT, ENG-NCHAT | W2 | portal gating incl. fallback-unsafe tabs (SHOT-NCHAT-01/02/03) |
| INT-PROVIDER-UI | UI-WORK, CAP-INT | W3 | live-provider UI journeys; W1 UI tests stay fixture-scoped |
| INT-PACKAGED | NATIVE, INSTALL, JOURNEYS | W3/W4 | packaged validation (identity, marker/receipt, rollback) then installation |

Per-wave task DAGs run behind frozen contract gates (WP-ENG-SHARED W0
first); short DAGs per wave are preferred over one deep graph — measured
implementWave depth reaches 5 on harness/vertical chains, which is why leaf
cards (finite ownership/acceptance) gate dispatch, not this allocation.

## 4. Gaps register (all known; open, not deferred, not verified)

Inventory gaps, exhaustively (all 14 manifest `gaps` ids):
`candidates:unclassified-present`, `cases:static-markers-only`,
`cloud:pnpm-recursive`, `imports:binary-unscanned`,
`playwright-discovery:tests/playwright.config.ts`,
`reachability:inferred-not-verified`,
`vitest-include:computed:cloud/apps/relay/vitest.config.ts`,
`vitest-include:conditional:config/vitest.config.ts`,
`vitest-include:defaulted:` ×5 (relay-fence-broker, relay-ops, relay,
relay-contract, mobile `package.json#test`), `workflows:dynamic-matrix` —
owner test-infra (ENG) / W0. Each broad row above is an entry point, not a
resolution of its members.

| Further gaps | Anchor | Proposed owner / wave |
|---|---|---|
| ~40 suites triage-pending + non-transportable list | parity-test-porting.md §7 | per-package lead / W0 triage |
| G1–G20 platform omissions | parity-platform-audit.md §10 | ENG (+CAP provider rows) / W0–W1 |
| Unread renderer domains (native-chat 226, automations 276, browser 281, skills 115, task-page 47, PR page 54…) | parity-ui-audit.md §10, §13 | Sol-UI / W1–W3 |
| Journey named gaps (channels, gates, skills 176 files, tours, rollback…) | parity-ui-journeys.md per-journey sections | Sol-UI (skills→ENG) / W1–W3 |
| CLI omissions + NEW-vs-LEGACY summary | parity-cli-audit.md §8, §11 | Sol-ENG (CLI) / W2 |
| Pending ledger 1–9 + unknowns | parity-drogon-delta-audit.md §§7, 9 | Sol-CAP / W4–W5; upstream → coordinator+human |
| Bridge limits (disjoint namespaces, G6 ipcMain, signature names, cross-file channels) — provisional | parity-bridge-enumeration.md gaps register | ENG-IPC / W0–W1 |
| Contract unknowns §6 — provisional | parity-contract-enumeration.md §6 | ENG-CLI / W2 |
| Unresolved bucket: ps1 runner unknown | WP-UNRESOLVED-01 | coordinator / W0 |

## 5. Closure statement (audit NOT closed)

**Audit closure** = no unowned omissions + a completely enumerable
observable surface. This proposal achieves neither on its own: the 9 037-path
partition proves **file allocation completeness**, which is strictly weaker
than observable-surface enumeration (screens, states, journeys, matrices,
provider behaviors). Baseline execution, port validation, and runtime proof
belong to the test waves; the gaps above stay open until their owning wave
greens them. No capability is deferred by this document; a disabled surface
is not parity.
