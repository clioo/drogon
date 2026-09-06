# Ten scanner-unobserved settings — reviewed consumer traces

Coordinator-reviewed bounded source contracts at
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`.
The JSON companion is authoritative for exact paths, anchors, hashes and
narrow assertion claims. These ten are the exact no-observed-reference
cohort in the accepted scanner output; none is assumed unused.

No source module was imported, no original test executed and no product or
personal setting changed. All ten lack a builder default in the accepted
field census, but that does not mean their consumers lack defaults/migrations.

## Actual behavior to preserve

| Field | Consumer / migration obligation |
| --- | --- |
| browserSshWorkspaceRoutingProbeSkippedTargetIds | Shared settings list keyed by SSH target, not per-worktree storage. Try anyway appends; recheck removes. Retry's local flag reset does not clear a persisted skip. Routing-disable is a different property. |
| keybindings | Getter runs on every service construction, before the migration's file-exists check. Existing file or empty legacy input prevents writing; otherwise active-platform overrides migrate. The file then drives current bindings. |
| dismissedSkillFreshnessNudges | Exact physical-identity/name/revision tuples; deduplicated append, final512 entries retained. Not strict LRU. Only explicit dismissal persists; update action and stale/unavailable inventory retraction do not. Rejected write removes the persistence guard. |
| experimentalSidekick | New experimentalPet value wins, including false; otherwise legacy flag then false. Inspected normalization preserves the legacy key while writing the new value. Serialized post-save round-trip remains untested here. |
| agentsSidebarIntroShown | Intro eligibility also requires the migration marker. Got it / popover close requests acknowledgement. Write failure/reset means this is not an unconditional exactly-once guarantee. |
| agentsSidebarMigratedFromExperimental | Prior true survives normalization; otherwise prepared activity supplies it. Prepared activity depends on the prior rollout marker, not simply raw activity:true. Header consumes the result. |
| experimentalAgentDashboardShowIdle | Menu toggles, snapshot serializes showIdle, sidebar independently filters idle count badges. Snapshot flag assertion alone does not prove cards were filtered. |
| experimentalCompactWorktreeCards | Current compact setting wins over legacy then default. Normalizer clears the legacy key explicitly; preserve current false rather than replacing it with old true. |
| gitlabProjects | Global host/path arrays, not per-account storage. Recent helper preserves pinned, deduplicates/prepends and caps at10. Successful work-item lookup records recent; null does not. Pinned is reserved for future UI in the type comment. |
| tabSwitchKeybindingSeed | Fresh done, existing pending, prior values preserved by cohort classification. Pending can retry across failures and later become done. Service catches seed failure without marking completion; not a lifetime-single-attempt marker. |

These are not a strict split of five migration-only and five UI-toggle fields.
For example the migration marker is read by UI, and GitLab history is written
by main-process lookup handling, not a direct toggle.

## Corrected evidence and omissions

Mentu Navigator located
`src/main/runtime/orca-runtime-tests/gitlab-and-pr-bases-part-02.spec.ts`.
The coordinator read its first test body: the runtime method with a stub store
requests pinned-preserving history after a successful lookup and no write
after null. This contradicts v1's blanket "no real consumer test" statement.
It does not prove real disk persistence or unmocked external lookup.

`src/main/keybindings/keybinding-service.test.ts:209-226` injects a regular
file as home, causing seed-write failure; construction does not throw and
the cohort remains pending. Its second-launch test also checks idempotency.
The prior missing-failure-test claim is withdrawn. Neither test ran here.

`SidebarHeader.test.tsx:272-280` sets IntroShown only as fixture input while
asserting absence of a deprecated full-view action. It is not a test of
acknowledgement persistence. The actual introduction test at166-181 checks
migrated versus empty settings. Broader dismissal/reload proof remains owed.

`build-dashboard-snapshot.test.ts:722-731` checks serialized showIdle,
not actual idle-card filtering. Consumer behavior and test claims stay separate.

The skill nudge cap is directly declared as512. Set insertion order preserves
an already-present key's original position; describing the cap as LRU would
be wrong. Read assertion bodies cover exact-tuple dismissal and retraction,
not all cap-eviction/write-failure paths.

## Verification and remaining work

The JSON's34 source hashes and exact10-field cohort are independently checked;
hash inclusion records identity, not a claim every line of every file was read.
Relevant bodies are characterized at their cited anchors.

No unqualified "no tests exist", "never reset", "permanent" or "only consumer"
claim follows from this bounded audit. Source dependencies, store-wide reset
and persisted migration, real keyboard events and remote execution remain
test-wave obligations. Complete214-field settings routing is still open.
