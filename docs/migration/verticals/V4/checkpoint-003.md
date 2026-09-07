# V4 checkpoint-003: styled panel + descriptor factory (narrow style checkpoint)

Vertical / scope / base SHA / head SHA / branch / worktree:
V4 Capabilities on codex/vertical-04-capabilities, worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-04-capabilities.
Follows checkpoint-002 (32d69f4, PR #13). NARROW style scope only: B3
liveness honesty, B4 PanelDescriptor factory, B5 token/primitive styling.
History (A5, incl. P2-1 fence) and B2R catalog bind ride separately;
this checkpoint batches no history implementation.

Capabilities and original contract/test IDs:
WP-UI-AUX/WP-UI-AUTO (BotsPanel export for V2 mount). Source pin
c97906287bb7a390b25e2025b600d9fb3c25d9c3 (STYLEGUIDE read read-only;
reference HEAD verified == pin, so content is pin-identical).

Changed paths; shared-file patch requested:
- apps/desktop/src/renderer/src/features/bots/BotsPanel.tsx (B3 liveness
  fix + B5 token/primitive restyle)
- bots-panel-projection.ts (session-linked wording + injected observed
  liveness projection; B5 class recipe)
- BotsPanel.contract.test.ts (16 -> 26 pins: stale-session, hex-guard,
  token/primitive assertions; no weakened assertions)
- bots-panel-contracts.ts: UNTOUCHED (DTO contract frozen pending ROOT
  bab4cdf relocation; style leaf never edited it)
- index.ts: UNTOUCHED since B4 (factory export surface stable)
- bots-panel-descriptor.ts + .contract.test.ts (B4: structural factory,
  no registerRoute/mount)
- EVIDENCE.md (RED/GREEN runs, style provenance, V2-mount seam proposal)
No shared files touched. No patch requested in this checkpoint (ROOT owns
DTO move bab4cdf, bridge 28c1c10, mount).

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
B3: RED 4 fail/12 pass on old impl -> GREEN 16/16.
B4: RED-1 absent (preparation), RED-2 stub 7 fail (behavioral) -> GREEN
7/7; bots 23/23 at the time.
B5: RED 2 fail/24 pass on token/primitive assertions -> GREEN 26/26.
Leader re-ran each stage: final desktop suite 16 files 140/140,
tsc --noEmit exit 0, prettier clean (per EVIDENCE.md), zero hardcoded hex
(grep-verified), no sessionActive/session-active inference, no Create
control, factory imports react+siblings only.

Integrated/rendered/platform evidence; exact package identity if applicable:
None (unmounted export; mount after ROOT acceptance/bridge). Factory
surface for V2 relay (stable, actual tree shape, NOT a paraphrase):
createBotsPanelDescriptor({routeId,title,panel:BotsPanelProps,
capability?,restoreState?,onFocus?,onCleanup?}) + BotsPanel, snapshot/
props/row types, projection helpers, SESSION_LINKED_LABEL — all from
features/bots/index.ts. Adapts c5fea1d structurally without importing it
(contract lives on codex/vertical-integration, not at this HEAD).

Unverified, missing, source defects, deliberate approved deltas:
Card primitive absent (recorded V2-owned request, no parallel kit built);
factory unmounted (by design); style-guide blob absent from this
worktree's object store (read pin-identical from reference HEAD==pin).

Dependencies requested; next bounded checkpoint:
None for style. Await ROOT bridge/mount direction; A5 history + B2R bind
form checkpoint-004.

Owned processes: session/incarnation/host, settlement/release receipts:
Run run_5040a80fa6dd. B3 ctx_00d85854de13, B4 ctx_b3629e3dc39d, B5
ctx_069b495d1e4d: all worker_done accepted after independent reruns,
all retained-external (shared GLM terminal term_f31e5209, live-idle).
A5 history (Sonnet ctx_eaf76d192a53, incl. P2-1) active — untouched by
this checkpoint. All dispatches depth 2.

Rollback; data/credentials/privacy check:
Revert this commit to return to 32d69f4. No credentials, network, mic,
recordings, real accounts, or source writes.

Ready for independent review: yes (not self-accepted).
