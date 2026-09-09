import assert from "node:assert/strict";
import { waitForTerminalText } from "./acceptance-terminal-text.mjs";

export async function probeAgentTabCreation({ page, workspaceId }) {
  const sessions = () =>
    page.evaluate(async (id) => {
      const result = await window.drogon.sessions(id);
      if (!result.ok) throw new Error(result.error.message);
      return result.result.sessions;
    }, workspaceId);
  const initial = await sessions();
  const original = initial[0];
  assert.ok(original);
  const openMenu = () =>
    page.getByRole("button", { name: "New tab", exact: true }).click();
  const ids = new Set(initial.map((session) => session.id));
  for (const surface of [
    "terminal",
    "terminal",
    "browser",
    "editor",
    "split",
  ]) {
    if (surface === "browser" || surface === "editor") {
      await openMenu();
      await page
        .getByRole("menuitem", {
          name: surface === "browser" ? /^New Browser Tab/ : /^New Markdown/,
        })
        .click();
      await page
        .locator(".xterm-helper-textarea:visible")
        .waitFor({ state: "hidden" });
    }
    if (surface === "split") {
      await page.locator(`[data-tab-id="${original.id}"]`).click();
      await page.locator(".xterm-screen:visible").click({ button: "right" });
      await page
        .getByRole("menuitem", { name: /^Split Terminal Right/ })
        .click();
      await page.locator('[data-split="split"]').waitFor();
      for (const session of await sessions()) ids.add(session.id);
    }
    const count = ids.size;
    await openMenu();
    await page.getByRole("menuitem", { name: "Pi", exact: true }).click();
    await page.waitForFunction(
      async ({ workspaceId, count }) => {
        const result = await window.drogon.sessions(workspaceId);
        return result.ok && result.result.sessions.length === count + 1;
      },
      { workspaceId, count },
      { timeout: 10000 },
    );
    const now = await sessions();
    const added = now.filter((session) => !ids.has(session.id));
    assert.equal(added.length, 1);
    const current = added[0];
    ids.add(current.id);
    assert.equal(current.harnessId, "pi");
    assert.equal(current.verdict, "live");
    await page.waitForFunction(
      (id) =>
        document
          .querySelector(`[data-tab-id="${id}"]`)
          ?.getAttribute("aria-selected") === "true",
      current.id,
    );
    await page.locator(".xterm-helper-textarea:visible").waitFor();
    assert.equal(
      await page.locator(".xterm-helper-textarea:visible").count(),
      1,
    );
    await page.waitForFunction(() =>
      document.activeElement?.classList.contains("xterm-helper-textarea"),
    );
    await page.keyboard.type(`agent-tab-${current.id}`);
    await page.keyboard.press("Enter");
    await waitForTerminalText(page, `fixture-input=agent-tab-${current.id}`);
    const retained = now.find((session) => session.id === original.id);
    assert.equal(retained.incarnation, original.incarnation);
    assert.equal(retained.verdict, "live");
  }
  await page.locator(`[data-tab-id="${original.id}"]`).click();
  await page.locator('[data-split="split"]').waitFor();
  assert.equal(await page.locator(".xterm-helper-textarea:visible").count(), 2);
}
