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

## Migration decisions and phase boundary

Preserve workflow capabilities and the actual user experience, not unsafe interpretations of source comments. Drogon's eventual publication proof must cover **every** publishing path; asset presence alone must never be described as verified signatures, compatible binaries or successful prior tests. Unknown process contact must not justify deleting/replacing owned resources. Source defects get explicit characterization and intended-behavior regression tests during implementation, not silent deletion of capabilities or claims that the source already satisfies these invariants.

These are scoped acceptance decisions within open groups, not new denominator units. Audit remains approximately60% (7/12 accepted groups, medium-low confidence). Next: independently review remaining E2/E3/E1 reconciliations and new E4/E5 boundaries, then close groups only against the unchanged full obligations. Implementation remains **root Astra → Sol leads → approved workers** after full audit acceptance.
