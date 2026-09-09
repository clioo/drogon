import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

/** Actual Electron keyboard, xterm grid and kernel PTY size; no model requests. */
export async function probeTerminalInputLayout({ page, session, output }) {
  const previousViewport = page.viewportSize();
  const evidence = { layouts: [], backtab: null };
  try {
    for (const width of [1200, 760, 1000]) {
      await page.setViewportSize({ width, height: 600 });
      await page.waitForFunction(async ({ id, workspaceId }) => {
        const terminal = window.__drogonTerminals?.get(id);
        const reply = await window.drogon.sessions(workspaceId);
        const current = reply.ok && reply.result.sessions.find((item) => item.id === id);
        if (!terminal || !current) return false;
        const screen = terminal.element.querySelector(".xterm-screen").getBoundingClientRect();
        const surface = terminal.element.parentElement.getBoundingClientRect();
        return terminal.cols === current.cols && terminal.rows === current.rows
          && screen.right <= surface.right + 1 && screen.bottom <= surface.bottom + 1;
      }, session);
      const marker = `S${width}`;
      await page.locator(".xterm-helper-textarea").focus();
      await page.keyboard.type(`printf '${marker} '; stty size`);
      await page.keyboard.press("Enter");
      await page.waitForFunction(({ id, marker }) => {
        const terminal = window.__drogonTerminals?.get(id);
        if (!terminal) return false;
        const buffer = terminal.buffer.active;
        for (let i = Math.max(0, buffer.length - 100); i < buffer.length; i++) {
          if (new RegExp(`^${marker} \\d+ \\d+$`).test(buffer.getLine(i)?.translateToString(true) ?? "")) return true;
        }
        return false;
      }, { id: session.id, marker });
      const measured = await page.evaluate(({ id, marker }) => {
        const terminal = window.__drogonTerminals.get(id);
        const screen = terminal.element.querySelector(".xterm-screen").getBoundingClientRect();
        const surface = terminal.element.parentElement.getBoundingClientRect();
        const buffer = terminal.buffer.active;
        let kernel = null;
        for (let i = Math.max(0, buffer.length - 100); i < buffer.length; i++) {
          const match = new RegExp(`^${marker} (\\d+) (\\d+)$`).exec(buffer.getLine(i)?.translateToString(true) ?? "");
          if (match) kernel = { rows: Number(match[1]), cols: Number(match[2]) };
        }
        return { grid: { cols: terminal.cols, rows: terminal.rows }, kernel,
          screen: { right: screen.right, bottom: screen.bottom },
          surface: { right: surface.right, bottom: surface.bottom } };
      }, { id: session.id, marker });
      evidence.layouts.push({ width, ...measured });
      assert.deepEqual(measured.kernel, measured.grid, "kernel PTY dimensions must match the visible terminal grid");
      assert.ok(measured.screen.right <= measured.surface.right + 1, "terminal grid must not extend past its visible right edge");
      assert.ok(measured.screen.bottom <= measured.surface.bottom + 1, "terminal grid must not extend below its visible area");
    }
    await page.locator(".xterm-helper-textarea").focus();
    await page.evaluate((id) => {
      const terminal = window.__drogonTerminals.get(id);
      const data = [];
      const subscription = terminal.onData((text) => data.push(text));
      window.__terminalBacktabProbe = { terminal, data, dispose: () => subscription.dispose() };
    }, session.id);
    await page.keyboard.press("Shift+Tab");
    evidence.backtab = await page.evaluate(() => {
      const probe = window.__terminalBacktabProbe;
      return { data: probe.data, focusRetained: document.activeElement === probe.terminal.textarea };
    });
    assert.deepEqual(evidence.backtab.data, ["\u001b[Z"], "Shift+Tab must reach the terminal exactly once");
    assert.equal(evidence.backtab.focusRetained, true, "Shift+Tab inside the terminal must not also move Drogon's focus");
    return ["terminal-grid-and-kernel-size-agree-after-real-window-resizes", "terminal-shift-tab-delivered-once-without-chrome-focus-navigation"];
  } finally {
    await page.evaluate(() => {
      window.__terminalBacktabProbe?.dispose();
      delete window.__terminalBacktabProbe;
    }).catch(() => {});
    await writeFile(path.join(output, "terminal-input-layout.json"), JSON.stringify(evidence, null, 2));
    if (previousViewport) await page.setViewportSize(previousViewport);
  }
}
