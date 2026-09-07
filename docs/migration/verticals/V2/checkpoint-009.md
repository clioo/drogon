# V2 checkpoint-009: V3 UI assembly + hidden files mount in App

Vertical / scope / base SHA / head SHA / branch / worktree:
V2 desktop/settings; mechanical V3 UI assembly + contract mount
wiring (capability-hidden). Base 23a961c; head this commit; branch
codex/vertical-02-desktop-settings; worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-02-desktop-settings.

Capabilities and original contract/test IDs:
ROOT-directed V3 mount integration (stable cbe54ad; parents
ff327a5+b1c3dc7 excluded; known V3 save/scope bugs NOT duplicated).
Handoff row "Rutas y paneles" + INT-PROVIDER-UI (V2 side only).
ROOT files contract d5c6fd1 (FileBridge, files.v1, bridge typing).

Changed paths; shared-file patch requested:
features/workspaces+editor+remote+browser (24 files, NEW): exact
committed blobs from cbe54ad tree (includes parent-committed
WorkspaceExplorer, editor/index, remote tree required by the
stable files-panel import; zero V2 modifications, zero core-parent
content, zero author WIP). Import audit: only features-internal +
shared/session-contract + shared/file-contract + react/lucide/ui.
files-mount.ts (M): binds REAL createFilesPanelDescriptor +
FILES_ROUTE_ID + isFilesAvailable from the V3 barrel; boundary
adapt + single registerFactoryRoute path kept; registerFilesRoute
now takes the bridge.
files-mount.test.ts (M): real-factory registration/gating +
renderToString null-session mount of the real FilesPanel; scaffold
label kept (stub vocabulary gone, still not service behavior).
App.tsx (M): Panels nav (Terminals/Files; Files disabled with
files.v1 reason while unadvertised), registry memo on static
vocabulary, MountedPanel with focus/cleanup contract, terminal UI
otherwise byte-identical behavior. No V3 file edits; no
shared-file edits; no patch requested.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Assembly: vitest 31 files/335 passed (227 + 108 V3), tsc clean.
Mount: files-mount 10/10 (incl. new boundary tests GREEN first
run - honest note, no RED observed for the new asserts; factory
throw path covered by contract tests). Combined full suite rerun
at commit time (see push). CDP probe: hidden-files-mount-
stays-disabled-with-reason PASS (Files disabled, no Files
section, 2 terminal tabs intact) + all prior checks green,
sessions exact-cleaned, shutdown admitted, exits clean.

Integrated/rendered/platform evidence; exact package identity if applicable:
Real drogond + dev Electron CDP, darwin; shots .preflight/
(gitignored). files.v1 NOT advertised by dev daemon (verified 9
caps, no files.*): available-path panel behavior awaits
advertisement; SSR mount test covers null-session render meanwhile.

Unverified, missing, source defects, deliberate approved deltas:
V3 known bugs (save request-ID reuse, stale scope) NOT fixed here
(V3 owner); mount does not exercise save paths. Available-path
live listing/scope-switch awaits files.v1 advertisement + V3
corrections. No deliberate deltas.

Dependencies requested; next bounded checkpoint:
Dash-map evidence (dash-map.md, committed here): chosen slice A
feature-tip gate may belong to WP-UI-AUX (V4) per cards - asking
ROOT whether V2 implements or transfers before dispatching.

Owned processes: session/incarnation/host, settlement/release receipts:
Mount work done by leader (ROOT-directed mechanical integration,
no leaf). Dash-map GLM ctx_a5e122ad8f86 accepted, release
retained (leader terminal). Probe processes clean, no strays. No
active leaves; GLM terminal retained live.

Rollback; data/credentials/privacy check:
git revert (assembly commit 5d9bcd8 separate from mount commit).
Fixture /tmp only. No credentials, no real user data.

Ready for independent review: yes (not self-accepted).
