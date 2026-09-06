# E2 settings and shortcut reconciliation

**Proposed disposition: open.** This delivers one complete, ordered reconciliation of all 214 canonical fields, including all 180 inherited classifications, against located source consumers and persistence. It does not claim all downstream behavior is proved: three fields have only toggle/metadata evidence, and full handler/effect coverage for the 88 static shortcut actions remains open.

Source: `/Users/carlos/Documents/Drogon-mentu-session` at `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, read-only. Task `task_34d223f6c73e`; Dispatch `ctx_4d1d028772be`. Root owns acceptance and central ledgers. No product edits, installs, settings changes, services, commits, pushes or PRs occurred.

## Deliverables and completeness

| Evidence | Scope and limit |
| --- | --- |
| [closure.json](closure.json) | Authoritative candidate: 214 field records with declaration/default evidence, original tier, specific contract, hashed consumer anchor, persistence boundaries, source-test pointers and acceptance IDs E2-A001–E2-A214. |
| [field-contracts.tsv](field-contracts.tsv) | Readable 214-row contract matrix in canonical declaration order. S/M/R abbreviate `src/shared`, `src/main`, `src/renderer/src` in the pinned source. |
| [shortcut-contracts.tsv](shortcut-contracts.tsv) | SK01–SK16 characterize platform expansion, normalization, matching, dynamic agents/plugins, focus ownership, native interception, OS conflicts, migration, writes and cache/reload. |
| [source-test-plan.json](source-test-plan.json) | 93 exact source-suite paths with hashes, declaration pointers and complete future invocation argv. These supplement the accepted whole-source suite map; they are not a replacement census or an assertion-coverage claim. |
| [build-closure.py](build-closure.py) | Reproducible artifact assembly/verification; imports no product module and executes no product tests. |

All 214 names are unique and match the accepted routing order. The original mechanical partition remains 185 `ui-consumer` and 29 `internal-authority`, retained for traceability rather than promoted into 185 proved UI behaviors. `semanticRole` separates consumer settings, migration state, legacy migration inputs and metadata. All 180 inherited rows now have a specific bounded characterization or named exception; no omitted field is hidden by a changed denominator.

There are 211 located consumer/migration routes and three exceptions below. This is a routing-review count, not a percentage of behavior understood. Hashes identify 271 source files; hashing a file or recording a test declaration does not claim its entire body/callgraph was read. Review scope was cited source neighborhoods, central migration/mutation bodies and shortcut boundary functions. Composite settings such as voice, notifications, AI recipes and account maps still require their nested domain tests.

## Corrections and significant distinctions

**GlobalSettings.keybindings is an actual legacy input.** Startup passes `() => store.getSettings().keybindings` into `KeybindingService` at `src/main/startup/main-process-account-services.ts:113-120`. Service construction invokes that getter before the migration function checks file existence (`src/main/keybindings/keybinding-service.ts:34-39`; `keybinding-file.ts:85-102`). The earlier field-routing narrative's blanket “no code path reading/writing … through the settings load/save pipeline” should be narrowed: this is a startup migration read, followed by dedicated file authority. Root independently confirmed this correction in message `msg_476d0ef4f248`.

An existing file blocks legacy migration even when its contents later fail parsing. There is no implied fallback to valid legacy settings after an invalid existing file. The service caches its snapshot until reload/mutation (`keybinding-service.ts:64-78`); these methods alone do not automatically notice external disk edits. Per-platform initial migration and pending/done tab-switch seeding remain different contracts. Seed failure preserves pending and retries on a later construction; a successful seed only fills actions without common/active-platform overrides.

**Dedicated keybinding writes do not inherit Store fsync guarantees.** `src/main/keybindings/keybinding-file-parser.ts:57-72` writes a `.tmp`, renames it and cleans up on failure, without fsync or `durable-file-write`. The accepted 14 durable primitive passes cannot prove keybinding-file crash durability. File `null`/`false` means disabled, while mutation API `null` removes the active-platform override and reveals any common value (`keybinding-file-parser.ts:81-82,108-121`; `keybinding-file.ts:216-261`). An empty mutation array disables. Other platforms and unrelated document values survive.

**“Internal” does not mean unused.** Previously default-only anchors now lead to actual bodies: `claudeAgentTeamsMode` enters runtime launch planning (`src/main/runtime/orca-runtime-create-terminal.ts:80`); `terminalScopeHistoryByWorktree` controls PTY spawn isolation (`src/main/ipc/pty/ipc/spawn-options.ts:59`); `rightSidebarOpenByDefault` migrates only when UI state is absent (`src/main/persistence/loading-store/normalize-loaded-ui-state.ts:35-39`). Migration stamps preserve rollout/opt-out distinctions, not ordinary toggle behavior.

**UI controls do not prove product effects.** The matrix records consumer-specific details such as file-only minimap (`MonacoEditor.tsx:239`), Windows-only creation-time acrylic (`createMainWindow.ts:79-83`), lineage-aware delete confirmation (`delete-worktree-flow.ts:103-105`), and new-card-style precedence over compact cards (`use-worktree-card-foundation.ts:43-44`). Getter/prop wiring still requires actual downstream execution. In particular, constructing terminal `wordSeparator` is not proof it changes live without remount.

## SP01–SP13 reconciliation

Reuse the coordinator-reviewed [persistence contracts](../../parity-settings-persistence-contracts.json), with all 15 prior source fingerprints verified. The full contract text, source anchor/hash and exact remaining boundary are embedded by ID in `closure.json`; accepted central traces were not replaced by another census.

| IDs | Preserved obligation |
| --- | --- |
| SP01–SP03 | Primary/backup/default recovery; ordered defaults, saved values and domain repairs; rollout stamps, explicit opt-outs and voice/AI legacy projection. Returned prepared state is not a disk write. |
| SP04–SP06 | Store mutation normalizers, sibling merges and scheduled save; generic renderer authority strips consent/trust/server-preference grants; dedicated runtime switch validates compatibility and fences stale publication. Catching versus propagating write errors remains distinct. |
| SP07–SP08 | Execution-owner visibility versus client host overrides. Remote/local split writes can partially succeed; unsupported servers do not silently inherit client defaults. Empty host override clears and falls back. |
| SP09–SP11 | One-second debounce/five-second pending window is scheduling, not durability. Cache/host/protected-slot serialization and generation/hash guarded writer commits retain their separate failure paths. Waiting on pending write does not drain an armed timer automatically. |
| SP12–SP13 | Strip only explicitly retired keys; preserve existing launch overrides and empty missing-agent defaults on migrated profiles. Durable primitive fsync/rename guarantees remain bounded by platform and caller. |

SP01–SP13 are source-characterized, not newly executed here. Prior receipts contain 13 original durable byte/error cases and one synchronous syscall-order case on macOS, with no skips. They do not cover the entire Store controller, power loss, remote ownership or candidate parity.

## Shortcut boundary reconciliation

The accepted 88 static definitions plus 36 generated agent definitions remain metadata counts. Plugin action ids are open-ended runtime data, subject to the source syntax/length validator; there is no finite plugin total. The matrix does not equate metadata presence with availability.

SK06–SK09 preserve action-specific bare/shift-only permissions, digit-family normalization, exact modifier matching, Mod expansion, logical-key precedence, restricted physical fallback and AltGr protection. Conflict checks consider both scope and explicit conflict groups, expand indexed digits and treat plugin defaults as relevant collisions. SK10–SK11 preserve enabled-agent dispatch filtering, detected/default-agent selection, plugin worktree context and app-focus precedence. SK12–SK13 preserve recorder/editable/floating/browser ownership, repeat suppression, held recent-tab keyup, dictation hold versus toggle and native zoom unbinding. SK14–SK15 keep Mission Control and keyboard layout probes dynamic; unknown layout safely preserves Option composition. SK16 preserves snapshot cache/reload and publication behavior.

These boundary modules were read; the actual action body for every static action was **not** independently traced. That distinction keeps E2-O03 open rather than relabeling the original 88-row catalog as behavior coverage.

## Exact open enumeration obligations

| ID | Evidence and remaining closure |
| --- | --- |
| E2-O01 | `markdownReviewToolsEnabled`: `src/renderer/src/components/settings/GeneralEditorSettingsSection.tsx:391-393` reads/toggles it; default/type are present. The targeted production TypeScript exact-name scan found no downstream read. Resolve possible generic/dynamic consumption or accept an explicitly characterized no-effect source behavior after actual review-tool visibility checks. Preserve the setting pending that decision. |
| E2-O02 | `artifactsEnabled`: declaration at `src/shared/global-settings-types.ts:229-230` explicitly deprecates it; default remains and `src/main/runtime/rpc/methods/artifact-sharing-capability-grant.test.ts:19-20` rejects the old grant alias. `experimentalMobile`: declaration/default plus telemetry whitelist at `src/shared/telemetry-property-schemas.ts:190`; no located feature gate. Root must review metadata treatment; search absence does not authorize removal or equating these with current publication/mobile controls. |
| E2-O03 | Finish exact static shortcut action-to-handler/effect source reconciliation for all 88 accepted ids. SK01–SK16 characterize shared boundaries and dynamic eligibility, not every action body. Retain the existing catalog and each actual consumer's tests; do not shrink the set to native allowlisted actions or renderer aliases. |

## Execution debt and acceptance commands

No product tests ran in this dispatch. No source baseline, test port, candidate behavioral RED/GREEN, real SSH, OS keyboard, browser guest, native menu, packaged app or installation result is claimed. Compilation/setup failures and skipped cases cannot satisfy acceptance.

`closure.json.fields[*].remainingAcceptance` specifies E2-A001–E2-A214 with field-specific expected contracts. Each requires the allowed owner, absent/saved/explicit false-null-empty distinctions where type-valid, durable reload and actual consumer observation. `persistenceContracts[*].verificationBoundary` defines E2-SP01–E2-SP13. `shortcutContracts[*].remainingAcceptance` defines SK01–SK16's concrete platform/focus/file failure cases. Existing source assertions must be ported unchanged; source-test pointers that are fixture/type mentions are explicitly not counted as behavioral proof.

Artifact verification, run successfully:

```sh
python3 docs/migration/audit-closure/e2-settings/build-closure.py verify
```

Result: `214 fields; 180 inherited; 13 SP; 16 SK; 271 source hashes`, artifact consistency only. The exact future source-test argv is in `source-test-plan.json.futureAcceptanceArgv`: `pnpm exec vitest run --config config/vitest.config.ts` followed by all 93 explicit paths. Run in a coordinator-prepared isolated checkout at the pinned revision after native/dependency setup is verified, not against the read-only original. Candidate port paths have not been assigned here; a runnable candidate parity command cannot honestly be supplied before that map exists. Preserve accepted M7 suite obligations beyond this bounded E2 queue.

## Runtime and progress handoff

Live `worker-show` reported Codex identity, exact worker live and depth 1; requested/effective model fields were null because the terminal was reused. Root owns the `gpt-6-astra high` launch provenance; self-description was not used as authentication. Root reported active `maxDepth=1` and explicitly instructed no children yet. No leaf/child Run was created and no child cleanup remains.

Audit estimate remains approximately 60%, medium-low confidence, on the unchanged 7/12 accepted-group denominator; delta is zero accepted groups. This report does not raise that percentage. Next milestone is root review of the complete matrix and E2-O01–E2-O03 closure. The 24-hour target is flexible per root; full-fidelity delivery remains high risk with no numerical ETA asserted. Test migration and product fidelity have no new execution/implementation progress from this source audit.
