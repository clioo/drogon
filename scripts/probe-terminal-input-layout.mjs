import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

/** Actual Electron keyboard, xterm grid and kernel PTY size; no model requests. */
export async function probeTerminalInputLayout({ page, session, output }) {
  const previousViewport = page.viewportSize();
  const evidence = { layouts: [], backtab: null, shiftEnter: null };
  let sidebarToggles = 0;
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  try {
    await page.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("i=0; while [ \"$i\" -lt 60 ]; do printf '%080d\\n' 0; i=$((i+1)); done");
    await page.keyboard.press("Enter");
    for (const [index, width] of [1200, 760, 1000, 1200].entries()) {
      await page.setViewportSize({ width, height: 600 });
      if (index === 1 || index === 3) {
        if (index === 1) await page.getByRole("button", { name: "Toggle right sidebar", exact: true }).click();
        else {
          await page.keyboard.press(`${modifier}+Shift+E`);
          await page.waitForFunction(() => document.querySelector('[data-testid="right-sidebar"]')?.getBoundingClientRect().width > 0);
        }
        sidebarToggles++;
      }
      await page.locator(".xterm-helper-textarea").focus();
      if (index === 2) {
        const before = await page.evaluate((id) => window.__drogonTerminals.get(id).options.fontSize, session.id);
        await page.keyboard.press(`${modifier}+=`);
        await page.keyboard.press(`${modifier}+=`);
        await page.waitForFunction(({ id, before }) => window.__drogonTerminals.get(id).options.fontSize > before, { id: session.id, before });
      }
      if (index === 3) await page.keyboard.press(`${modifier}+0`);
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
      const marker = `S${index}`;
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
        const viewport = terminal.element.querySelector(".xterm-viewport");
        const buffer = terminal.buffer.active;
        let kernel = null;
        for (let i = Math.max(0, buffer.length - 100); i < buffer.length; i++) {
          const match = new RegExp(`^${marker} (\\d+) (\\d+)$`).exec(buffer.getLine(i)?.translateToString(true) ?? "");
          if (match) kernel = { rows: Number(match[1]), cols: Number(match[2]) };
        }
        return { fontSize: terminal.options.fontSize, grid: { cols: terminal.cols, rows: terminal.rows }, kernel,
          screen: { width: screen.width, right: screen.right, bottom: screen.bottom },
          viewport: { width: viewport.clientWidth, scrollHeight: viewport.scrollHeight, height: viewport.clientHeight },
          surface: { right: surface.right, bottom: surface.bottom } };
      }, { id: session.id, marker });
      evidence.layouts.push({ width, ...measured });
      assert.ok(measured.screen.width <= measured.viewport.width + 1, "terminal columns must fit inside the viewport, excluding its scrollbar");
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
    await page.evaluate(() => { window.__terminalBacktabProbe.data.length = 0; });
    await page.keyboard.press("Shift+Enter");
    evidence.shiftEnter = await page.evaluate(() => [...window.__terminalBacktabProbe.data]);
    assert.deepEqual(evidence.shiftEnter, ["\u001b\r"], "unnegotiated Shift+Enter must send the source Alt-Enter fallback once, not ordinary Enter");
    return ["terminal-grid-and-kernel-size-agree-after-real-window-resizes", "terminal-shift-tab-delivered-once-without-chrome-focus-navigation", "terminal-shift-enter-sends-source-fallback-once-not-plain-enter"];
  } finally {
    await page.evaluate(() => {
      window.__terminalBacktabProbe?.dispose();
      delete window.__terminalBacktabProbe;
    }).catch(() => {});
    await writeFile(path.join(output, "terminal-input-layout.json"), JSON.stringify(evidence, null, 2));
    await page.locator(".xterm-helper-textarea").focus().catch(() => {});
    await page.keyboard.press(`${modifier}+0`).catch(() => {});
    if (sidebarToggles % 2) await page.keyboard.press(`${modifier}+Shift+E`);
    if (previousViewport) await page.setViewportSize(previousViewport);
  }
}
