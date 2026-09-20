import assert from "node:assert/strict";
import { waitForTerminalText } from "./acceptance-terminal-text.mjs";

// Reference: drogon-orca/src/renderer/src/lib/worktree-activation.ts.
// Exercise App routing, not a mocked sidebar callback or a hidden xterm buffer.
export async function probeSessionNavigation({
  page,
  workspaceId,
  workspaceName = "folder",
  session,
  marker,
}) {
  // The card carries the workspace's own name (issue #579: a folder
  // composer run creates an additional named workspace, so the session
  // under test may live anywhere but the implicit "folder" card).
  const selectName = `Select ${workspaceName}`;
  const sessionsGroupName = `${workspaceName} sessions`;
  const card = page.locator("[data-worktree-card-id]").filter({
    has: page.getByRole("button", { name: selectName, exact: true }),
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

  // Mod+digit jumps by workspace INDEX (issue #579: the session under
  // test may live in an added workspace, not workspaces[0]). Derive the
  // digit from the live list so the shortcut returns to THIS workspace.
  const workspaceIds = await page.evaluate(async () => {
    const response = await window.drogon.workspaces();
    if (!response.ok) throw new Error(response.error.message);
    return response.result.workspaces.map((item) => item.id);
  });
  const workspaceIndex = workspaceIds.indexOf(workspaceId);
  assert.ok(
    workspaceIndex >= 0 && workspaceIndex < 9,
    `session workspace must have a Mod+digit shortcut (index ${workspaceIndex})`,
  );
  const workspaceDigit = String(workspaceIndex + 1);
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  for (const route of ["Bots", "Automations", "Tasks"]) {
    for (const target of ["row", "card"]) {
      await page.getByRole("button", { name: route, exact: true }).click();
      await terminal.waitFor({ state: "hidden" });
      if (target === "row") {
        await card
          .getByRole("group", { name: sessionsGroupName })
          .getByRole("button")
          .first()
          .click();
      } else {
        await card
          .getByRole("button", { name: selectName, exact: true })
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
    await page.keyboard.press(`${mod}+${workspaceDigit}`);
    await assertSession();
  }
  // A second click on the active card must preserve the live projection too.
  await card
    .getByRole("button", { name: selectName, exact: true })
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
