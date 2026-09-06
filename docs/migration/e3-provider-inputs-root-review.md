# E3 raw-provider inputs — root review

Root accepts the **thirteen finite provider-input source contracts**, with the qualifications below. This does not close E3/E5, prove provider operation, or accept rewritten behavior. Source pin: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. The frozen candidate remains unchanged; exact hashes, command and receipts are in [the machine-readable review](e3-provider-inputs-root-review.json).

## Independent checks

- All81 checked-in source/assertion files and82 inclusive ranges match both current bytes and the named Git revision; nine frozen input-document hashes match.
- All13 contract pointers and15 test-body associations resolve, including exact test path/digest membership. The original allocation,47 inherited gates and execution obligations equal prior final-local evidence. All9037 original test-file allocations/46 packages remain.
- Root read the complete candidate narrative and all13 contract bodies, findings and joins; independently read13 complete source/test files and the retry-metadata conversion range. This is not a claim root personally reread every one of81 files.
- The first mechanical checker incorrectly expected package file strings. Actual package records contain path/digest/domain; the corrected checker verified both path and digest. No allocation was changed to make the check pass.

## Qualifications that govern implementation

1. **Retry duration versus timestamp:** raw `OAuthUsageError.retryAfterMs` is a duration or **null**, capped at24h. Only the later recovery/result layer computes `usageMetadata.retryAtMs = Date.now() + duration`, or undefined. Preserve both layers; the candidate shorthand must not become a wrong raw error schema.
2. **Classifier versus mapper:** classification returns original window objects without percentage clamping. The original14-case suite explicitly preserves values above100. Mapping/clamping and reset/credit handling are separate contracts, not proved by this classifier baseline.
3. **Cookie races:** MiniMax's parallel setup can leave a late cookie write after failure cleanup. OpenCode's sequential setup prevents that intra-call race, not interference between simultaneous calls sharing a partition. These are source inferences, not executed race demonstrations. MiniMax's inspected helper has no explicit proxy-setup call.
4. **OAuth partial effects:** Gemini can drop returned refresh-token rotation; its own credentials use a PID temp filename and rename without a private-mode/lock/durability guarantee. Claude's inactive refresh can use a token despite failed persistence. Preserve source characterization separately from intended correction tests.
5. **Managed preview:** similarity is required for Keychain locations, not all file locations, and compares shared session/weekly percentages rather than identity or reset timestamps. A supplement can then persist captured credentials. No real account or native store was accessed.

## Original baseline evidence

| Unchanged whole suite | Passed | Evidence boundary |
| --- | ---: | --- |
| Claude OAuth usage error | 5/5 | Synthetic Response/error/Retry-After fields; no request or active-cycle scheduling |
| Codex rate-window classification | 14/14 | Percentage projection of chosen windows; no complete mapper/RPC/credit result |

Both ran with original installed Vitest4.1.11 and Node24.19.0 in fresh retained capsules, zero failed/skipped. Root reopened results and receipts and checked all assertion statuses, four staged source hashes and both MIT license copies. Exact commands and digests are in JSON. Minimal runner config differences are disclosed in each manifest; this is not full-suite or candidate parity. No credentials, provider requests, Electron native operations, inference, installs or source-tree writes occurred.

## Remaining work and lifecycle

The provider Dispatch was officially released after its formal delivery. Integrations and account launch also delivered and were released, retaining external terminals without process actions; their source reports await root review. Publication/provenance is the only remaining active audit Task.

Account preparation is now a delivered dependency, not an unread provider-local body to rediscover. Runtime/hook/native and actual request-guard/login-registration joins remain root consolidation work; names alone do not establish coverage. Retain all declared defects, source baselines, faithful ports, behavioral RED–GREEN, mixed-version/folder/SSH and native execution obligations.

Audit remains **10/12=83.3%, delta0, medium-low confidence**. Next milestone is complete E3/E5 source acceptance; the flexible24-hour goal remains high risk with no defensible ETA. Actual Sol implementation leads and workers remain gated. No preview replacement is warranted by this audit-only checkpoint.
