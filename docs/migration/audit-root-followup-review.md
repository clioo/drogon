# Root acceptance of bounded audit follow-ups

2026-09-06. Source `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. These decisions concern **source characterization**, not executed product parity. Full E1–E5 audit gates remain open. Root review follows the agreed completeness-plus-independent-source-sampling method, not a claim to independently reread every line the lead read.

## E4-S1: accepted at CLI handler/request-builder boundary

Input: `audit-closure/e4-cli/followup-command-semantics.json` and its Markdown companion. Root reconciled every canonical name against the previously accepted `parity-source-contracts.json`: **234 records, 234 unique names, 204 new plus 30 reused, zero missing/extra names, zero missing literal allowed flags**. This check does not resolve inherited flag spreads by itself; the existing shared argument contract and the report's explicit shared/factory rules remain necessary. Root verified all74 declared evidence-file hashes against pinned Git blobs and current bytes, with no mismatch.

Independent source samples checked, not executed:

| Command / source sample | Root verification |
| --- | --- |
| `orchestration worker-start`, complete `src/cli/handlers/orchestration/worker-launch-handler.ts` | Model/effort capability probe precedes mutation; exact payload fields; coordinator identity resolution; non-ready receipt sets exit1; explicit timeout is payload, not direct call timeout. |
| `orchestration worker-release`, complete `worker-terminal-handlers.ts` | Only `release_unknown` adds exit1; retained/pending/already-released are valid receipt states; no unsupported `--from` field. Runtime cleanup ownership remains outside this CLI contract. |
| `automations create`, `automations.ts:172–205` | Schedule and target resolution precede create object; omission-aware sourceContext/runContext; workspace mode default; destination resolution after object validation; exact optional spread. Target resolution can itself call runtime before later field validation, so do not generalize the destination-specific ordering into zero prior RPCs. |
| `file open`, `file.ts:32–115,195–204` | Explicit empty worktree refused, remote omitted selector refused, absolute paths require worktree lookup; only contained paths relativized, root path refused, outside path reaches runtime unchanged. |
| `computer click`, `computer.ts:88–101` plus complete `computer-action-flags.ts` | Required app, window exclusivity before action validation, element/coordinate and modifier rules, preserved empty modifier string, actual target/action/observe payload spread. Shared key grammar remains S2. |
| `claude-teams`, `core.ts:1–90` | Exact raw teammate-mode detection, environment sanitization, Windows refusal, pane requirement, launch preparation then inherited stdio child, numeric exit propagation. Parser bypass remains separately characterized by the accepted entrypoint contract. |

Root also checked the cited worker-start assertion body at `orchestration-worker-cli.test.ts:145–165`: it mocks an outcome_unknown receipt and asserts exit1. Its broader test title is not proof that every receipt variant executes. Per-command future tests remain obligations, not existing coverage.

**Disposition:** S1 finite mapping accepted as source characterization, with S2 shared validators, S3 transport, S4 local effects and S5 formatter boundaries still explicit. No all-command baseline, candidate equivalence, process safety or publication authority is inferred. E4 remains open until its remaining source contracts are reconciled; T1–T4 execution obligations survive that closure.

## E5 release/build/shim entrypoints: accepted bounded characterization

Input: `audit-closure/e5-platform/followup-release-entrypoints.md/json`. Root read the complete report across bounded sections and checked all64 declared source fingerprints against pinned Git blobs and working bytes, no mismatch. Source sampling fully read:

- `config/scripts/publish-complete-draft-releases.mjs` and `verify-release-required-assets.mjs`.
- `config/scripts/dev-cli-terminal-wrapper.mjs`, `src/main/cli/cli-dev-launcher.ts`, `cli-install-path-format.ts`.
- Workflow branches at `.github/workflows/release-cut.yml:318–341,1877–1880,1924–1999`.

Confirmed: early recovery directly publishes bot plain-RC drafts after ancestry and asset metadata, without prior workflow/signature/digest checks; the verifier admits missing size/state and rejects exactly zero size/non-uploaded truthy state. This is a source control-flow fact, not a live release operation or test simulation. Windows inner signature verification is explicitly warn-only (`ORCA_WINDOWS_INNER_SIGNATURE_REQUIRED: 'false'`); outer and inner checks must not be conflated.

Confirmed distinct shell-escaping contracts: terminal wrappers double percent signs on Windows but interpolate POSIX values using JSON double quotes; installer launchers use safe POSIX single quotes but only double Windows quote characters. Neither implementation proves arbitrary-path correctness across both shells. No shell containing user-controlled input was executed by this review.

**Disposition:** accept the finite R1–R4/B1–B2/L1–L2 source-entrypoint characterization with all stated downstream boundaries and unrun assertions intact. No whole-directory, platform, signing, installation or build acceptance. G7 U1–U3, remaining config/build/cloud/assets/infra and named O3–O5 helper semantics remain open and assigned/separate.

## E2 field reconciliation and explicit source exceptions

Root accepts the bounded214-field source routing reconciliation in `audit-closure/e2-settings/closure.json`, not the complete E2 gate. Names are unique, match canonical declaration order exactly, and every row has a contract, source anchor and remaining acceptance obligation. All271 source-file hashes match both pinned Git blobs and working bytes. Independent samples confirmed startup's actual legacy keybinding getter (before file-existence migration checks), dedicated cached file authority, temp-write/rename without fsync, Claude teams mode launch consumption, PTY history isolation defaulting true and sidebar migration preferring an explicit UI boolean.

The three exceptions remain **preserved contracts**, not missing rows or authorization to remove settings:

- **E2-O02 / artifactsEnabled:** declaration explicitly deprecated; default true. Strict RPC `SettingsUpdate` does not admit it; the located five-case artifact capability test distinguishes it from `artifactSharingEnabled`, including fail-closed reads. Root read that test but did not execute it. Preserve legacy data and current artifact availability/publish-consent/visibility as distinct concepts.
- **E2-O02 / experimentalMobile:** default false and telemetry whitelist membership verified. Keep as legacy/metadata in this bounded source characterization, not a proven live feature gate or an alias for default-true `mobileEmulatorEnabled` or `showMobileButton`. Targeted production-name search also found test-support fixtures; no claim of a universal absence of dynamic consumers or permission to drop data.
- **E2-O01 / markdownReviewToolsEnabled:** Settings toggle persists independently from the traced standard/floating editor annotation props. Root traced `useRichMarkdownReviewData` into controller creation guard and review-rail positioning. Standard editor defaults true, floating explicitly false, RichMarkdownEditor default false; canAnnotate requires the prop and a relative source path. Rail visibility (existing notes plus open state) is distinct from creation/positioning permissions. Accept this explicit source mismatch, not “no effect anywhere” or a rendered toggle test. Preserve the advertised capability and require an explicit source-characterization/intended-fix regression during migration.

Sources independently reviewed in this follow-up include `src/shared/default-global-settings.ts:139,215`, `global-settings-types.ts:229–236,403–405`, `telemetry-property-schemas.ts:179–205`, complete `src/main/runtime/rpc/methods/client-settings-schemas.ts` and `artifact-sharing-capability-grant.test.ts`, startup/account/keybinding source neighborhoods, and editor `useRichMarkdownReviewData.ts` plus controller/rail guards. Prior full prop-chain evidence remains in `audit-semantic-followups.md`.

E2-O01/O02 source dispositions accepted; live true/false behavior, persistence, host/OS and candidate correction proofs stay T1–T4 debt. E2-O03's88-action semantics and SK boundary acceptance are still required before E2 closure. Root sent this disposition to the current E2 Dispatch in `msg_71e1f96369f5`; no duplicate scan or leaf is requested.

## E3 Bots/Mentu21: accepted bounded source characterization

Root verified all78 declared source hashes against pinned Git blobs and working bytes. The21 unique callback rows contain input/result descriptions, source anchors and explicit missing-acceptance obligations. Full original Bots and Mentu registration modules independently confirm the7+14 identity set, trusted-renderer guard, outer cast-only argument forwarding, Mentu remove/re-register and Bots direct registration. Typed Mentu arguments are not runtime validation.

Independent source sampling read complete `src/main/ipc/bot-schemas.ts`, `bot-schemas.test.ts`, `src/main/persistence/loading-store/write-flush-barriers.ts`, `src/main/mentu/mentu-session-execution.ts`, `mentu-session-recovery.ts` and `mentu-run-evidence.ts`:

- Bot schema really permits only null explicit models/session models and omits recipe in the strict responsibility object. The existing three tests cover bounded default creation, unsupported/undeclared inputs and mixed trigger refusal, not nonnull model or recipe support through actual registered IPC. Do not weaken intended capabilities to reproduce this mismatch.
- The flush wrapper catches primary and active-view errors and returns early after finalization; a successful in-memory Bot write cannot be reported as durable merely because it calls flush. Actual durable primitive evidence remains separate.
- Review/approval/completed/in-flight/controller state lives in Maps. Cancel requests an abort; it is not descendant exit proof. Completed-result caching and concurrent request coalescing are not cross-process restart guarantees.
- Recovery digest binds run/recipe and step label/backend/model, not outcomes, variables, attempts or full optional state. Absent recipe_ref is admitted; retry label may come from optional state. Preserve these as explicit gaps to test/fix, not comprehensive recovery identity.
- Evidence reader derives live/exited from stored status, verifies the primary run ID but not every optional record identity, and overwrites duplicate output labels. No process probe or formal Commitment Protocol record exists in that path. Migration must distinguish stored outcome from real host observation.

**Disposition:** accept the21 callback source/payload/state map in `audit-closure/e3-bridge/followup-bots-mentu.md/json` with its BM-AUTH through BM-EVIDENCE obligations unchanged. This is neither native Mentu-internal review nor proof of actual callback/runner/renderer execution. E3's remaining45 callbacks, RPC/push consumers and explicitly unknown legacy producers remain separate. No group percentage increase or product implementation follows from this scoped acceptance.

## E1 web projection and navigation identities

Root accepts the bounded web-factory/source-navigation characterization in `audit-closure/e1-ui/followup-web-navigation.md/json`, with the13 inherited caller chains still open. All158 declared evidence hashes independently match pinned Git blobs and working bytes; all50 production modules under `web/preload-api` have evidence entries and the report contains50 unique named surfaces. These checks verify completeness/provenance, not the truth of every semantic row. Independent navigation sampling fully read `settings-navigation-types.ts`, `settings-navigation-foundations.ts`, `ui-slice-settings-actions.ts`, `settings-deep-link-target-watcher.ts` and `top-level-view.ts`, plus the page-effect host/intent ordering, Activity actions, hydration sanitizer and Sidebar bell handler. Previous root web-fallback probes and Activity assertions retain their narrower evidence scope.

Root ratifies these **acceptance identities**, not new features or extra closed audit groups:

- Keep `PUI-SETTINGS-000` taxonomy, `PUI-SETTINGS-002` control search and `PUI-SETTINGS-003` navigation/deep links. `PUI-SETTINGS-001` remains a historical aggregate alias, not the first member of a generated numeric range. The old `001..035` shorthand must not overwrite search/navigation or create fictional numeric cards.
- For each of the35 exact literals in pinned `SETTINGS_NAV_TARGETS`, use `PUI-SETTINGS-PANE-<literal>`. The complete explicit mapping is the frozen follow-up JSON at `navigation.settings.fixedPanes`. This identifies targetable panes, not unconditional visibility or verified controls.
- For the three exact `SETTINGS_NAV_INTENTS`, use `PUI-SETTINGS-INTENT-<literal>`; for the five exported named subtarget constants, use `PUI-SETTINGS-SUBTARGET-<value>`. The frozen JSON lists both mappings. Arbitrary `sectionId` strings remain accepted by the source validator; five named constants are not an exhaustive runtime subtarget allowlist.
- `PUI-SETTINGS-PANE-repo` carries separate repoId/hostId and applicable setupId/representativeSectionId instance metadata. These are audit-instance fields, not a claim that all four are request fields. Source `SettingsNavigationTarget` has no setupId property; the page effect derives it from selected host data. Never manufacture acceptance IDs from user repo names or treat renderer-only host/setup selection as persisted state.
- `PUI-ACTIVITY-001` identifies legacy full-page `activeView=activity`; `PUI-SIDEBAR-003` identifies the separate `sidebarBody=agents` tab. Preserve restoration of Activity, its prior-view close behavior and portal obligations; a missing direct opener search result is not global unreachability. The bell actually changes sidebarBody, not activeView. These supplemental identities refine existing shell/activity scope and do not increase the frozen50-row reconciliation denominator or the12-group audit denominator.

Navigation targets and page opening remain separate operations. Target validation rejects unknown pane/intent/host but admits arbitrary string sections; requested host selection precedes mounting and scrolling. The observer only checks for presence on subsequent mutations, stops after five seconds and supports cancellation; its existence is not an executed timeout test. Keep all pane/host/intent/hidden-target, persistence, accessibility, viewport and actual Electron journeys as later test/implementation acceptance obligations.

E1's exact13 caller-chain follow-up is now active as `task_5f2606b1a214` / `ctx_0677ac521e0a`, reusing the completed lead's exact terminal with a verified input-accepted receipt. No source edits, feature implementation or duplicate factory census were assigned. Any other inherited source gap must retain a named owner/boundary; it cannot disappear merely because the13-row task finishes. Source-audit acceptance and execution debt remain separate gates.

## Migration decisions and phase boundary

Preserve workflow capabilities and the actual user experience, not unsafe interpretations of source comments. Drogon's eventual publication proof must cover **every** publishing path; asset presence alone must never be described as verified signatures, compatible binaries or successful prior tests. Unknown process contact must not justify deleting/replacing owned resources. Source defects get explicit characterization and intended-behavior regression tests during implementation, not silent deletion of capabilities or claims that the source already satisfies these invariants.

These are scoped acceptance decisions within open groups, not new denominator units. Audit remains approximately60% (7/12 accepted groups, medium-low confidence). Next: independently review remaining E2/E3/E1 reconciliations and new E4/E5 boundaries, then close groups only against the unchanged full obligations. Implementation remains **root Astra → Sol leads → approved workers** after full audit acceptance.
