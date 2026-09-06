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
