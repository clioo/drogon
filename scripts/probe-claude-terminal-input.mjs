import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile, realpath, access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { runAcceptanceProcess } from "./acceptance-process.mjs";

export async function seedPrivateClaudeKeyboard({ home, fixtureBin, workspace, baseUrl }) {
  assert.equal(process.platform, "darwin", "Claude keyboard probe requires its per-process network sandbox");
  await access("/usr/bin/sandbox-exec");
  const binary = await realpath((await runAcceptanceProcess("/usr/bin/which", ["claude"], { timeout: 10000 })).stdout.trim());
  const config = path.join(home, ".claude");
  await mkdir(config, { recursive: true });
  await writeFile(path.join(config, "settings.json"), JSON.stringify({
    model: "drogon-acceptance-only",
    env: { ANTHROPIC_BASE_URL: baseUrl.replace(/\/v1\/?$/, ""), ANTHROPIC_API_KEY: "drogon-offline-keyboard-fixture",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1" },
  }));
  const onboarding = JSON.stringify({ hasCompletedOnboarding: true, theme: "dark", projects: { [workspace]: { hasTrustDialogAccepted: true }, [await realpath(workspace)]: { hasTrustDialogAccepted: true } } });
  await writeFile(path.join(home, ".claude.json"), onboarding);
  await writeFile(path.join(config, ".claude.json"), onboarding);
  const quoted = `'${binary.replaceAll("'", "'\\''")}'`;
  // Real Claude binary, not a simulated TUI. Network denial is inherited by
  // its children and cannot fall back to any real provider or telemetry host.
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(path.join(fixtureBin, "claude"), `#!/bin/sh\n[ "$HOME" = ${quote(home)} ] || exit 97\nexport CLAUDE_CONFIG_DIR=${quote(config)}\nexport ANTHROPIC_BASE_URL=${quote(baseUrl.replace(/\/v1\/?$/, ""))}\nexport ANTHROPIC_API_KEY=drogon-offline-keyboard-fixture\nexport CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1 DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1\nexec /usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)' ${quoted} "$@"\n`, { mode: 0o700 });
  return { binary, network: "denied-by-per-process-sandbox" };
}

export async function probeClaudeTerminalInput({ page, workspaceId, output }) {
  const reply = await page.evaluate((input) => window.drogon.startHarness(input), {
    workspaceId, harnessId: "claude", model: "drogon-acceptance-only", permissionMode: "inherit", requestId: randomUUID(),
  });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  const session = reply.result;
  assert.equal(session.harnessId, "claude");
  let stage = "startup";
  try {
    const tab = page.locator(`[role="tab"][data-tab-id="${session.id}"]`);
    await tab.waitFor();
    await tab.click();
    await page.waitForFunction((id) => {
      const terminal = window.__drogonTerminals?.get(id);
      if (!terminal) return false;
      let text = "";
      for (let row = 0; row < terminal.buffer.active.length; row++) text += terminal.buffer.active.getLine(row)?.translateToString(true) ?? "";
      return /Claude Code/.test(text);
    }, session.id, { timeout: 30000 });
    const text = async () => page.evaluate((id) => {
      const terminal = window.__drogonTerminals.get(id); let text = "";
      for (let row = 0; row < terminal.buffer.active.length; row++) text += terminal.buffer.active.getLine(row)?.translateToString(true) + "\n";
      return text;
    }, session.id);
    await page.evaluate((id) => window.__drogonTerminals.get(id).focus(), session.id);
    let ready = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const screen = await page.waitForFunction((id) => {
        const terminal = window.__drogonTerminals.get(id); let visible = "";
        for (let row = terminal.buffer.active.baseY; row < terminal.buffer.active.baseY + terminal.rows; row++) visible += (terminal.buffer.active.getLine(row)?.translateToString(true) ?? "") + "\n";
        return /Yes, I trust|Yes, I accept|Do you want to use this API key|❯/.test(visible) ? visible : false;
      }, session.id, { timeout: 30000 });
      const startup = await screen.jsonValue();
      let question;
      if (startup.includes("Do you want to use this API key")) {
        question = "Do you want to use this API key";
        if (/[›❯>]\s*No/.test(startup)) await page.keyboard.press("ArrowUp");
      } else if (startup.includes("Bypass Permissions") && startup.includes("Yes, I accept")) {
        question = "Yes, I accept";
        if (/[›❯>]\s*No, exit/.test(startup)) await page.keyboard.press("ArrowDown");
      } else if (/Yes, I trust this folder|Yes, I trust this directory/.test(startup)) {
        question = "Yes, I trust";
        if (/[›❯>]\s*No, exit/.test(startup)) await page.keyboard.press("ArrowDown");
      } else { ready = true; break; }
      await page.keyboard.press("Enter");
      await page.waitForFunction(({ id, question }) => {
        const terminal = window.__drogonTerminals.get(id); let visible = "";
        for (let row = terminal.buffer.active.baseY; row < terminal.buffer.active.baseY + terminal.rows; row++) visible += terminal.buffer.active.getLine(row)?.translateToString(true) ?? "";
        return !visible.includes(question);
      }, { id: session.id, question }, { timeout: 10000 });
    }
    assert.ok(ready, "Claude must reach its real prompt before typing the keyboard probe");
    await page.evaluate((id) => window.__drogonTerminals.get(id).focus(), session.id);
    stage = "first-editor-marker";
    await page.keyboard.type("CLAUDE_NEWLINE_FIRST");
    await page.waitForFunction((id) => {
      const terminal = window.__drogonTerminals.get(id); let text = "";
      for (let row = 0; row < terminal.buffer.active.length; row++) text += terminal.buffer.active.getLine(row)?.translateToString(true) ?? "";
      return text.includes("CLAUDE_NEWLINE_FIRST");
    }, session.id);
    await page.evaluate((id) => {
      const terminal = window.__drogonTerminals.get(id);
      let markerRow = -1;
      for (let row = 0; row < terminal.buffer.active.length; row++) if (terminal.buffer.active.getLine(row)?.translateToString(true).includes("CLAUDE_NEWLINE_FIRST")) markerRow = row;
      const state = { before: terminal.buffer.active.baseY + terminal.buffer.active.cursorY - markerRow, data: [] };
      state.subscription = terminal.onData((data) => state.data.push(data));
      window.__drogonClaudeKeyboardProbe = state;
    }, session.id);
    stage = "modified-enter";
    await page.keyboard.press("Shift+Enter");
    await page.waitForFunction((id) => {
      const terminal = window.__drogonTerminals.get(id);
      let markerRow = -1;
      for (let row = 0; row < terminal.buffer.active.length; row++) if (terminal.buffer.active.getLine(row)?.translateToString(true).includes("CLAUDE_NEWLINE_FIRST")) markerRow = row;
      return markerRow >= 0 && terminal.buffer.active.baseY + terminal.buffer.active.cursorY - markerRow === window.__drogonClaudeKeyboardProbe.before + 1;
    }, session.id, { timeout: 10000 });
    const data = await page.evaluate(() => [...window.__drogonClaudeKeyboardProbe.data]);
    assert.ok(data.length === 1 && ["\x1b\r", "\x1b[13;2u"].includes(data[0]), "Claude must receive one modified Enter, not plain CR");
    stage = "join-editor-lines";
    await page.keyboard.press("Backspace");
    await page.waitForFunction((id) => {
      const terminal = window.__drogonTerminals.get(id);
      let markerRow = -1;
      for (let row = 0; row < terminal.buffer.active.length; row++) if (terminal.buffer.active.getLine(row)?.translateToString(true).includes("CLAUDE_NEWLINE_FIRST")) markerRow = row;
      return markerRow >= 0 && terminal.buffer.active.baseY + terminal.buffer.active.cursorY - markerRow === window.__drogonClaudeKeyboardProbe.before;
    }, session.id, { timeout: 10000 });
    // Joining the two editor lines proves that Shift+Enter did not submit a
    // conversation turn, even though network denial would hide HTTP traffic.
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("CLAUDE_NEWLINE_SECOND");
    assert.ok((await text()).includes("CLAUDE_NEWLINE_FIRST"));
    const focused = await page.evaluate((id) => document.activeElement === window.__drogonTerminals.get(id).textarea, session.id);
    assert.equal(focused, true);
    await writeFile(path.join(output, "claude-terminal-input.json"), JSON.stringify({ sessionId: session.id, incarnation: session.incarnation, data, editorNewlineJoinedByBackspace: true, focused, network: "denied" }, null, 2));
    await page.screenshot({ path: path.join(output, "claude-terminal-input.png"), animations: "disabled" });
    return ["claude-real-tui-shift-enter-inserts-editable-newline-without-submission"];
  } catch (error) {
    await page.screenshot({ path: path.join(output, "claude-keyboard-failure.png"), animations: "disabled" });
    await writeFile(path.join(output, "claude-keyboard-failure.json"), JSON.stringify({ stage, error: error.stack }, null, 2));
    throw error;
  } finally {
    await page.evaluate(async (session) => {
      window.__drogonClaudeKeyboardProbe?.subscription.dispose();
      delete window.__drogonClaudeKeyboardProbe;
      const result = await window.drogon.stop({ sessionId: session.id, incarnation: session.incarnation });
      if (!result.ok) throw new Error(result.error.message);
    }, session);
    const tab = page.locator(`[role="tab"][data-tab-id="${session.id}"]`);
    if (await tab.count()) await tab.getByRole("button", { name: /^Close / }).click();
  }
}
