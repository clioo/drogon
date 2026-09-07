# V2 settled-theme contrast evidence

Source: extended committed probe
`docs/migration/verticals/V2/probes/keyboard-focus-cdp.mjs` (section 7),
run against the real dev drogond + Electron build via CDP. Run: exit 0,
status PASSED, 43 checks (screenshots in gitignored
`.preflight/v2-kbd-1788787176689`, `contrast-light.png` / `contrast-dark.png`).

## Methodology (how the settled state was reached)

- For each theme, the settings store envelope was written explicitly
  (`drogon:settings:ui` = `{"settings":{"theme":"light"|"dark"}}`), the page
  reloaded, `emulateMedia` set to the matching OS scheme, and the state waited
  settled: `html.dark` present/absent as expected AND computed
  `--background` equal to the token value (`#fff` / `#0a0a0a`).
- Ratios are WCAG 2.x relative-luminance contrasts computed in-page from
  `getComputedStyle` used values (resolved rgb/rgba). Alpha sources are
  composited over the actually adjacent surface before the ratio (dark
  `--border` is `rgb(255 255 255 / 0.07)`).
- Surfaces measured where they render: body text over the canvas; muted text
  at `.sidebar-footer` (transparent, so over the canvas); primary button = the
  empty-state `New terminal` button (primary-foreground on primary); border =
  `.session-header` bottom hairline vs its adjacent canvas.
- Thresholds: AA 4.5:1 for text surfaces; 3.0:1 for non-text UI. Text
  surfaces gate the probe; the border verdict is recorded and reported, not
  gated (see conclusion).

## Ratios (observed probe output, settled pair only)

| Surface (anchor)                          | Light (settled)  | Dark (settled)   | Threshold | Verdict |
|-------------------------------------------|------------------|------------------|-----------|---------|
| Body text vs background (`body`)          | 19.80:1 AA-pass  | 18.97:1 AA-pass  | 4.5       | PASS both |
| Muted text vs background (`.sidebar-footer`, over canvas) | 4.74:1 AA-pass | 7.66:1 AA-pass | 4.5 | PASS both (light is close to the line: ~4.7) |
| Primary button text vs button bg (`New terminal`, primary) | 17.18:1 AA-pass | 14.23:1 AA-pass | 4.5 | PASS both |
| Border vs adjacent background (`.session-header` hairline) | 1.26:1 AA-fail | 1.15:1 AA-fail  | 3.0 (non-text UI) | FAIL both, recorded |

## Conclusion (settled pair only)

The settled light and settled dark themes pass AA for every text surface
measured: body, muted/secondary text and primary button labels are all above
4.5:1, with comfortable margins everywhere except muted text in light mode,
which sits near the threshold (~4.74:1) - acceptable, but it has no headroom
for any future muted-color lightening.

The 1px hairline borders fail the 3.0:1 non-text ratio in both themes
(1.26:1 light, 1.15:1 dark). These borders are decorative dividers in the
shell (no control is identifiable solely by its border, matching the
Lovecast-derived token design), so this is recorded as a design-token
characteristic rather than an accessibility defect; if any future surface
comes to depend on its border for identification, it will need a stronger
border or a non-border affordance.

Caveat: this report evaluates ONLY the two settled end states reached through
the explicit theme setting. Theme transition or intermediate colors (whatever
is painted while switching, under media-query changes, or during any animation)
are explicitly not evaluated and no claim is made about them.

## Follow-up A: header icon contrast (settled dark only)

Added to the probe's contrast section (same settled-dark flow): lucide glyphs
stroke with `currentColor`, so the icon foreground is the header button's
computed color (ghost variant, transparent over the canvas). Probe now GREEN
with 45 checks; the two prior runs' numbers are unchanged.

| Icon (anchor)                                  | Settled dark       | Threshold (non-text) | Verdict |
|------------------------------------------------|--------------------|----------------------|---------|
| Refresh connection (`.header-actions` button)  | 18.97:1 AA-pass    | 3.0                  | PASS (recorded, not gated) |
| Toggle session details (`.header-actions` button) | 18.97:1 AA-pass | 3.0                  | PASS (recorded, not gated) |

Neither glyph carries meaning alone - each button has an aria-label and a
tooltip - so per the task's gating rule nothing is gated; the 3.0 non-text
verdicts are recorded. ROOT's suspicion of low icon contrast in settled dark
is NOT confirmed: the icons render at full `--foreground` on the canvas
(18.97:1, identical to body text). Icon verdicts apply to the settled pair
only, same caveat as above.

