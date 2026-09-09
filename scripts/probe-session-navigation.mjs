import assert from "node:assert/strict";
import { waitForTerminalText } from "./acceptance-terminal-text.mjs";

// Reference: drogon-orca/src/renderer/src/lib/worktree-activation.ts.
// Exercise App routing, not a mocked sidebar callback or a hidden xterm buffer.
export async function probeSessionNavigation({
  page,
  workspaceId,
  session,
  marker,
}) {
  const card = page.locator("[data-worktree-card-id]").filter({
    has: page.getByRole("button", { name: "Select folder", exact: true }),
  });
  const terminal = page.locator(".xterm-helper-textarea:visible");
  const assertSession = async () => {
    await terminal.waitFor({ timeout: 5000 });
    assert.equal(
      await page
        .getByRole("button", { name: "Sessions", exact: true })
        .getAttribute("aria-current"),
      "page",
    );
    await waitForTerminalText(page, marker);
    const sessions = await page.evaluate(async (id) => {
      const response = await window.drogon.sessions(id);
      if (!response.ok) throw new Error(response.error.message);
      return response.result.sessions;
    }, workspaceId);
    assert.equal(
      sessions.length,
      1,
      "navigation must not spawn another terminal",
    );
    assert.equal(sessions[0].id, session.id);
    assert.equal(sessions[0].incarnation, session.incarnation);
    assert.equal(sessions[0].verdict, "live");
  };

  for (const route of ["Bots", "Automations", "Tasks"]) {
    for (const target of ["row", "card"]) {
      await page.getByRole("button", { name: route, exact: true }).click();
      await terminal.waitFor({ state: "hidden" });
      if (target === "row") {
        await card
          .getByRole("group", { name: "folder sessions" })
          .getByRole("button")
          .first()
          .click();
      } else {
        await card
          .getByRole("button", { name: "Select folder", exact: true })
          .click();
      }
      await assertSession();
      await page.getByRole("button", { name: "Go back", exact: true }).click();
      await terminal.waitFor({ state: "hidden" });
      assert.equal(
        await page
          .getByRole("button", { name: route, exact: true })
          .getAttribute("aria-current"),
        "page",
      );
      await page
        .getByRole("button", { name: "Go forward", exact: true })
        .click();
      await assertSession();
    }
    await page.getByRole("button", { name: route, exact: true }).click();
    await terminal.waitFor({ state: "hidden" });
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+1" : "Control+1",
    );
    await assertSession();
  }
  // A second click on the active card must preserve the live projection too.
  await card
    .getByRole("button", { name: "Select folder", exact: true })
    .click();
  await assertSession();
  await terminal.focus();
  const resumed = `${marker}_NAVIGATION`;
  await page.keyboard.type(
    process.platform === "win32"
      ? `echo ${resumed}`
      : `printf '%s\\n' '${resumed}'`,
  );
  await page.keyboard.press("Enter");
  await waitForTerminalText(page, resumed);
  return "session-navigation-from-global-pages-preserves-live-terminal";
}
