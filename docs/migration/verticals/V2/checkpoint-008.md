# V2 checkpoint-008: files-mount adapter (V3 seam mirrored, not imported)

Vertical / scope / base SHA / head SHA / branch / worktree:
V2 desktop/settings; V3 files-panel mount adapter against real
bridge types with stub-component tests. Base 726cf8f; head this
commit; branch codex/vertical-02-desktop-settings; worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-02-desktop-settings.

Capabilities and original contract/test IDs:
ROOT-relayed V3 seam (files-panel.tsx barrel, FILES_ROUTE_ID
files.explorer, createFilesPanelDescriptor({bridge}),
isFilesAvailable). Handoff row "Rutas y paneles". ROOT files
contract d5c6fd1 (FileBridge, FILES_CAPABILITY files.v1).

Changed paths; shared-file patch requested:
apps/desktop/src/renderer/src/files-mount.ts (new, 57 lines):
FILES_ROUTE_ID via routeId('files.explorer'),
isFilesAvailable (iff includes FILES_CAPABILITY),
FilesPanelFactory seam type, registerFilesRoute(registry,
component). Header documents one-import swap to the real V3
factory + App.tsx wiring once the V3 commit is stable.
apps/desktop/src/renderer/src/files-mount.test.ts (new, 7 tests).
No V3 imports, App.tsx untouched, no shared-file edits; no patch
requested (handoff-patch request for barrel-name stability already
sent to ROOT).

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
files-mount.test.ts 7/7 failing on no-behavior stub (behavioral
RED) -> 7/7 GREEN. Combined (apps/desktop, Node24): vitest run ->
22 files, 227 tests passed, exit 0; tsc --noEmit -> exit 0.

Integrated/rendered/platform evidence; exact package identity if applicable:
Unit + typecheck. Real V3 import + App mount + CDP gated panel
proof wait for stable V3 commit and files.v1 advertisement.
darwin dev. No packaging.

Unverified, missing, source defects, deliberate approved deltas:
V3 factory corrections (write-ID uniqueness, read guards, stale
fence) are V3/ROOT-owned; V2 mounts only the stabilized factory.
No deliberate deltas.

Dependencies requested; next bounded checkpoint:
Stable V3 commit relay (ROOT). Next independent: empty-state/
onboarding polish.

Owned processes: session/incarnation/host, settlement/release receipts:
Mount GLM ctx_7e66ed26c54f accepted/inspected/re-verified,
release retained (leader terminal). No probe processes. No active
leaves; GLM terminal retained live.

Rollback; data/credentials/privacy check:
git revert of this checkpoint commit. No storage touched. No
credentials, no real user data.

Ready for independent review: yes (not self-accepted).
