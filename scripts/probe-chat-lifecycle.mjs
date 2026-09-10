import assert from "node:assert/strict";
import { access, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

export async function probeChatLifecycle({ page, dataDir, output }) {
  const checks = [];
  const chats = page.getByTestId("sidebar-chats-section");
  const ordered = await chats.evaluate((node) => {
    const projects = document.querySelector('[data-sidebar-section-title="projects"]');
    return !!projects && !!(projects.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert.equal(ordered, true, "Chats must be below Projects");
  const newTab = page.getByRole("button", { name: "New tab", exact: true });
  assert(await newTab.evaluate((button) => button.tabIndex >= 0 && !button.disabled));
  await newTab.focus();
  await page.keyboard.press("Enter");
  const icons = {};
  for (const name of ["Claude Code", "Pi", "OpenCode", "Codex", "Antigravity"]) {
    const item = page.getByRole("menuitem").filter({ has: page.getByText(name, { exact: true }) });
    await item.waitFor();
    icons[name] = await item.locator("svg").first().evaluate((svg) => ({
      width: svg.getBoundingClientRect().width,
      height: svg.getBoundingClientRect().height,
      geometry: svg.innerHTML,
    }));
    assert(icons[name].width > 0 && icons[name].height > 0, `${name} must have a visible icon`);
  }
  assert.equal(new Set(Object.values(icons).map((icon) => icon.geometry)).size, 5, "harnesses must not share the generic terminal icon");
  await page.screenshot({ path: path.join(output, "new-tab-harness-icons.png") });
  await page.keyboard.press("Escape");
  checks.push("new-tab-keyboard-accessible-with-five-distinct-visible-harness-icons");
  const root = await realpath(dataDir);
  async function create(name) {
    await chats.getByRole("button", { name: "New chat", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New session", exact: true });
    await dialog.getByLabel("Name (optional)").fill(name);
    await dialog.getByRole("radio", { name: "Pi", exact: true }).check();
    await dialog.getByRole("button", { name: "Start session", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await chats.getByRole("button", { name: `Select ${name}`, exact: true }).waitFor();
    const project = await page.evaluate(async (name) => {
      const reply = await window.drogon.project.projectList();
      if (!reply.ok) throw new Error(reply.error.message);
      return reply.result.projects.find((project) => project.name === name && project.quickSession);
    }, name);
    assert(project, "UI creation must persist a real quick-session project");
    assert(project.path.startsWith(path.join(root, "quick-sessions") + path.sep), "write only inside owned acceptance scratch");
    await writeFile(path.join(project.path, "acceptance-chat.txt"), name);
    const session = await page.evaluate(async (projectId) => {
      const worktrees = await window.drogon.project.worktreeList({ projectId });
      if (!worktrees.ok) throw new Error(worktrees.error.message);
      const reply = await window.drogon.sessions(worktrees.result.worktrees[0].workspaceId);
      if (!reply.ok) throw new Error(reply.error.message);
      return reply.result.sessions.find((session) => session.verdict === "live");
    }, project.id);
    assert(session, "Chat creation must launch its real Pi session");
    return { name, project, session };
  }
  async function remove(chat) {
    await chats.getByRole("button", { name: `Worktree actions for ${chat.name}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Remove Workspace", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Delete Chat", exact: true });
    const confirmation = await dialog.innerText();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await chats.getByRole("button", { name: `Select ${chat.name}`, exact: true }).waitFor({ state: "detached" });
    const read = await page.evaluate((session) => window.drogon.read({ sessionId: session.id, incarnation: session.incarnation, cursor: 0 }), chat.session);
    assert.equal(read.ok, true, JSON.stringify(read));
    assert.equal(read.result.session.verdict, "exited", "deleting a Chat must settle its exact process");
    assert.match(confirmation, /stops its running sessions/);
    await assert.rejects(access(chat.project.path), { code: "ENOENT" });
  }
  const first = await create("Acceptance delete Chat");
  const second = await create("Acceptance keep Chat");
  await page.reload();
  for (const chat of [first, second]) {
    await chats.getByRole("button", { name: `Select ${chat.name}`, exact: true }).waitFor();
    assert.equal(await readFile(path.join(chat.project.path, "acceptance-chat.txt"), "utf8"), chat.name);
  }
  checks.push("chats-created-through-ui-below-projects-survive-renderer-reload-with-files");
  await remove(first);
  const sibling = await page.evaluate((session) => window.drogon.read({ sessionId: session.id, incarnation: session.incarnation, cursor: 0 }), second.session);
  assert.equal(sibling.ok, true, JSON.stringify(sibling));
  assert.equal(sibling.result.session.verdict, "live");
  assert.equal(await readFile(path.join(second.project.path, "acceptance-chat.txt"), "utf8"), second.name);
  await page.reload();
  await chats.getByRole("button", { name: `Select ${second.name}`, exact: true }).waitFor();
  assert.equal(await chats.getByRole("button", { name: `Select ${first.name}`, exact: true }).count(), 0);
  await page.screenshot({ path: path.join(output, "chat-scoped-deletion.png") });
  checks.push("chat-ui-delete-settles-owned-session-removes-only-owned-files-and-stays-deleted");
  await remove(second);
  await page.getByRole("button", { name: "Select folder", exact: true }).click();
  await writeFile(path.join(output, "chat-lifecycle.json"), JSON.stringify({ first, second, icons, checks }, null, 2) + "\n");
  return checks;
}
