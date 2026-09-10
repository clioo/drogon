import assert from "node:assert/strict";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { probePiShiftEnter } from "./probe-pi-terminal-input.mjs";

export async function probePiLayout({ page, session, output, getFixtureReceipt }) {
  const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const initialCols = await page.evaluate((id) => window.__drogonTerminals.get(id).cols, session.id);
  const beforeRequests = getFixtureReceipt().totalRequests;
  try {
    await page.setViewportSize({ width: 760, height: 600 });
    await page.waitForFunction(({ id, initialCols }) => window.__drogonTerminals?.get(id)?.cols < initialCols, { id: session.id, initialCols });
    // A renderer reload drops the transport and rebuilds the TUI from real
    // daemon replay; no replacement Pi process or synthetic screen is used.
    await page.reload();
    const tab = page.locator(`[role="tab"][data-tab-id="${session.id}"]`);
    await tab.waitFor();
    await tab.click();
    await page.waitForFunction(async (session) => {
      const terminal = window.__drogonTerminals?.get(session.id);
      const result = await window.drogon.sessions(session.workspaceId);
      const native = result.ok && result.result.sessions.find((item) => item.id === session.id);
      return terminal?.element?.offsetParent !== null && terminal && native?.incarnation === session.incarnation
        && native.verdict === "live" && native.cols === terminal.cols && native.rows === terminal.rows;
    }, session, { timeout: 20000 });
    const proof = await page.evaluate((session) => {
      const terminal = window.__drogonTerminals.get(session.id);
      const screen = terminal.element.querySelector(".xterm-screen");
      const bounds = screen.getBoundingClientRect();
      const clips = [];
      for (let parent = screen.parentElement; parent; parent = parent.parentElement) {
        if (["hidden", "clip", "auto", "scroll"].includes(getComputedStyle(parent).overflowX)) {
          const rect = parent.getBoundingClientRect();
          clips.push({ right: rect.right, left: rect.left });
        }
      }
      let text = "";
      for (let row = 0; row < terminal.buffer.active.length; row++) text += terminal.buffer.active.getLine(row)?.translateToString(true) ?? "";
      terminal.focus();
      return { cols: terminal.cols, rows: terminal.rows, left: bounds.left, right: bounds.right, width: bounds.width, viewportWidth: innerWidth, clips, retainedReply: /195,\s*196,\s*197,\s*198,\s*199,\s*200/.test(text) };
    }, session);
    assert.ok(proof.cols < initialCols && proof.width > 0);
    assert.ok(proof.retainedReply, "the owned Pi reply must survive narrow-layout replay");
    assert.ok(proof.right <= proof.viewportWidth + 1);
    for (const clip of proof.clips) assert.ok(proof.right <= clip.right + 1 && proof.left >= clip.left - 1, "the rightmost Pi column must remain inside every clipping ancestor");
    await page.keyboard.type("Layout check");
    proof.shiftEnter = await probePiShiftEnter(page, session.id, getFixtureReceipt);
    assert.equal(getFixtureReceipt().totalRequests, beforeRequests);
    await writeFile(path.join(output, "pi-reconnect-layout.json"), JSON.stringify(proof, null, 2));
    await page.screenshot({ path: path.join(output, "pi-reconnect-layout.png"), animations: "disabled" });
  } finally { await page.setViewportSize(viewport); }
}
