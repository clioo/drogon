# V5 checkpoint 001 — Windows seam spec + acceptance/E5 decision prep (doc-first)

Vertical / scope / base SHA / head SHA / branch / worktree:
V5 platform/release. Scope: (A) native Windows transport/auth/same-user/
lifecycle seam spec + real platform test plan; (B) per-vertical/combined
acceptance inventory + E5 notice/resource/service decision prep. Base
596ddbd9e8b6fdc5d5fa26616479e910b34ba604. Head: this commit (see log).
Branch codex/vertical-05-platform-release. Worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-05-platform-release.

Capabilities and original contract/test IDs:
WP-ENG-NATIVE (seam/transport surface), WP-ENG-INSTALL / WP-SUP-SCRIPTS
(acceptance/packaging runners), WP-ENG-RUNTIME package-admission exception
(sealed-bundle identity), E5 AO-RIGHTS/AO-RECORDINGS/AO-NOTICES/AO-SERVICE
(decision prep only, no closure). Source refs: unix-socket-transport,
runtime-rpc-socket-metadata, request-admission, win32-utils,
daemon-endpoint-ownership (+windows test), windows-edr-posture,
wsl-probe-failure-semantics, verify-linux-glibc-floor, all read-only at
c97906287bb7a390b25e2025b600d9fb3c25d9c3, never executed.

Changed paths; shared-file patch requested:
New: docs/migration/verticals/V5/windows-transport-seam-plan.md (leaf A,
Sonnet 5 high) + leader review correction; docs/migration/verticals/V5/
acceptance-e5-decision-prep.md (leaf B, GLM-5.3-Flash smoke-verified);
docs/migration/verticals/V5/checkpoint-001.md (this file). No other files
touched; no Cargo/JS manifests, lockfiles, protocol, registries, or .github
edits. Shared requests (proposals only): (1) V1 contract — confirm Windows
drogond pipe-name wire contract + same-user protection (DACL vs token-only),
Windows error-code mapping for observeLocalEndpoint absent/ambiguous, joint
lifting of win32 unsupported gates, real-named-pipe fixture test; (2) ROOT CI
— windows-compilation job runs cargo check only; propose setup-node +
desktop vitest step once V1 answers, no edit made here.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Doc-first checkpoint: no product code changed, so no behavioral RED/GREEN
pair applies. Evidence: source-baseline reads (above) + executed existing
suites from this worktree as cwd. Leader-observed: apps/desktop vitest
src/main/native-runtime-bootstrap.test.ts 24/24 pass (939ms);
src/main/native-client.test.ts + src/main/daemon-path.test.ts 17/17 pass;
Node24 node --test tests/parity/ports/WP-ENG-RUNTIME/package-admission/
sealed-bundle-identity.test.mjs 15/15 pass, exit 0, tree clean after.
Leaf B's run independently re-observed by leader (15/15, 130ms).

Integrated/rendered/platform evidence; exact package identity if applicable:
None new. Existing sealed package 83e9eca untouched/accepted; no partial
vertical installed. POSIX fixture tests run on darwin host; Windows
named-pipe behavior unverified (no Windows runner executes TS tests).

Unverified, missing, source defects, deliberate approved deltas:
Windows transport/auth/same-user/lifecycle unverified, not waived. Final
packaged notices unproven (generator uses live pnpm/cargo state; no bundle
inspection yet). Nerd aggregate must keep multi-license accounting, never
blanket MIT (retained). daemon-path.ts empty Windows fallback list
unverified. observeLocalEndpoint Windows error mapping unknown (V1 item).
Deliberate delta: leader corrected leaf A's false "no local vitest"
claim in-place with attribution (apps/desktop vitest exists, 24/24 local).

Dependencies requested; next bounded checkpoint:
None (deps present: desktop vitest, Node24 cache path). Next: after V1
answers §2 contract, bounded RED fixture test for pipe error mapping
(POSIX-first) + rerun combined test:packaging lane baseline (8 files).

Owned processes: session/incarnation/host, settlement/release receipts:
Child Run run_3de36bede2a3. Leaf A task_2496a5ca2793/ctx_8b6dd6833d63
depth 2 completed 11:09:06Z, released (transcript archived). Leaf B
task_489ae5641b33/ctx_bca3c83486d5 depth 2 completed 11:10:24Z, terminal
term_b8dad58b retained (external_terminal, no process action taken per
retention rule; idle, reusable). No other processes owned.

Rollback; data/credentials/privacy check:
Rollback: revert this commit (docs only). No data, credentials, telemetry,
or user sessions touched. No installs, provisioning, publishing, or
real-data submission. Source reference unmodified.

Ready for independent review: yes (not self-accepted).
