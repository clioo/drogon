import assert from "node:assert/strict";
import { probeAgentTabCreation } from "./probe-agent-tab-creation.mjs";
import { probeTerminalExitLayout } from "./probe-terminal-exit-layout.mjs";
import { probeCompletedTerminalRecovery } from "./probe-completed-terminal-recovery.mjs";
import { access, realpath } from "node:fs/promises";
import path from "node:path";
import { waitForTerminalText } from "./acceptance-terminal-text.mjs";

export async function probeStandaloneSessions({ page, output, dataDir }) {
  const created = [];
  const listProjects = () =>
    page.evaluate(async () => {
      const result = await window.drogon.project.projectList();
      if (!result.ok) throw new Error(result.error.message);
      return result.result.projects;
    });
  assert.equal((await listProjects()).length, 0);
  try {
    for (const name of ["Standalone one", "Standalone two"]) {
      await page
        .getByRole("button", { name: "New session", exact: true })
        .first()
        .click();
      const dialog = page.getByRole("dialog", { name: "New session" });
      await dialog.getByLabel("Name (optional)").fill(name);
      await dialog.getByRole("radio", { name: "Pi", exact: true }).check();
      await dialog
        .getByRole("button", { name: "Start session", exact: true })
        .click();
      await dialog.waitFor({ state: "hidden" });
      const row = page
        .getByRole("region", { name: "Recent sessions" })
        .getByRole("button", { name, exact: true });
      await row.waitFor();
      assert.equal(await row.getAttribute("aria-current"), "page");
      const workspaceId = await row.getAttribute(
        "data-recent-session-workspace",
      );
      const project = (await listProjects()).find((item) => item.name === name);
      assert.equal(project.quickSession, true);
      project.workspaceId = workspaceId;
      created.push(project);
      assert.equal(project.kind, "folder");
      assert.equal(path.basename(path.dirname(project.path)), "quick-sessions");
      assert.equal(
        path.resolve(path.dirname(path.dirname(project.path))),
        await realpath(dataDir),
      );
      await assert.rejects(access(path.join(project.path, ".git")));
      assert.equal(
        await page.locator(".shell-project-row", { hasText: name }).count(),
        0,
      );
      await page.locator(".xterm-helper-textarea:visible").waitFor();
      await waitForTerminalText(page, "agent-settings-fixture");
      const sessions = await page.evaluate(async (id) => {
        const result = await window.drogon.sessions(id);
        if (!result.ok) throw new Error(result.error.message);
        return result.result.sessions;
      }, workspaceId);
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].harnessId, "pi");
      assert.equal(sessions[0].verdict, "live");
      project.session = sessions[0];
    }
    assert.notEqual(created[0].path, created[1].path);
    await page.reload();
    for (const project of created) {
      await page.getByRole("button", { name: "Bots", exact: true }).click();
      await page
        .getByRole("region", { name: "Recent sessions" })
        .getByRole("button", { name: project.name, exact: true })
        .click();
      const input = page.locator(".xterm-helper-textarea:visible");
      await input.waitFor();
      await input.focus();
      await page.keyboard.type(`resume-${project.name}`);
      await page.keyboard.press("Enter");
      await waitForTerminalText(page, `fixture-input=resume-${project.name}`);
      const session = await page.evaluate(async (id) => {
        const result = await window.drogon.sessions(id);
        if (!result.ok) throw new Error(result.error.message);
        return result.result.sessions[0];
      }, project.session.workspaceId);
      assert.equal(session.id, project.session.id);
      assert.equal(session.incarnation, project.session.incarnation);
    }
    await page.screenshot({
      path: path.join(output, "standalone-sessions.png"),
    });
    await probeAgentTabCreation({ page, workspaceId: created[1].workspaceId });
    await probeTerminalExitLayout({ page, output });
    await probeCompletedTerminalRecovery({ page, workspaceId: created[1].workspaceId });
    return "standalone-sessions-harness-private-folders-recents-reload-and-bots-return";
  } finally {
    for (const project of created) {
      await page.evaluate(async ({ id, workspaceId }) => {
        const listed = await window.drogon.sessions(workspaceId);
        if (!listed.ok) throw new Error(listed.error.message);
        for (const session of listed.result.sessions) {
          const closed = await window.drogon.close({
            sessionId: session.id,
            incarnation: session.incarnation,
          });
          if (!closed.ok) throw new Error(closed.error.message);
        }
        const result = await window.drogon.project.projectRemove({ id });
        if (!result.ok) throw new Error(result.error.message);
      }, project);
    }
    await page.reload();
    await page.getByRole("heading", { name: "Drogon", exact: true }).waitFor();
  }
}
