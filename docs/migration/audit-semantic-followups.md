# Audit semantic follow-ups — 2026-09-06

Checkpoint after the first five Astra area reports. This supplements, rather than rewrites, their frozen candidate evidence and the earlier launch history in `audit-closure-coordination.md`.

## Acceptance and independent verification

All five original Tasks reported `worker_done` with succeeded delivery outcomes. **All five area gates remain open.** Completing the requested report is not completing the source audit, migrating its tests, or demonstrating product parity. Root read the five reports and their explicit residual obligations before assigning follow-ups.

Root independently checked current file bytes against literal `path`/`sha256` pairs recursively present in each candidate `closure.json`: E1 198 pairs, E2 198, E3 119, E4 157, E5 192; zero mismatches or skipped unsafe paths. These are per-report unique file/hash pairs, not unique files across the entire audit. Historical E3 blob evidence was deliberately excluded from comparison to current checkout bytes. Dictionary-shaped fingerprint collections and fields using other hash names are outside this bounded check. It neither executes worker validators nor proves semantic coverage. No original or candidate product tests ran in this checkpoint.

Audit estimate remains approximately **60%, medium-low confidence**, using the same unweighted 7/12 accepted-group baseline (58.3%). Accepted-group change: zero. Full-fidelity delivery remains high risk against the flexible 24-hour target; worker count is not an implementation ETA. Source interpretation, faithful test migration and actual product acceptance remain separate gates.

## Exact continued ownership

Run `run_97a755fdd5dd` remains owned by the existing root coordinator. Each settled original terminal was revalidated and immediately reused through `worker-start --terminal` with a fresh Task/Dispatch before its completion Delivery was acknowledged. No process restart, duplicate worker, new worktree or implicit takeover occurred. All five receipts returned `ready`, `input_accepted`, exact terminal reuse and no residual resources.

| Area | Original completed Task | Fresh Task | Fresh Dispatch | Finite follow-up |
| --- | --- | --- | --- | --- |
| E1 | `task_671da369fc93` | `task_37a4a186978f` | `ctx_473e529ccc25` | Per-domain web fallback/caller UI behavior and navigation/pane identity reconciliation |
| E2 | `task_34d223f6c73e` | `task_a8ec40535eb1` | `ctx_79157abd58d2` | All 88 static shortcut actions through actual handlers/effects; root retains the three field exceptions |
| E3 | `task_4a5fe24b773f` | `task_daca631a3149` | `ctx_a6552b9aa67f` | Structural schemas and downstream state/errors for all 7 Bots plus 14 Mentu registrations |
| E4 | `task_75e78e6ac486` | `task_901a3250d01a` | `ctx_5b02259f90f7` | Required/default/null/enum/output/error/host and specialized factory semantics for the remaining 204 commands, reusing 30 accepted contracts |
| E5 | `task_2b68b0e8ee1d` | `task_edc891e245a3` | `ctx_ff46a12ee0f4` | Remaining release workflow intervals/signing helpers, Vite and per-OS bin shim entrypoints |

Each lead writes new follow-up files only in its existing area directory and preserves its initial candidate files. Root owns central ledgers, source acceptance, Git, product changes and installation. Hashes/AST/name matches are navigation evidence, never a substitute for reading actual conditional behavior and assertion bodies. Other residual obligations remain recorded; these follow-ups do not silently narrow full fidelity.

The initial E4 follow-up accidentally named the wrong provider prefix. Root corrected it in message `msg_5c5b45471331` before any child launch: the documented approved ID is **`alibaba-token-plan/deepseek-v4-flash-0731`**, not `alibaba-coding-plan/...`. The worker must verify the documented model availability, not infer a replacement.

## User-enabled depth 2 and smoke gate

The user confirmed changing the supported Orca UI setting. Root then independently read the active profile's `nestedWorkerMaxDepth: 2`; the running Orca runtime remained `e9c8216c-44ad-42d5-9d9a-065bd6ada0b9` and E1's exact fresh Dispatch was live at depth 1. Root did not edit the setting or use another identity to bypass it.

Message `msg_b25d1fecff20` authorizes **only E1 initially** to launch one real depth-2 Claude Code `claude-sonnet-5` medium child, using per-invocation `--dangerously-skip-permissions`, official Orca Task/Dispatch provenance and its own lead identity. The useful smoke subset is Activity/navigation/pane identity source characterization; child writes only `audit-closure/e1-ui/leaf/` and cannot delegate. E1 must promptly report actual child Task/Dispatch/depth/launch outcome, review evidence and settle/release its child. Other leads continue direct work until root verifies the smoke and explicitly authorizes one disjoint leaf each.

At this checkpoint, the setting and authorization are verified; **a successfully launched/completed depth-2 worker is not yet proved**. Sidebar worktree lineage is separate from Dispatch ancestry: same-worktree child terminals can appear as peers. Do not claim hidden children or a working three-level hierarchy from the setting alone.

No app build/install, source edit, deployment, provider experiment, Git push or PR merge was performed by this checkpoint. Preserve the latest accepted installed preview and all pre-existing uncommitted product work.

### First real child verified, 06:07 UTC

