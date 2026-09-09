import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { selectSettingsTheme, captureThemeSurface } from "./acceptance-theme.mjs";
import {
  readEditorValue,
  setEditorValue,
  waitForEditorRegistered,
} from "./acceptance-editor-text.mjs";
import {
  PARITY_COLOR_SCHEMES,
  PARITY_VIEWPORT_WIDTHS,
} from "./probe-packaged-surfaces.mjs";

export async function probeRenderedFiles({ page, workspace, output }) {
  const first = "acceptance-first.txt";
  const second = "acceptance-second.txt";
  await writeFile(path.join(workspace, first), "first baseline\n", {
    flag: "wx",
  });
  await writeFile(path.join(workspace, second), "second baseline\n", {
    flag: "wx",
  });
  // R6-B: Files lives in the right activity bar ("Explorer" button; the
  // accessible name carries the chord suffix, so the match is non-exact).
  // Route explicitly to Explorer so the probe is independent of the
  // persisted right-sidebar tab/open state.
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  // Anchored: the explorer toolbar now has its own "Refresh Explorer" /
  // "More Explorer Actions" buttons, so a substring match is ambiguous.
  const files = page.getByRole("button", { name: /^Explorer/ });
  assert.equal(
    await files.isEnabled(),
    true,
    "The candidate must advertise Explorer before rendered acceptance",
  );
  const panel = page.locator('section[aria-label="Files"]');
  // Playwright visibility ignores zero-width ancestor clipping, so never
  // trust it here. The source chord opens the sidebar on Explorer from any
  // state, and the panel's own rect is the only honest admission signal.
  const ensureFilesVisible = async () => {
    const box = await panel.boundingBox().catch(() => null);
    if (box && box.width >= 200) return;
    await page.keyboard.press(`${mod}+Shift+E`);
    await page.waitForFunction(
      () => {
        const el = document.querySelector('section[aria-label="Files"]');
        return el && el.getBoundingClientRect().width >= 200;
      },
      null,
      { timeout: 8000 },
    );
  };
  await ensureFilesVisible();
  // R16-A (fixes #133): a row click opens/reuses a MAIN TAB GROUP editor
  // tab — a full-width Monaco pane, never an editor embedded in the Explorer
  // column. The panel renders the tree only; rows are buttons (R16-D).
  await panel.getByRole("button", { name: first, exact: true }).click();
  await waitForEditorRegistered(page, first);
  assert.equal(
    await panel.locator('[aria-label^="Editor"], .editor-pane-surface').count(),
    0,
    "The Files panel must never embed the file editor (fixes #133)",
  );
  await page.getByRole("tab", { name: first, exact: true }).waitFor();
  assert.equal(await readEditorValue(page, first), "first baseline\n");
  await setEditorValue(page, first, "unsaved first draft\n");
  // R16-X2 (fixes #195): the fork's shared dot/close slot is the only
  // dirty mark — no "(unsaved)" suffix, no status line.
  await page.locator('[data-testid="editor-tab-dirty-dot"]').first().waitFor();
  assert.equal(
    await readFile(path.join(workspace, first), "utf8"),
    "first baseline\n",
  );
  await panel.getByRole("button", { name: second, exact: true }).click();
  await waitForEditorRegistered(page, second);
  assert.equal(await readEditorValue(page, second), "second baseline\n");
  // Reopening the first file reuses its existing tab (never a duplicate):
  // the strip must show exactly one tab per open file. R16-X2 (fixes
  // #195): the tab label carries no dirty suffix, so the lookup is exact.
  const firstTab = page.getByRole("tab", { name: first, exact: true });
  await firstTab.click();
  await waitForEditorRegistered(page, first);
  assert.equal(await readEditorValue(page, first), "unsaved first draft\n");
  assert.equal(
    await firstTab.count(),
    1,
    "Reopening an already-open file must reuse its tab, never duplicate it",
  );
  // R6-B: switching the activity bar away from Explorer hides the tree
  // (keep-alive) without unmounting it; the open editor tab lives in the
  // main tab group, independent of the right-sidebar panel. R16-B: Source
  // Control is git-only per the fork's gating, so the round-trip uses Ports.
  // R16-AY2: anchor on the activity-bar item — the status bar now also owns a
  // "Ports, N workspace port(s)" segment (the fork's copy), so a bare /^Ports/
  // would match two buttons.
  await page.getByRole("button", { name: /^Ports \(/ }).click();
  await files.click();
  await waitForEditorRegistered(page, first);
  assert.equal(await readEditorValue(page, first), "unsaved first draft\n");
  await page
    .locator("#editor-tab-panel")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page
    .locator('[data-testid="editor-tab-dirty-dot"]')
    .first()
    .waitFor({ state: "hidden" });
  assert.equal(
    await readFile(path.join(workspace, first), "utf8"),
    "unsaved first draft\n",
  );
  assert.equal(
    await readFile(path.join(workspace, second), "utf8"),
    "second baseline\n",
  );
  const originalViewport = page.viewportSize();
  try {
    for (const width of PARITY_VIEWPORT_WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      // Reopen on Explorer so every capture measures the real layout.
      await ensureFilesVisible();
      for (const colorScheme of PARITY_COLOR_SCHEMES) {
        const selection = await selectSettingsTheme(page, colorScheme);
        await ensureFilesVisible();
        await captureThemeSurface(page, path.join(output, `files-${width}-${colorScheme}.png`), selection);
        const metrics = await page.evaluate(() => {
          const box = (selector) => {
            const bounds = document
              .querySelector(selector)
              ?.getBoundingClientRect();
            return bounds
              ? {
                  x: bounds.x,
                  y: bounds.y,
                  width: bounds.width,
                  height: bounds.height,
                }
              : null;
          };
          const filesPanel = document.querySelector(
            'section[aria-label="Files"]',
          );
          return {
            // `main` also hosts the right sidebar as a flex child (it is NOT
            // terminal/editor-content-only), so the full-width claim is
            // checked against `.terminal-column` — the tab strip's own
            // host, shared by the terminal, browser and (now) editor panes.
            terminalColumn: box(".terminal-column"),
            editor: box(".editor-pane-surface"),
            editorInsideFilesPanel:
              filesPanel?.querySelector(".editor-pane-surface") != null,
            rows: [
              ...(filesPanel?.querySelectorAll("[data-file-explorer-row]") ??
                []),
            ]
              .slice(0, 2)
              .map((row) => {
                const bounds = row.getBoundingClientRect();
                return { y: bounds.y, height: bounds.height };
              }),
          };
        });
        assertFilesLayout(metrics);
      }
    }
  } finally {
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
  await page.reload();
  // R9-B: sidebar footer readiness (the "Service x.y.z" text is gone).
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor();
  await ensureFilesVisible();
  await files.click();
  await panel.getByRole("button", { name: first, exact: true }).click();
  await waitForEditorRegistered(page, first);
  assert.equal(await readEditorValue(page, first), "unsaved first draft\n");
  // Closing the (only) editor tab returns to the terminal tab, like the
  // fork — the strip's remaining tab (if any) becomes active again.
  await page
    .getByRole("tab", { name: new RegExp(`^${first}`) })
    .getByRole("button", { name: `Close ${first}` })
    .click();
  await page.getByRole("tab", { name: new RegExp(`^${first}`) }).waitFor({
    state: "detached",
  });
  if ((await page.getByRole("tab").count()) > 0) {
    await page.getByRole("tab").first().click();
  }
  return [
    "rendered-files-read-edit-switch-retains-unsaved-draft",
    "rendered-files-activity-switch-retains-draft",
    "rendered-files-save-confirmed-by-exact-disk-content-and-sibling-unchanged",
    "rendered-files-reload-reads-confirmed-disk-content",
    "rendered-files-parity-layout-light-and-dark-at-1440-1100-900-760",
  ];
}

export function assertFilesLayout(metrics) {
  assert.ok(metrics.editor, "The file editor must be rendered");
  assert.equal(
    metrics.editorInsideFilesPanel,
    false,
    "The editor must never be embedded inside the right sidebar Explorer panel (fixes #133)",
  );
  assert.ok(
    metrics.terminalColumn,
    "The tab strip's host column must be rendered",
  );
  assert.ok(
    metrics.editor.width >= metrics.terminalColumn.width * 0.95,
    `The editor must fill the tab strip's own column width (editor ${metrics.editor.width}px vs column ${metrics.terminalColumn.width}px), exactly like the terminal and browser panes, not a fixed narrow sidebar width`,
  );
  assert.ok(
    metrics.editor.height >= 240,
    "The editor must retain usable height",
  );
  assert.equal(
    metrics.rows.length,
    2,
    "Both fixture file rows must be rendered in the Explorer tree",
  );
  assert.ok(
    metrics.rows[1].y >= metrics.rows[0].y + metrics.rows[0].height - 1,
    "Explorer entries must form distinct vertical rows",
  );
}
