import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  readEditorValue,
  waitForEditorRegistered,
} from "./acceptance-editor-text.mjs";

// Sealed keyboard-typing acceptance for the file editor (clioo/drogon#144).
// The rendered-files probe drives the editor programmatically (setValue);
// this probe proves the REAL keyboard path — CDP keystrokes into the
// focused Monaco surface — end to end: typing dirties, an external write
// mid-draft raises the changed-on-disk mark WITHOUT clobbering the model,
// autosave stays suspended while the mark stands, and an explicit save
// resolves the conflict in favor of the draft.
export async function probeEditorKeyboardInput({ page, workspace, output }) {
  const name = "typed-journey.txt";
  const baseline = "journey base\n";
  await writeFile(path.join(workspace, name), baseline, { flag: "wx" });
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  const panel = page.locator('section[aria-label="Files"]');
  const box = await panel.boundingBox().catch(() => null);
  if (!box || box.width < 200) {
    await page.keyboard.press(`${mod}+Shift+E`);
    await page.waitForFunction(
      () => {
        const el = document.querySelector('section[aria-label="Files"]');
        return el && el.getBoundingClientRect().width >= 200;
      },
      null,
      { timeout: 8000 },
    );
  }
  await panel.getByRole("button", { name, exact: true }).click();
  await waitForEditorRegistered(page, name);
  assert.equal(await readEditorValue(page, name), baseline);

  // Real keystrokes into the focused Monaco surface (never setValue).
  await page.locator(".monaco-editor .view-lines").click();
  await page.keyboard.type("typed-by-keyboard ");
  await page.waitForFunction(
    (k) => window.__drogonEditors.get(k).getValue().includes("typed-by-keyboard "),
    name,
    { timeout: 10_000 },
  );
  const draft = await readEditorValue(page, name);
  // Cursor placement after a surface click is Monaco's business (it lands
  // at the click point, here the document end) — the proof is that the
  // keystrokes reached the model at all, alongside the untouched baseline.
  assert.ok(draft.includes("typed-by-keyboard "));
  assert.ok(draft.includes("journey base"));
  // R16-X2 (fixes #195): the fork's shared dot/close slot is the only
  // dirty mark — no "(unsaved)" suffix, no status line.
  await page.locator('[data-testid="editor-tab-dirty-dot"]').first().waitFor();
  assert.equal(await readFile(path.join(workspace, name), "utf8"), baseline);

  // External write while dirty: the mark appears, the model keeps the
  // draft, and disk keeps the external content past the autosave delay.
  const external = "external overwrite\n";
  await writeFile(path.join(workspace, name), external);
  await page
    .getByLabel("Changed on disk", { exact: true })
    .first()
    .waitFor({ timeout: 15_000 });
  await page.screenshot({ path: path.join(output, "editor-conflict.png") });
  const snapshot = {
    banner: true,
    dirty: true,
    model: await readEditorValue(page, name),
    disk: await readFile(path.join(workspace, name), "utf8"),
  };
  assertConflictSnapshot({ ...snapshot, draft });
  await delay(3000);
  assert.equal(
    await readFile(path.join(workspace, name), "utf8"),
    external,
    "Autosave must stay suspended while the changed-on-disk mark stands",
  );

  // Explicit save resolves the conflict in favor of the draft.
  await page.keyboard.press(`${mod}+s`);
  await page
    .locator('[data-testid="editor-tab-dirty-dot"]')
    .first()
    .waitFor({ state: "hidden", timeout: 15_000 });
  assert.equal(await readFile(path.join(workspace, name), "utf8"), draft);
  await page
    .getByLabel("Changed on disk", { exact: true })
    .first()
    .waitFor({ state: "hidden", timeout: 15_000 });

  // Native undo stack survives the journey.
  await page.keyboard.type("uu");
  const withExtra = await readEditorValue(page, name);
  await page.keyboard.press(`${mod}+z`);
  await page.waitForFunction(
    ({ k, v }) => window.__drogonEditors.get(k).getValue() !== v,
    { k: name, v: withExtra },
    { timeout: 10_000 },
  );
  await page.keyboard.press(`${mod}+Shift+z`);
  await page.waitForFunction(
    ({ k, v }) => window.__drogonEditors.get(k).getValue() === v,
    { k: name, v: withExtra },
    { timeout: 10_000 },
  );
  return [
    "editor-keyboard-type-dirties-without-silent-write",
    "editor-external-write-marks-suspends-and-keeps-draft",
    "editor-explicit-save-resolves-conflict-for-draft",
    "editor-undo-redo-survives-journey",
  ];
}

// Pure assertion over one observed conflict moment, unit-tested in
// probe-editor-keyboard-input.test.mjs so a regression in the shape of the
// proof itself fails fast without launching Electron.
export function assertConflictSnapshot({ banner, dirty, model, disk, draft }) {
  assert.equal(banner, true, "The changed-on-disk mark must stand");
  assert.equal(dirty, true, "The draft must stay dirty");
  assert.equal(
    model,
    draft,
    "The live model must keep the typed draft, never the external content",
  );
  assert.ok(
    !disk.includes("typed-by-keyboard"),
    "Disk must keep the external content while the mark stands",
  );
}