## Follow-up B: files explorer/editor split + canvas sizing (PROPOSAL ONLY)

No implementation; names exact files and rules so the coordinator can split
work. No competing V3 edits were made or will be made from this task.

Frozen-source anchors (READ-ONLY, c9790628):
- `app-shell/AppWorkspaceShell.tsx:119,121,161,170` - split rows: root
  `flex flex-row flex-1 min-h-0 overflow-hidden`; left sidebar drag-resized
  (width persisted on mouseup); main column `flex flex-col flex-1 min-w-0
  min-h-0 overflow-hidden`; pane slot `relative flex flex-1 min-w-0 min-h-0
  overflow-hidden`.
- `components/right-sidebar/FileExplorer.tsx:206,259` - explorer column is
  shrink-0 with its own persisted width; tree viewport `relative min-h-0
  flex-1 overflow-hidden` (virtualized rows).
- `assets/main.css:157,271` - `--editor-surface` `#ffffff` / `#1e1e1e`
  (distinct from `--background`); `:1055-1075` - 36px editor header on
  editor-surface with border `color-mix(in srgb, var(--border) 72%,
  transparent)`; `:1178-1194` explorer row selected states; `:2105+` monaco
  chrome overrides.

Ours today: `features/workspaces/files-panel.tsx:375` STACKS
WorkspaceExplorer + notices + EditorPane with no split; the emitted classes
(`files-panel*`, `workspace-explorer*` in WorkspaceExplorer.tsx:229-355,
`editor-pane*` in EditorPane.tsx:406-459) have ZERO matching rules in our
main.css and no `--editor-surface` token exists.

V2-owned changes (apps/desktop/src/renderer/src/assets/main.css only):
1. Tokens: add `--editor-surface: #ffffff` to `:root` and `#1e1e1e` to the
   dark blocks, byte-for-byte from frozen `:157/:271`; expose as
   `--color-editor-surface` in `@theme inline`. No other new hex values.
2. Split: `.files-panel { display:flex; flex-direction:row; flex:1;
   min-width:0; min-height:0; }`; `.workspace-explorer { width:240px;
   flex-shrink:0; min-height:0; overflow:auto; border-right:1px solid
   color-mix(in srgb, var(--border) 72%, transparent); }` (240px reuses the
   existing `.workspace-sidebar` gutter scale).
3. Editor canvas: `.editor-pane { flex:1; min-width:0; min-height:0;
   display:flex; flex-direction:column; background:var(--editor-surface); }`;
   `.editor-pane-header { min-height:36px; flex-shrink:0; display:flex;
   align-items:center; gap:8px; padding:6px 14px; background:
   var(--editor-surface); border-bottom:1px solid color-mix(in srgb,
   var(--border) 72%, transparent); }` with `.editor-pane-header .path {
   min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }`.
4. Narrow fallback at the existing 1100px inspector breakpoint:
   `.files-panel { flex-direction:column; }` and `.workspace-explorer {
   width:auto; max-height:40%; border-right:0; border-bottom:1px solid
   color-mix(in srgb, var(--border) 72%, transparent); }`.
5. Explorer rows: selected/hover on `.workspace-explorer-row` using existing
   `--accent`/`--sidebar-accent` tokens (mirrors frozen `[data-file-explorer-
   row][data-selected]` pattern; no new tokens).

V3-component-owned (NOT V2 files; listed for the coordinator to split):
1. Drag-resize + persisted explorer width: belongs in
   `features/workspaces/files-panel.tsx` (frozen pattern persists on mouseup);
   V2 CSS only fixes the 240px default above.
2. Tree virtualization: frozen tree virtualizes
   (`FileExplorerFilesTreePane`); with our `MAX_DIRECTORY_ENTRIES` (1,000)
   cap it may be unnecessary - a V3 decision. The CSS `min-h-0` chain above
   is the only prerequisite V2 owes.
3. `editor-pane-unread`/`editor-pane-dirty` badge styling: V3 already emits
   the hooks; their content/colors are V3's call using existing
   destructive/accent tokens.
4. Monaco chrome (frozen `main.css:2105+` font/scrollbar overrides) becomes
   relevant only if V3 swaps EditorPane's surface for Monaco; port is
   coordinated then, owned by the V2 CSS side at that point.

