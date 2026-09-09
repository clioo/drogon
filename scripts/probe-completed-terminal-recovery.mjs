import assert from "node:assert/strict";
import { waitForTerminalText } from "./acceptance-terminal-text.mjs";

export async function probeCompletedTerminalRecovery({ page, workspaceId }) {
  const panel = page.locator("#active-session-panel");
  const pane = panel.locator(".terminal-split-pane");
  const tabs = page.locator('[role="tab"][data-tab-id]');
  const selectedId = () => pane.getAttribute("data-terminal-pane-id");
  const list = () =>
    page.evaluate(async (id) => {
      const reply = await window.drogon.sessions(id);
      if (!reply.ok) throw new Error(reply.error.message);
      return reply.result.sessions;
    }, workspaceId);
  const launch = async (agent) => {
    const before = await tabs.count();
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page
      .getByRole("menuitem", { name: agent ? "Pi" : /^New Terminal/ })
      .click();
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll('[role="tab"][data-tab-id]').length ===
        count + 1,
      before,
    );
    await panel.locator('[data-split="single"]').waitFor();
    await panel.locator(".xterm-helper-textarea").waitFor();
    const id = await selectedId();
    const session = (await list()).find((item) => item.id === id);
    assert.equal(session.verdict, "live");
    if (agent) await waitForTerminalText(page, "agent-settings-fixture");
    return session;
  };
  for (const agent of [false, true]) {
    const exited = await launch(agent);
    // External PTY input models a process ending without this renderer's
    // input callback. Reload then exercises a durable completed record.
    await page.evaluate(
      async ({ session, text }) => {
        const reply = await window.drogon.write({
          sessionId: session.id,
          incarnation: session.incarnation,
          text,
        });
        if (!reply.ok) throw new Error(reply.error.message);
      },
      { session: exited, text: agent ? "\u0004" : "exit 0\r" },
    );
    await page.waitForFunction(
      async ({ workspaceId, id }) => {
        const reply = await window.drogon.sessions(workspaceId);
        return (
          reply.ok &&
          reply.result.sessions.some(
            (item) =>
              item.id === id &&
              item.verdict === "exited" &&
              item.exitCode === 0,
          )
        );
      },
      { workspaceId, id: exited.id },
    );
    await page.reload();
    await page.locator(`[data-tab-id="${exited.id}"]`).click();
    const alert = pane.getByRole("alert").filter({ hasText: "exit code 0" });
    await alert.waitFor();
    assert.equal(
      await alert.getByRole("button", { name: "Close", exact: true }).count(),
      1,
    );
    // A completed selection must not prevent a fresh terminal/agent launch.
    const added = await launch(!agent);
    assert.notEqual(added.id, exited.id);
    await page.locator(`[data-tab-id="${exited.id}"]`).click();
    const beforeRestart = await tabs.count();
    await alert.getByRole("button", { name: "Restart", exact: true }).click();
    await page
      .locator(`[data-tab-id="${exited.id}"]`)
      .waitFor({ state: "detached" });
    await panel.locator(".xterm-helper-textarea").waitFor();
    assert.equal(await tabs.count(), beforeRestart);
    const restartedId = await selectedId();
    const restarted = (await list()).find((item) => item.id === restartedId);
    assert.equal(restarted.verdict, "live");
    assert.equal(restarted.harnessId, exited.harnessId);
    await panel.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type(
      agent
        ? "completed-pi-recovered"
        : "printf 'completed-shell-recovered\\n'",
    );
    await page.keyboard.press("Enter");
    await waitForTerminalText(
      page,
      agent
        ? "fixture-input=completed-pi-recovered"
        : "completed-shell-recovered",
    );
  }
}
