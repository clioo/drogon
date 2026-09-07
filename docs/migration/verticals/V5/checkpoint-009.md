# V5 checkpoint 009 — offline sweep receipts + release/notice gate analysis

Vertical / scope / base SHA / head SHA / branch / worktree:
V5 platform/release. Scope: bounded offline sweep receipts (packaging
lane + renderer contracts/typecheck) and the requested release/notice
gate analysis. Base 596ddbd9e8b6fdc5d5fa26616479e910b34ba604. Head: this
commit. Branch codex/vertical-05-platform-release. Worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-05-platform-release.

Capabilities and original contract/test IDs:
WP-ENG-INSTALL / WP-SUP-SCRIPTS (runners), WP-SUP-CI (evidence),
WP-ENG-NATIVE (Windows runner, unchanged), E5 AO set (decisions only).
No paid harness; no full cargo/desktop sweep (ROOT running combined).

Changed paths; shared-file patch requested:
New: docs/migration/verticals/V5/offline-sweep-receipts.md (leaf N) +
this checkpoint. No shared-file patch. No production/test edits.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Run-only sweep on clean tree at f9b7d29 (leaf-observed, receipt file):
packaging 8-file lane under Node24 → exit 0, 70/70 pass; renderer
contracts via resolved vitest command → exit 0, 10 files / 72 tests pass;
renderer typecheck → exit 0, 0 errors. Env finding (no fix): pnpm absent
from PATH (exit 127), underlying commands run directly; renderer lanes
ran under system node v26.8.1, recorded verbatim.

Release/notice gate analysis (leader assessment, no new execution):
1. No currently-FAILING gate in owned packaging code on this seed — all
   executed lanes green. The open gate is ABSENT, not red: NR-1, no
   byte-level inspection of the notices actually shipped inside a built
   bundle (generator output vs shipped bytes uncompared).
2. Exact missing external decisions: E5 AO-RIGHTS/AO-RECORDINGS/AO-NOTICES/
   AO-SERVICE (Carlos); V1 Windows daemon/DACL implementation (in
   progress, relayed); ROOT package:desktop output to inspect; authorized
   harness execution window; PR15 merge order.
3. Proposed ROOT final-bundle acceptance command (proposal only): after
   `pnpm package:desktop` on the integrated head, run a notices-diff gate
   comparing the shipped THIRD_PARTY_NOTICES file byte-for-byte against
   the accepted evidence set (4 npm packages, Geist, Nerd aggregate
   accounting, Font Logos Unlicense + brand warning, Seti dual notices,
   Codicons CC-BY modification record, docs-Lucide wording), failing
   closed on any delta; exact verifier implementation is ROOT-owned.

Integrated/rendered/platform evidence; exact package identity if applicable:
None new. 83e9eca untouched. No partial-vertical install.

Unverified, missing, source defects, deliberate approved deltas:
Windows real-pipe behavior unverified (CI leg pending ROOT patch apply).
Renderer lanes ran under node 26, not the declared Node24 era — recorded,
not claimed equivalent.

Dependencies requested; next bounded checkpoint:
None (pnpm absence reported, not fixed — environment-owned). Next: harness
receipts on ROOT window; Windows CI leg; combined-head acceptance.

Owned processes: session/incarnation/host, settlement/release receipts:
Child Run run_3de36bede2a3. Leaf N task_79152da5f7de/ctx_b9bf7e14f280
depth 2 completed, terminal term_b8dad58b retained idle reusable. Zero
active leaves.

Rollback; data/credentials/privacy check:
Rollback: revert these commits (docs only). No data, credentials,
sessions, installs, provisioning, or publishing touched. Services and
user data untouched.

Ready for independent review: yes (not self-accepted).
