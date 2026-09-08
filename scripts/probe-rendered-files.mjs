import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  readEditorValue,
  setEditorValue,
  waitForEditorRegistered,
} from "./acceptance-editor-text.mjs";

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
  // The sidebar may start closed on narrow windows: the source chord opens
  // it on Explorer when the button is not yet actionable.
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
  // The sidebar may start closed (narrow window): Playwright visibility
  // ignores zero-width ancestor clipping, so never trust it here. The
  // source chord opens the sidebar on Explorer from any state, and the
  // panel's own rect is the only honest admission signal.
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
  await panel.getByRole("button", { name: first, exact: true }).click();
  await waitForEditorRegistered(page, first);
  assert.equal(await readEditorValue(page, first), "first baseline\n");
  await setEditorValue(page, first, "unsaved first draft\n");
  await page.getByLabel("Unsaved changes", { exact: true }).waitFor();
  assert.equal(
    await readFile(path.join(workspace, first), "utf8"),
    "first baseline\n",
  );
  await panel.getByRole("button", { name: second, exact: true }).click();
  await waitForEditorRegistered(page, second);
  assert.equal(await readEditorValue(page, second), "second baseline\n");
  await panel.getByRole("button", { name: first, exact: true }).click();
  await waitForEditorRegistered(page, first);
  assert.equal(await readEditorValue(page, first), "unsaved first draft\n");
  // R6-B: switching the activity bar away from Explorer hides the mounted
  // Files panel (keep-alive) without unmounting it; switching back must
  // retain the unsaved draft, mirroring the old Terminals-route round-trip.
  // R16-B: Source Control is git-only per the fork's activity gating, so
  // the round-trip switches to Ports (workspace-gated, served here).
  await page.getByRole("button", { name: /^Ports/ }).click();
  await files.click();
  await waitForEditorRegistered(page, first);
  assert.equal(await readEditorValue(page, first), "unsaved first draft\n");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByLabel("Unsaved changes", { exact: true })
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
    for (const width of [1440, 760]) {
      await page.setViewportSize({ width, height: 900 });
      // Resizing can hide the panel (closed sidebar on narrow windows);
      // reopen on Explorer so every capture measures the real layout.
      await ensureFilesVisible();
      for (const colorScheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme });
        await page.screenshot({
          path: path.join(output, `files-${width}-${colorScheme}.png`),
          animations: "disabled",
        });
        const metrics = await panel.evaluate((element) => {
          const box = (selector) => {
            const bounds = element
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
          return {
            editor: box(".editor-pane-surface"),
            rows: [...element.querySelectorAll('[data-file-explorer-row]')]
              .slice(0, 2)
              .map((row) => {
                const bounds = row.getBoundingClientRect();
                return { y: bounds.y, height: bounds.height };
              }),
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
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
  // Back to the terminal view through the strip when a tab exists (the
  // flow closed every session before this probe ran, so the strip is
  // usually just the "+" menu over the empty state — already stable).
  if ((await page.getByRole("tab").count()) > 0) {
    await page.getByRole("tab").first().click();
  }
  return [
    "rendered-files-read-edit-switch-retains-unsaved-draft",
    "rendered-files-activity-switch-retains-draft",
    "rendered-files-save-confirmed-by-exact-disk-content-and-sibling-unchanged",
    "rendered-files-reload-reads-confirmed-disk-content",
    "rendered-files-wide-and-narrow-layout-light-and-dark",
  ];
}

export function assertFilesLayout(metrics) {
  assert.ok(metrics.editor, "The file editor must be rendered");
  assert.ok(metrics.editor.width >= 200, "The editor must retain usable width");
  assert.ok(
    metrics.editor.height >= 240,
    "The editor must retain usable height",
  );
  assert.equal(
    metrics.rows.length,
    2,
    "Both fixture file rows must be rendered",
  );
  assert.ok(
    metrics.rows[1].y >= metrics.rows[0].y + metrics.rows[0].height - 1,
    "Explorer entries must form distinct vertical rows",
  );
  assert.ok(
    metrics.scrollWidth <= metrics.clientWidth + 1,
    "The Files panel must not overflow horizontally",
  );
}

