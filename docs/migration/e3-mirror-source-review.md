# E3 mirror source joins — root review

2026-09-06. Root accepts the six immediate mirror contracts identified by the three `CIF-LOCAL-DOMAIN-LIMIT` anchor families. This closes those named source joins, **not E3 or rendered product parity**. Source pin `c97906287bb7a390b25e2025b600d9fb3c25d9c3`; exact read ranges, hashes and execution evidence are in `e3-mirror-source-review.json`.

Root read the six named modules completely plus the recorded supporting bodies/ranges: 23 records across22 distinct source/test files, all checked against the pinned Git bytes. This is bounded contract review, not a recursive audit of every dependency. Existing owner contracts and complete original tests remain authoritative for their internals.

## Contracts that implementation must preserve

- **Terminal identity and metadata:** group by host parent tab; pending bindings survive only under the same environment. Requested/local active leaf takes precedence over stale host-active metadata. Client color, pin, view mode and generated/custom titles survive host echo; omitted host launchAgent/startupCwd is not resurrected from old state. Pi-compatible labels follow launch/hook ownership rather than overwriting identity with the wrapper's brand.
- **Layout:** use a covering host tree, then covering prior tree, then explicit empty/single/horizontal fallback. Duplicate PTY bindings coalesce onto the selected owner with paired buffer/scrollback provenance; the normalizer is not a general layout validator. Host split direction and user focus must survive valid snapshots.
- **Browser/editor:** remote-page reuse is owner-qualified. Exact local browser-host identity preserves locally observed content over stale host metadata; staged client placement can preserve a split group. Editor previews retain their distinct source-path identity. Terminal, browser, editor and agent rows have different metadata precedence; do not flatten them into one generic merge.
- **Agent status:** local receipt time controls remote freshness; repeat observations do not renew that time. Ownership requires a registered pane and a client status write. A missing host status preserves client-owned rows; missing contact does not imply process death. Completion, attention and sorting epochs update on their actual source predicates.
- **Retraction:** lift stale closed markers when a mirror returns. Retraction uses the post-removal tab list, preserves user activity cutoffs and updates batch indexes. Computing a retirement patch has registry side effects even if the caller discards it; this is neither pure computation nor complete closeTab cleanup.

## Qualifications and regression cases

1. The original layout test titled “never invents a split direction” only asserts the synthesis callback. Source actually builds a horizontal fallback chain. Its green result is not proof that fallback never changes direction. Preserve valid-tree fidelity and test missing-tree behavior explicitly.
2. `agentStatusEntryEqual` omits observation/receipt fields. A receipt-only change can therefore be discarded if all compared fields remain equal. This is source-inferred, not an executed defect here; the existing clock-skew test also changes `updatedAt` and does not isolate it.
3. Host blocked/interactive state bypasses the client-ownership condition, but the separate `existing.updatedAt > entry.updatedAt` branch can still select client state. Test clock skew and permission visibility; do not claim universal host override from the comment.
4. Browser content preservation checks exact client identity, while `loadError` preservation checks any client placement. Preserve and characterize the distinction before deciding whether it needs correction.
5. Leaf coverage compares sets, not duplicate multiplicity or cycle validity. Typed inputs are not runtime schema validation. Retirement does not prove native teardown, and its narrower map sweep must not be advertised as full closeTab parity.

## Original baseline executed

The entire unchanged `src/renderer/src/runtime/remote-terminal-layout-resolution.test.ts` passed **10/10**, zero failures/skips/todos, using original Vitest4.1.11 and Node24.19.0 on macOS arm64. The pure source implementation runs in an isolated capsule; no renderer store, Electron, PTY, provider or network operation is involved. The original five-case clock-skew test was read in full, not executed.

- Manifest: `tests/parity/baseline-capsules/remote-terminal-layout-resolution.json`, SHA256 `2209f474498e2a1bad3c8d9283886a8e621d38be2a3c92d467438d7d4e9b0471`.
- Capsule: `.preflight/parity-baseline/remote-terminal-layout-resolution-xwh7KG`.
- Stage receipt SHA256: `b0d0c1e87b4b493afc096b21a310261a969c20bf60da8fedc4eedaf930021a12`.
- Result SHA256: `b2ea05a7e06ced787c0386b29eb9c333d01fe4ab971117d5493a0ef6130fa998`.
- Root reopened all10 assertion results and rechecked the three staged files plus MIT license; all four fingerprints remain unchanged.

The initial manifest used an unsupported `type-only` role and was refused before execution. Correcting that metadata to the runner's `module` role is a setup correction, **not behavioral RED**. The type import is erased, not typechecked. No candidate implementation was changed or tested; all9,037 original allocations and inherited execution gates remain.

## Next acceptance

E3 still requires the independently assigned runtime/integration/platform result-source closures; the three mirror anchor families need no further census. Original whole suites, candidate behavioral RED→GREEN, rendered UI, platform/SSH, recovery and installed-product fidelity remain execution gates.

E5 delivered its final candidate at09:58:31 UTC and was officially released with receipt `4f0a0f51-154f-490a-bb9b-93487bddf470`: retained/external_terminal/processAction none, not an exited-process claim. Root review of E5 remains pending. Three other Astra leads continue audit work. Overall audit remains10/12=83.3%, medium-low confidence, delta0; actual Sol implementation starts only after complete source-audit acceptance.