E1 created child Run `run_3d1c0573e82c`, Task `task_9cfdb3d5d545`, Dispatch `ctx_840482929375`, terminal `term_5d791978-1eeb-4b4e-be79-8dc4e9fc3bc8`, from its own active lead identity. Root independently inspected `worker-show`: depth **2**, `ready` / `input_accepted`, exact worker **live**. Root also read the Orca-resolved Claude transcript and observed actual source-read/tool actions. This proves launched execution, not just accepted input. E1 reported launch argv `claude --model claude-sonnet-5 --effort medium --dangerously-skip-permissions`; attached custom-terminal model fields remain null, not authenticated model proof.

Root message `msg_1a8527912dcf` confirms launch/inference acceptance and requests reviewed delivery plus child release before authorizing the remaining four leaves. Child completion and cleanup were pending at this checkpoint; the root does not take over E1's child lifecycle.

### 06:31 UTC follow-up

E1 reported child completion, source corrections and a release receipt retaining the external terminal (`processAction: none`). Root independently verifies completed depth-2 dispatch, but worker-show still says releaseState `not_requested`. Requested the compact exact release receipt in `msg_f5bd3a1ce0b1`; no manual terminal close or lifecycle impersonation. Other leaves remain pending this receipt verification.

E4 delivered its 204-command S1 candidate in `msg_2068f05b9416`, not yet root-accepted. Its exact terminal was immediately reused for **task_b9fa5d3075c4 / ctx_4f079b6cf63c**, ready/input accepted, auditing S2–S5 in `followup-cli-boundaries.md/json`. Earlier candidate files are frozen. Root owns independent S1 review. No feature implementation or audit percentage increase follows from delivery alone.

Root executed three unchanged original Activity React assertions with source-compatible dependencies; see `activity-portal-test-review.md` for retained results and limits. They correct the leaf's missing-test claim, not full renderer parity.

### 06:36 UTC lifecycle and remaining handoffs

Root read the actual E1 tool-result transcript: `worker-release --dispatch ctx_840482929375 --json` succeeded, receipt request `26298d3b-52c6-454c-9a19-c4fa7584b299`, state `retained`, reason `external_terminal`, processAction `none`. This satisfies cleanup accounting despite worker-show retaining `not_requested`; no manual close is authorized. The first child launch, execution, completion, lead review and safe release path are verified, not merely asserted by its parent.

Nested inbox limitation: E1 reported `consumer_fenced` when checking root mail after binding its child Run. Root's explicit `send --to run:run_3d1c0573e82c` failed `run_not_found`. A bounded `terminal send` to the existing E1 handle delivered current-task guidance, which E1 acknowledged in `msg_0e5ad5bc3ed5`. No identity rebinding, run reset or depth bypass was used. This limitation is an orchestration migration test obligation; do not promise transparent nested mail.

Completed E3/E5 deliveries were received, not semantically accepted. Their exact terminals were immediately reused, preserving all previous candidate files:

| Area | New Task / Dispatch | Finite source-only follow-up |
| --- | --- | --- |
| E3 | `task_1875ceb5017c` / `ctx_ec50da0dfe3b` | Remaining original callback families excluding delivered Bots/Mentu21; `followup-remaining-callbacks.md/json` |
| E5 | `task_a57a6176eeea` / `ctx_60f3ef7f9c21` | Listed 18 O3/O4/O5 install/build helper paths; `followup-install-build-boundaries.md/json` |

Root independently checked E4 S1's 74 declared source-file hashes and E5 release-entrypoints' 64 against both pinned Git blobs and working bytes: no mismatches. This authenticates bounded bytes, not semantic claims or tests. Root review of both complete reports remains open.

After verifying the depth-2 release receipt, root authorized one disjoint leaf for each active E2–E5 lead (not proof launched): E2 up to22 remaining shortcut handlers via Claude Sonnet5 medium; E3 Skills callback family via OpenCode Muse; E4 S5 formatters via OpenCode `alibaba-token-plan/deepseek-v4-flash-0731`; E5 O4 installation helpers via Claude Sonnet5 medium. Messages respectively `msg_da946dfc2d74`, `msg_128584005065`, `msg_9bcf6eb24424`, `msg_6f224cfc9ad2`. Existing-task scope and leaf-only write directories are explicit; leads must skip redundant spawning, review results and release children before completion. All remain audit-only. No acceptance percentage changes.

## Additional root source finding for E2-O01

Mentu Navigator 1.1.1 successfully located the Settings toggle, and root read the actual rich-editor prop chain in the reference checkout. `TabGroupPanel.tsx:381` passes no annotation-enabled override; `EditorPanel.tsx:35` defaults `markdownAnnotationsEnabled` to true and forwards it at 389. `EditorPanelShell.tsx:165` and `EditorMarkdownFileSurface.tsx:119` propagate it to `RichMarkdownEditor`, whose independent default is false at 52 and whose review-controller call forwards the prop at 116. `useRichMarkdownReviewData.ts:43` derives permission from that prop and relative-path existence. `FloatingTerminalPanelSurface.tsx:296–300` explicitly sets the prop false. These paths are under `src/renderer/src/components/` in the read-only original.

This is stronger bounded evidence than an absent exact-name search: the located standard and floating editor paths explicitly gate annotations independently of `markdownReviewToolsEnabled`, despite the Settings copy advertising that toggle as controlling rich-editor review notes. It remains a source-defect candidate, not a rendered true/false-toggle test, proof about every possible caller, or permission to remove the setting. Root sent these anchors and limits to E2 in `msg_4f46be672376`; the 88-action follow-up remains its priority. Source-faithful characterization and any intended behavior correction must remain distinguishable in migration tests.
