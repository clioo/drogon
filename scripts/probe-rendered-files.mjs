import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function probeRenderedFiles({ page, workspace, output }) {
  const first = "acceptance-first.txt";
  const second = "acceptance-second.txt";
  await writeFile(path.join(workspace, first), "first baseline\n", {
    flag: "wx",
  });
  await writeFile(path.join(workspace, second), "second baseline\n", {
    flag: "wx",
  });
  // Files is no longer a left-nav row (R6-A ported the source sidebar); until
  // the right activity bar lands (R6-B) the panel opens through the command
  // palette, which is gated on the same files capability.
  await openFilesThroughPalette(page);
  const panel = page.locator('section[aria-label="Files"]');
  await panel.getByRole("treeitem", { name: first, exact: true }).click();
  const editor = page.getByLabel(`Contents of ${first}`, { exact: true });
  await editor.waitFor();
  assert.equal(await editor.inputValue(), "first baseline\n");
  await editor.fill("unsaved first draft\n");
  await page.getByLabel("Unsaved changes", { exact: true }).waitFor();
  assert.equal(
    await readFile(path.join(workspace, first), "utf8"),
    "first baseline\n",
  );
  await panel.getByRole("treeitem", { name: second, exact: true }).click();
  const secondEditor = page.getByLabel(`Contents of ${second}`, {
    exact: true,
  });
  await secondEditor.waitFor();
  assert.equal(await secondEditor.inputValue(), "second baseline\n");
  await panel.getByRole("treeitem", { name: first, exact: true }).click();
  await editor.waitFor();
  assert.equal(await editor.inputValue(), "unsaved first draft\n");
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await openFilesThroughPalette(page);
  await editor.waitFor();
  assert.equal(await editor.inputValue(), "unsaved first draft\n");
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
            rows: [...element.querySelectorAll(".workspace-explorer-row")]
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
  await page.getByText("Service 0.1.0", { exact: true }).waitFor();
  await openFilesThroughPalette(page);
  await panel.getByRole("treeitem", { name: first, exact: true }).click();
  await editor.waitFor();
  assert.equal(await editor.inputValue(), "unsaved first draft\n");
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  return [
    "rendered-files-read-edit-switch-retains-unsaved-draft",
    "rendered-files-terminal-navigation-retains-draft",
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

async function openFilesThroughPalette(page) {
  await page.keyboard.press("Meta+J");
  const palette = page.getByRole("dialog").or(page.locator("[cmdk-root]"));
  await palette.first().waitFor({ timeout: 10000 });
  await page.keyboard.type("Open Files panel");
  const item = page.getByRole("option", { name: /Open Files panel/ }).first();
  await item.waitFor({ timeout: 10000 });
  assert.equal(
    (await item.getAttribute("aria-disabled")) !== "true",
    true,
    "The candidate must advertise Files before rendered acceptance",
  );
  await item.click();
  await page.locator('section[aria-label="Files"]').waitFor({ timeout: 10000 });
}
