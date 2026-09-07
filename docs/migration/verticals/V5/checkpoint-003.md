# V5 checkpoint 003 — ROOT corrections executed: pipe runner + seal/DACL fixes

Vertical / scope / base SHA / head SHA / branch / worktree:
V5 platform/release. Scope: (D) isolated Windows named-pipe runner/tests
+ exact CI patch text; (E) ROOT-directed corrections to checkpoint-001/002
docs (current seal, 191 notices, DACL, obscurity, in-repo protections).
Base 596ddbd9e8b6fdc5d5fa26616479e910b34ba604. Head: this commit. Branch
codex/vertical-05-platform-release. Worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-05-platform-release.

Capabilities and original contract/test IDs:
WP-ENG-NATIVE (Windows transport seam, infrastructure-only), WP-ENG-INSTALL
/ WP-SUP-SCRIPTS (runners), WP-ENG-RUNTIME package-admission (unchanged).
V1 answer relayed via ROOT and applied as constraints; V1 retains
production transport/client; V5 touched no production files.

Changed paths; shared-file patch requested:
New: scripts/windows-native-transport.mjs, scripts/windows-native-transport.
test.mjs (leaf D, Sonnet); docs/migration/verticals/V5/
foundation-windows-vitest.patch (leaf-D deliverable, preserved verbatim,
leader-verified `git apply --check` clean: 9 insertions, 1 file).
Modified: docs/migration/verticals/V5/windows-transport-seam-plan.md and
acceptance-e5-decision-prep.md (leaf E, GLM: 93 insertions, 22 deletions).
New: this checkpoint file. Shared request for ROOT (proposal only, .github
untouched): apply foundation-windows-vitest.patch (setup-node 24 +
pnpm install + desktop vitest step on windows-compilation) when V1-adjacent
timing is right. Minimal V1 contract already sent via ROOT; V1 answered
(deterministic drogon-v1-24hex name confirmed, same-user absent, gates
retained, runner infrastructure-only, no canonical-pipe takeover).

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
RED = suite+runner nonexistent before this block. Leader-observed GREEN
(this worktree, Node24 v24.19.0): node --test
scripts/windows-native-transport.test.mjs → tests 17 / pass 13 / fail 0 /
skipped 4 (win32-only, honest reason) / exit 0; node
scripts/windows-native-transport.mjs → {verdict: unverified, platform:
darwin} exit 0 (skip path, no pass claim); tree clean after (tmpdir-only,
no leaked handles asserted in-probe). Mirror fidelity spot-checked by
leader against native-client.ts (:10 MAX_FRAME_BYTES, :33 validateEnvelope,
:69-76 pipe formula, :339-347 precheck). Real win32 execution only on CI;
win32 path is code-reviewed, never claimed green.

Integrated/rendered/platform evidence; exact package identity if applicable:
None new. 83e9eca untouched. Current seal 83e9eca 293/309,447,135 and 191
generated/inspected notices now stated correctly in docs (old 293/
307,543,311 belongs to ebbeb58c).

Unverified, missing, source defects, deliberate approved deltas:
Windows real-pipe behavior unverified, not waived (4 skips). Windows
error-code mapping for absent/ambiguous still open (V1 item; runner will
report fail honestly if mapping differs). Harness lanes still lack seed
receipts. NR-1/NR-2/NR-3 named residuals recorded. No doc-only inventory
waves continue.

Dependencies requested; next bounded checkpoint:
None. Next: CI win32 leg result once ROOT applies patch; authorized
harness receipts; E5 decisions via ROOT/Carlos.

Owned processes: session/incarnation/host, settlement/release receipts:
Child Run run_3de36bede2a3. Leaf D task_f95e532d3290/ctx_965f69093658
depth 2 completed, released (transcript archived). Leaf E task_f32863bf2e33/
ctx_8c45a8b0550a depth 2 completed, terminal term_b8dad58b retained
(external, idle, reusable). Zero active leaves.

Rollback; data/credentials/privacy check:
Rollback: revert this commit (2 new scripts + 1 patch + 2 doc fixes +
checkpoint). No data, credentials, models, sessions, installs,
provisioning, or publishing touched. Canonical production pipe never
probed.

Ready for independent review: yes (not self-accepted).
