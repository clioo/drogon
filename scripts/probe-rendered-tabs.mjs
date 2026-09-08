import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  readEditorValue,
  waitForEditorRegistered,
} from "./acceptance-editor-text.mjs";

// R16-AJ (fixes #215): sealed tab-restore check. Opens two editor files
// plus one browser tab, records the strip order, reloads the renderer and
// requires the same tabs back in the same order with no clicks — the
// envelope (drogon:tab-strip:<workspaceId> membership keys) must persist
// on every membership change and rehydrate on workspace load. Editor
// content and the browser URL are asserted too; unsaved drafts are
// IN-MEMORY ONLY by construction (the fork behaves the same), so the
// order comparison normalizes the " (unsaved)" suffix a leftover dirty tab
// from an earlier probe may carry.
export async function probeRenderedTabs({ page, workspace, output }) {
  void output;
  const first = "tab-restore-first.txt";
  const second = "tab-restore-second.txt";
  await writeFile(path.join(workspace, first), "first tab content\n");
  await writeFile(path.join(workspace, second), "second tab content\n");
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  const panel = page.locator('section[aria-label="Files"]');
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
  await panel.getByRole("button", { name: second, exact: true }).click();
  await waitForEditorRegistered(page, second);
  const tabsBeforeBrowser = await stripTabLabels(page);
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "New Browser Tab" })
    .click();
  await page.waitForFunction(
    (count) => document.querySelectorAll('[role="tab"]').length === count + 1,
    tabsBeforeBrowser.length,
    { timeout: 15000 },
  );
  const before = await stripTabLabels(page);
  assert.ok(
    before.some((label) => label === first) &&
      before.some((label) => label === second),
    `Both editor tabs must stand in the strip, saw: ${JSON.stringify(before)}`,
  );
  // White-box persist proof: the envelope holds the membership (editor
  // paths, browser id+url) before any reorder/pin/rename runs.
  const envelope = await page.waitForFunction(
    ({ workspacePath, firstName, secondName }) =>
      window.drogon
        .workspaces()
        .then((response) => {
          if (!response.ok) return null;
          const target = response.result.workspaces.find(
            (item) => item.path === workspacePath,
          );
          if (!target) return null;
          const raw = window.localStorage.getItem(
            `drogon:tab-strip:${target.id}`,
          );
          if (!raw) return null;
          const parsed = JSON.parse(raw).state;
          return parsed.editors?.includes(firstName) &&
            parsed.editors?.includes(secondName) &&
            Array.isArray(parsed.browsers) &&
            parsed.browsers.some((tab) => tab.url === "about:blank")
            ? parsed
            : null;
        })
        .catch(() => null),
    { workspacePath: workspace, firstName: first, secondName: second },
    { timeout: 15000 },
  );
  assert.ok(
    envelope,
    "The tab-strip envelope must persist editor paths and the browser id+url",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor({ timeout: 30000 });
  // No clicks from here: the tabs must come back on their own, in order.
  await page.waitForFunction(
    (expected) =>
      JSON.stringify(
        [...document.querySelectorAll('[role="tab"]')].map((el) =>
          (el.getAttribute("aria-label") ?? "").replace(/ \(unsaved\)$/, ""),
        ),
      ) === JSON.stringify(expected),
    normalizeStripLabels(before),
    { timeout: 30000 },
  );
  const after = await stripTabLabels(page);
  assertRestoredStripOrder(normalizeStripLabels(before), normalizeStripLabels(after));
  // Only the selected tab mounts its Monaco model (EditorHost renders the
  // active tab), so each restored file is selected before its content is
  // read back — the same clicks a user makes.
  await page.getByRole("tab", { name: first, exact: true }).click();
  await waitForEditorRegistered(page, first);
  assert.equal(await readEditorValue(page, first), "first tab content\n");
  await page.getByRole("tab", { name: second, exact: true }).click();
  await waitForEditorRegistered(page, second);
  assert.equal(await readEditorValue(page, second), "second tab content\n");
  const browserUrl = await page.evaluate(() =>
    window.drogon.browser
      .getState()
      .then((response) =>
        response.ok
          ? (response.result.tabs.find(
              (tab) => tab.url === "about:blank",
            )?.url ?? null)
          : null,
      )
      .catch(() => null),
  );
  assert.equal(
    browserUrl,
    "about:blank",
    "The restored browser tab must reload its stored URL",
  );
  return [
    "tab-strip-membership-persists-per-workspace",
    "tab-strip-editor-and-browser-tabs-restore-in-order",
  ];
}

async function stripTabLabels(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map(
      (el) => el.getAttribute("aria-label") ?? "",
    ),
  );
}

// Pure order proof, unit-tested in probe-rendered-tabs.test.mjs so a
// regression in the shape of the proof itself fails fast without
// launching Electron.
export function normalizeStripLabels(labels) {
  return labels.map((label) => label.replace(/ \(unsaved\)$/, ""));
}

export function assertRestoredStripOrder(before, after) {
  assert.deepEqual(
    after,
    before,
    `The strip must restore the same tabs in the same order. before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
  );
}
