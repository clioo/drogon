import assert from "node:assert/strict";
import { access, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAcceptanceProcess } from "./acceptance-process.mjs";
import { startExitObserver } from "./live-child-crash-fixture.mjs";

export async function probeChatLifecycle({ page, cli, dataDir, output }) {
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
    await page.waitForFunction(async (session) => {
      const read = await window.drogon.read({ sessionId: session.id, incarnation: session.incarnation, cursor: 0 });
      if (!read.ok) throw new Error(JSON.stringify(read));
      const text = atob(read.result.dataBase64);
      if (read.result.session.verdict !== "live") throw new Error(`Chat Pi exited during startup: ${text}`);
      return text.includes("acceptance-only");
    }, session, { timeout: 20000, polling: 100 });
    return { name, project, session };
  }
  async function remove(chat) {
    await chats.getByRole("button", { name: `Worktree actions for ${chat.name}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Remove Workspace", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Delete Chat", exact: true });
    const confirmation = await dialog.innerText();
    const status = JSON.parse((await runAcceptanceProcess(cli, ["--data-dir", dataDir, "--json", "rpc", "status"])).stdout);
    assert.equal(status.ok, true);
    const children = (await runAcceptanceProcess("/usr/bin/pgrep", ["-P", String(status.result.processId)])).stdout.trim().split(/\s+/);
    let cwdRecords;
    try {
      cwdRecords = (await runAcceptanceProcess(process.platform === "darwin" ? "/usr/sbin/lsof" : "lsof", ["-a", "-p", children.join(","), "-d", "cwd", "-Fpn"])).stdout;
    } catch (error) {
      // A transient git child can disappear after pgrep; lsof still returns
      // valid records for surviving children, with exit status 1.
      if (error.code !== 1 || !error.stdout?.trim()) throw error;
      cwdRecords = error.stdout;
    }
    const matches = [];
    let pid = null;
    for (const line of cwdRecords.split("\n")) {
      if (line.startsWith("p")) pid = Number(line.slice(1));
      if (line === `n${chat.project.path}`) matches.push(pid);
    }
    assert.equal(matches.length, 1, "exactly one owned daemon child must have this unique Chat cwd");
    // Observe only: this PID never authorizes a signal. The renderer can
    // legitimately forget the exited session before a subsequent read.
    const observer = await startExitObserver(matches[0], { scriptPath: fileURLToPath(new URL("./live-child-exit-observer.py", import.meta.url)), deadlineMs: 20000 });
    try {
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      assert.equal(await observer.waitExit(10000), "exit", "deleting a Chat must produce an actual kernel-observed process exit");
      await dialog.waitFor({ state: "hidden" });
      await chats.getByRole("button", { name: `Select ${chat.name}`, exact: true }).waitFor({ state: "detached" });
      const read = await page.evaluate((session) => window.drogon.read({ sessionId: session.id, incarnation: session.incarnation, cursor: 0 }), chat.session);
      if (read.ok) assert.equal(read.result.session.verdict, "exited");
      else assert.equal(read.error.code, "not_found", "only a confirmed exited session may have been forgotten");
      chat.exitProof = { processId: matches[0], kernel: "exit", retained: read.ok };
      assert.match(confirmation, /stops its running sessions/);
      await assert.rejects(access(chat.project.path), { code: "ENOENT" });
    } finally {
      const stopped = await observer.stop(3000);
      assert.equal(stopped.stopped, true);
      assert.equal(stopped.forced, false);
    }
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
