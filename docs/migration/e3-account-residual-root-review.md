# Account residual source review

Root accepts the finite **AL-SR02/03/04** source characterization, with the qualifications below. This does not close E3/E5 or claim candidate parity. The [machine record](e3-account-residual-root-review.json) carries exact evidence and test receipts.

Independent verification matched **35 source ranges / 33 pinned files**, nine contracts, 27 hashed input/allocation pointers and twelve reused-contract references. All **9037 original file allocations / 46 packages** remain unchanged. The candidate provides ten new assertion groups and seven additive test obligations; its inherited “thirteen” wording refers to the prior account report.

Root read all nine candidate contracts and independently checked their important owning bodies, including parser/section transforms, shell hints, constructor migrations, native/WSL bridge entrypoints and backfill/marker/audit producers. This is an independent source review, not execution of every referenced original assertion.

## Qualifications retained for implementation

- **Date order/dedup is conditional:** the existing-baseline merge sorts and deduplicates, but direct no-baseline requested roots are only filtered/mapped. AR-C05's blanket wording is qualified; test both paths under AR-T03/04.
- **Trust parsing:** multiline data can match the raw trust regex; untrusted project blocks survive ordinary-setting extraction despite its comment. Unicode decoding differs between project headers and values. Characterize these separately from intended corrections.
- **Partial effects:** a launch does not await all history work; unsupported links can coexist with a completion marker. Credential/history writes can precede later failures; the pointer replacement fallback can lose its prior link. No transaction, indexing/resume, fsync or cross-process guarantee is inferred.
- **Shell hints:** static cached parsing is not actual shell evaluation. Preserve the complete original suite and add real-shell comparisons for precedence, conditionals, unset/empty values and cache changes.
- **Source reuse:** account bridge characterization does not accept the whole integrations report. The separate95-method GitHub/GitLab/Jira correction remains pending. Raw-provider AL-SR01 is handled by the separate provider review.

## Executed baseline

The entire unchanged original shell-startup environment suite passed **50/50**, zero failures/skips/todo, in a fresh source-derived capsule using Node24.19.0 and original Vitest4.1.11. Root reopened every assertion result and rehashed both staged source files plus LICENSE. Original filesystem mocks and simulated platforms remain explicit; no personal startup files, credentials, live shell or provider were accessed. This is not rewritten-product GREEN. Config differences and exact command inputs are preserved in [the manifest](../../tests/parity/baseline-capsules/shell-startup-env.json).

Audit remains **10/12 =83.3%, delta0, medium-low confidence**. Next: provider/runtime source join and the integration correction, then whole E3/E5 reconciliation. Flexible24-hour risk remains high with no defensible ETA. Actual Sol implementation still follows full audit acceptance.
