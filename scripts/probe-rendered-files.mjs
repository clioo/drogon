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
  const files = page.getByRole("button", { name: "Files", exact: true });
  assert.equal(
    await files.isEnabled(),
    true,
    "The candidate must advertise Files before rendered acceptance",
  );
  await files.click();
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
  await page.getByRole("button", { name: "Terminals", exact: true }).click();
  await files.click();
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
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({
      path: path.join(output, `files-${colorScheme}.png`),
      animations: "disabled",
    });
  }
  await page.reload();
  await page.getByText("Service 0.1.0", { exact: true }).waitFor();
  await files.click();
  await panel.getByRole("treeitem", { name: first, exact: true }).click();
  await editor.waitFor();
  assert.equal(await editor.inputValue(), "unsaved first draft\n");
  await page.getByRole("button", { name: "Terminals", exact: true }).click();
  return [
    "rendered-files-read-edit-switch-retains-unsaved-draft",
    "rendered-files-terminal-navigation-retains-draft",
    "rendered-files-save-confirmed-by-exact-disk-content-and-sibling-unchanged",
    "rendered-files-reload-reads-confirmed-disk-content",
  ];
}
