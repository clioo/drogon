import assert from "node:assert/strict";

/** The caller has typed the full counting prompt into this specific Pi TUI.
 * Observe real xterm bytes and a real editor newline, without submitting.
 *
 * Pi 0.85.1 strict pin (2026-09-10 submit regression): Pi must receive
 * exactly one CSI-u (`ESC[13;2u`, its native Shift+Enter, valid with or
 * without kitty negotiation). Legacy `ESC CR` is Alt+Enter (queue
 * follow-up) and bare LF is submit when kitty is inactive — allowing
 * either encoding let the submit regression pass silently. This fails
 * if the Pi encoding moves off CSI-u. */
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
    assert.deepEqual(proof.data, ["\x1b[13;2u"], "Pi Shift+Enter must be exactly one CSI-u newline, never Alt-Enter fallback or plain submit");
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
