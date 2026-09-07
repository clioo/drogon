# V2 checkpoint-010: keep-alive mount (draft-safe) + real focus

Vertical / scope / base SHA / head SHA / branch / worktree:
V2 desktop/settings; mount-lifetime + focus corrections per ROOT
mount review. Base 002f7ca; head this commit; branch
codex/vertical-02-desktop-settings; worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-02-desktop-settings.

Capabilities and original contract/test IDs:
ROOT mount review (draft loss, focus target, CSS-layout direction
ACKed). Handoff row "Rutas y paneles". Editor logic untouched
(V3-owned); no localStorage draft persistence (plaintext ban).

Changed paths; shared-file patch requested:
apps/desktop/src/renderer/src/App.tsx (M): keep-alive mount -
panel stays mounted (display:none) across route switches and
transient refresh gaps; first mount needs explicit user routing;
unmount only on settled capability loss or workspace loss; last-good
workspace/status props bridge transients; terminal column likewise
stays mounted (xterm state preserved); real focus via section
container (tabIndex -1) only on explicit navigation transitions,
never on background refresh; MountedPanel keeps focus/cleanup
contract calls. No shared-file edits; no patch requested.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Leader-implemented integration correction (no leaf; no invented
RED claimed): vitest 31 files/335 passed, exit 0; tsc --noEmit
exit 0. CDP probe: all 17 checks PASS incl. hidden-mount,
exact session cleanup, shutdown fence, clean exits.

Integrated/rendered/platform evidence; exact package identity if applicable:
Real drogond + dev Electron CDP, darwin; shots .preflight/
(gitignored). files.v1 still unadvertised: available-path draft
survival across switches/transients is structural (mount
lifetime), proven live when advertisement lands.

Unverified, missing, source defects, deliberate approved deltas:
Descriptor-owned lifted draft state needs V3 editor-logic
coordination (reducer hoisting); V2 keep-alive covers navigation
+ transient loss meanwhile. True capability loss with dirty drafts
is accepted residual (documented). CSS-layout lane ACKed over
feature-tip slice A (WP-UI-AUX question moot). No deliberate
deltas.

Dependencies requested; next bounded checkpoint:
V3 corrections + files.v1 advertisement (ROOT relay). Next
independent: shell CSS layout breadth per ROOT direction.

Owned processes: session/incarnation/host, settlement/release receipts:
No leaves active (all settled/released); GLM terminal retained
live, no active dispatch. Probe processes clean, no strays.

Rollback; data/credentials/privacy check:
git revert of this checkpoint commit. Fixture /tmp only. No
credentials, no real user data.

Ready for independent review: yes (not self-accepted).
