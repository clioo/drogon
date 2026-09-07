# V2 checkpoint-015 — Files-split V2 CSS implemented (proposal Follow-up B)

- Implemented the V2-owned half of the reviewed Files-split proposal in
  `apps/desktop/src/renderer/src/assets/main.css` (+61): `--editor-surface`
  tokens byte-identical to frozen anchors (#ffffff light / #1e1e1e dark, all
  four token blocks) exposed as `--color-editor-surface`; `.files-panel` /
  `.workspace-explorer` / `.editor-pane` / `.editor-pane-header`
  flex-min-h-0 split with fixed 240px tree, color-mix 72% borders, 1100px
  stacked fallback. No new palette, no behavior/gating changes, no
  features/App/shared edits.
- Extended the committed CDP probe (+43) with a static files-split section (9
  checks) that asserts built-CSS selector/token presence and documents
  in-probe that rendered visual acceptance stays with the integrated CDP lane
  once files.v1 ships (no rendered-files claim while withheld).
- Independent leader gate: desktop vitest 37 files / 410 tests passed, tsc
  --noEmit clean, full probe PASSED 54 checks (45 prior + 9 new, prior
  contrast/layout numbers unchanged). Leaf SSR check (3 passed, real
  components, no mocks) accepted as reported.
- Leaf: task_afc88c203f12 (GLM terminal term_a0ebf8a9) worker_done
  2026-09-07T14:01:45Z; scope exactly main.css + probe; no commits by leaf.
- Still blocked: rendered Files visual acceptance (needs files.v1
  advertisement); V3-component half of Follow-up B stays V3's lane.
