import assert from "node:assert/strict";

/** The caller has typed the full counting prompt into this specific Pi TUI.
 * Observe real xterm bytes and a real editor newline, without submitting. */
export async function probePiShiftEnter(page, sessionId, getFixtureReceipt) {
  const beforeRequests = getFixtureReceipt().totalRequests;
  await page.evaluate((id) => {
    const terminal = window.__drogonTerminals?.get(id);
    if (!terminal || document.activeElement !== terminal.textarea) throw new Error("Pi input is not focused");
    const buffer = terminal.buffer.active;
    const probe = { data: [], beforeRow: buffer.baseY + buffer.cursorY };
    probe.subscription = terminal.onData((data) => probe.data.push(data));
    window.__drogonPiShiftEnterProbe = probe;
  }, sessionId);
  try {
    await page.keyboard.press("Shift+Enter");
    await page.waitForFunction((id) => {
      const buffer = window.__drogonTerminals?.get(id)?.buffer.active;
      return buffer && buffer.baseY + buffer.cursorY > window.__drogonPiShiftEnterProbe.beforeRow;
    }, sessionId, { timeout: 5000 });
    const proof = await page.evaluate((id) => {
      const terminal = window.__drogonTerminals.get(id);
      return { data: window.__drogonPiShiftEnterProbe.data, focused: document.activeElement === terminal.textarea };
    }, sessionId);
    assert.ok(proof.data.length === 1 && ["\x1b\r", "\x1b[13;2u"].includes(proof.data[0]), "Pi Shift+Enter must be one source-compatible modified Enter");
    assert.equal(proof.focused, true);
    assert.equal(getFixtureReceipt().totalRequests, beforeRequests, "Shift+Enter must not submit Pi's prompt");
    return proof;
  } finally {
    await page.evaluate(() => {
      window.__drogonPiShiftEnterProbe?.subscription.dispose();
      delete window.__drogonPiShiftEnterProbe;
    });
  }
}
