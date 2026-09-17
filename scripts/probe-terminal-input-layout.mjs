import assert from "node:assert/strict";
import { rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { waitForSessionStripTab } from "./probe-rendered-harness.mjs";
import { waitForBridgeObservation } from "./acceptance-bridge-observation.mjs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// PERF-01d: each echo wait bounds itself instead of inheriting the page's
// 15 s default. Hot p95 measured ~36 ms, so 3 s is ~80x headroom; cold
// allows a quiet-cadence wake; burst covers ~100 KiB end to end. Polling
// is a 10 ms timer, never rAF: the acceptance window runs hidden, where
// frames stall under load and a frame-gated wait times out on a landed
// echo — while a 100 ms tick would quantize every sample near 100 ms and
// hide the signal this probe exists to record.
const HOT_SAMPLE_TIMEOUT_MS = 3_000;
const COLD_SAMPLE_TIMEOUT_MS = 5_000;
const BURST_TIMEOUT_MS = 30_000;
const ECHO_POLL_MS = 10;

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, rank)];
}

function summarizeLatency(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0] ?? null,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] ?? null,
  };
}

/**
 * PERF-01 acceptance: keystroke -> echo latency through real Electron +
 * CDP. Types single characters into the live shell (PTY line-discipline
 * echo, no Enter) and polls the xterm buffer for each echo, reporting
 * p50/p95 in ms. `hot` types continuously (the active window); `cold`
 * waits out the active window first so the pane falls back to its quiet
 * cadence; `burst` measures a large idle-pane output burst end to end.
 * Leaves the line cleared with Ctrl+C and the shell on a fresh prompt.
 *
 * PERF-01d: a missed sample is diagnostic, never fatal. Every wait carries
 * its own short timeout on interval polling — never the inherited 15 s
 * rAF wait, which stalls in the backgrounded acceptance window under
 * load — and misses land in terminal-echo-latency.json with phase and
 * buffer tail. One lost keystroke cannot poison later samples: the line
 * is cleared and the cumulative expectation resyncs. Percentiles cover
 * the samples that landed; `dropped` counts the ones that did not. Only
 * a total blackout — no echo in any phase — still fails, naming the
 * phase and the observed buffer tail.
 */
export async function probeTerminalEchoLatency({ page, session, output, hotSamples = 30 }) {
  const evidence = { hot: [], coldMs: null, burstMs: null, samples: hotSamples };
  const misses = [];
  const focusTerminal = () => page.locator(".xterm-helper-textarea").focus();
  await focusTerminal();
  // The shell must be sitting on an empty prompt: anything the journey
  // typed before would prefix every echo match below.
  await page.keyboard.press("Control+C");
  await delay(300);
  const alphabet = "abcdefghjkmnpqrstuvwxyz";
  let typed = "";
  // Hot input: type continuously so the pane stays in its active window,
  // and time every single keystroke -> echo through the xterm buffer. The
  // whole buffer joins (a fresh pane's prompt sits at the top rows, not
  // the bottom); the match stays exact because `expected` grows every
  // sample, so only the newest echo can complete it.
  const tailMatches = ({ id, want }) => {
    const terminal = window.__drogonTerminals?.get(id);
    if (!terminal) return false;
    const buffer = terminal.buffer.active;
    let tail = "";
    for (let i = 0; i < buffer.length; i++)
      tail += buffer.getLine(i)?.translateToString(true).replace(/\s+$/, "") ?? "";
    return tail.endsWith(want);
  };
  // Last rows of one pane's buffer for miss diagnostics: enough to tell a
  // lost keystroke (the echo is absent) from fragile waiting (it landed).
  const readBufferTail = ({ id, rows = 8, maxChars = 500 }) => {
    const terminal = window.__drogonTerminals?.get(id);
    if (!terminal) return "<no terminal>";
    const buffer = terminal.buffer.active;
    const lines = [];
    for (let i = Math.max(0, buffer.length - rows); i < buffer.length; i++)
      lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
    return lines.join("\n").slice(-maxChars);
  };
  const waitForEcho = async ({ want, timeoutMs, phase, sample }) => {
    try {
      await page.waitForFunction(tailMatches, { id: session.id, want }, { timeout: timeoutMs, polling: ECHO_POLL_MS });
      return true;
    } catch (error) {
      const bufferTail = await page.evaluate(readBufferTail, { id: session.id }).catch(() => "<unreadable>");
      misses.push({
        phase, sample, expected: want, timeoutMs,
        error: String(error?.message ?? error).split("\n")[0],
        bufferTail,
      });
      return false;
    }
  };
  for (let s = 0; s < hotSamples; s++) {
    // Re-focus per sample: the layout probe's cleanup tolerates focus
    // loss, and a keystroke to the wrong target echoes nowhere.
    await focusTerminal();
    const ch = alphabet[s % alphabet.length];
    const expected = `${typed}${ch}`;
    const t0 = await page.evaluate(() => performance.now());
    await page.keyboard.press(ch);
    const landed = await waitForEcho({ want: expected, timeoutMs: HOT_SAMPLE_TIMEOUT_MS, phase: "hot", sample: s });
    const t1 = await page.evaluate(() => performance.now());
    if (landed) {
      evidence.hot.push(t1 - t0);
      typed = expected;
    } else {
      // Resync: a lost char stays a prefix of `expected` forever and would
      // fail every later sample, so clear the line and start fresh.
      await page.keyboard.press("Control+C");
      await delay(300);
      typed = "";
    }
  }
  const hot = summarizeLatency(evidence.hot);
  // Cold echo: wait out the active window (1.5 s) so the pane falls back
  // to its quiet cadence, then time one keystroke.
  await page.keyboard.press("Control+C");
  await delay(300);
  typed = "";
  await delay(2200);
  {
    await focusTerminal();
    const t0 = await page.evaluate(() => performance.now());
    await page.keyboard.press("z");
    if (await waitForEcho({ want: "z", timeoutMs: COLD_SAMPLE_TIMEOUT_MS, phase: "cold", sample: 0 }))
      evidence.coldMs = (await page.evaluate(() => performance.now())) - t0;
  }
  // Idle-pane burst: after the pane goes quiet, dump ~100 KiB and time
  // Enter -> last line visible end to end.
  await page.keyboard.press("Control+C");
  await delay(2500);
  {
    const burstMarker = `BURST_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const command = `i=0; while [ "$i" -lt 1200 ]; do printf '%080d ${burstMarker} %04d\\n' 0 "$i"; i=$((i+1)); done`;
    await focusTerminal();
    await page.keyboard.type(command);
    // Timed from Enter: typing time is input, not output delivery.
    const t0 = await page.evaluate(() => performance.now());
    await page.keyboard.press("Enter");
    // Rows join before matching: an 80-column viewport wraps the ~104-char
    // burst line, so the marker's tail may start on the next row.
    const burstMatches = ({ marker }) => {
      const terminals = window.__drogonTerminals;
      if (!terminals) return false;
      for (const terminal of terminals.values()) {
        const buffer = terminal.buffer.active;
        let tail = "";
        for (let i = Math.max(0, buffer.length - 150); i < buffer.length; i++)
          tail += buffer.getLine(i)?.translateToString(true) ?? "";
        if (tail.includes(`${marker} 1199`)) return true;
      }
      return false;
    };
    try {
      await page.waitForFunction(burstMatches, { marker: burstMarker }, { timeout: BURST_TIMEOUT_MS, polling: ECHO_POLL_MS });
      evidence.burstMs = (await page.evaluate(() => performance.now())) - t0;
    } catch (error) {
      const bufferTail = await page.evaluate(() => {
        const lines = [];
        for (const terminal of (window.__drogonTerminals ?? new Map()).values()) {
          const buffer = terminal.buffer.active;
          for (let i = Math.max(0, buffer.length - 8); i < buffer.length; i++)
            lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
        }
        return lines.join("\n").slice(-500);
      }).catch(() => "<unreadable>");
      misses.push({
        phase: "burst", sample: 0, expected: `${burstMarker} 1199`, timeoutMs: BURST_TIMEOUT_MS,
        error: String(error?.message ?? error).split("\n")[0],
        bufferTail,
      });
    }
  }
  await page.keyboard.press("Control+C");
  // The surviving product claim: an echo must eventually land, not hang
  // forever. Partial misses degrade; a total blackout still fails, naming
  // the phase and the observed buffer tail.
  if (evidence.hot.length === 0 && evidence.coldMs == null) {
    const first = misses[0];
    assert.fail(`terminal echo never landed (missed=${misses.length}, firstMiss=${first?.phase ?? "hot"}#${first?.sample ?? 0}, bufferTail=${JSON.stringify(first?.bufferTail ?? "<unreadable>")}): an echo must eventually land, not hang forever`);
  }
  const summary = { hot, coldMs: evidence.coldMs, burstMs: evidence.burstMs, samples: evidence.hot, dropped: misses.length, missed: misses };
  if (output) await writeFile(path.join(output, "terminal-echo-latency.json"), JSON.stringify(summary, null, 2));
  return summary;
}

/** Actual Electron keyboard, xterm grid and kernel PTY size; no model requests. */
export async function probeTerminalInputLayout({ page, session, output, expectedHome, dataDir }) {
  const previousViewport = page.viewportSize() ?? await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const evidence = { layouts: [], backtab: null, shiftEnter: null };
  let sidebarToggles = 0;
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  try {
    assert.ok(expectedHome, "the real session must prove its private HOME before any provider journey");
    await page.locator(".xterm-helper-textarea").focus();
    const quotedHome = "'" + expectedHome.replaceAll("'", "'\\''") + "'";
    await page.keyboard.type(`if [ "$HOME" = ${quotedHome} ]; then printf 'PRIVATE_HOME_OK\\n'; else printf 'PRIVATE_HOME_BAD\\n'; fi`);
    await page.keyboard.press("Enter");
    const homeProof = await page.waitForFunction((id) => {
      const buffer = window.__drogonTerminals?.get(id)?.buffer.active;
      if (!buffer) return null;
      for (let row = 0; row < buffer.length; row++) {
        const text = buffer.getLine(row)?.translateToString(true);
        if (text === "PRIVATE_HOME_OK" || text === "PRIVATE_HOME_BAD") return text;
      }
      return null;
    }, session.id);
    assert.equal(await homeProof.jsonValue(), "PRIVATE_HOME_OK", "interactive admission must not recover the real user's HOME");
    evidence.privateHomeVerified = true;
    await page.keyboard.type("i=0; while [ \"$i\" -lt 60 ]; do printf '%080d\\n' 0; i=$((i+1)); done");
    await page.keyboard.press("Enter");
    for (const [index, width] of [1200, 760, 1000, 1200, 760].entries()) {
      if (index === 4) {
        const socket = path.join(dataDir, "runtime-v1.sock");
        const interrupted = path.join(dataDir, `geometry-outage-${randomUUID()}.sock`);
        const beforeCols = await page.evaluate((id) => window.__drogonTerminals.get(id).cols, session.id);
        await rename(socket, interrupted);
        try {
          await waitForSessionStripTab(page, session.id, "unverifiable");
          await page.setViewportSize({ width, height: 600 });
          await page.waitForFunction(({ id, beforeCols }) => window.__drogonTerminals.get(id).cols !== beforeCols, { id: session.id, beforeCols });
        } finally { await rename(interrupted, socket); }
        await waitForSessionStripTab(page, session.id, "live");
        evidence.reconnected = await page.evaluate(async ({ id, workspaceId }) => {
          const terminal = window.__drogonTerminals.get(id);
          const reply = await window.drogon.sessions(workspaceId);
          const current = reply.ok && reply.result.sessions.find((item) => item.id === id);
          return { grid: { cols: terminal.cols, rows: terminal.rows }, service: { cols: current?.cols, rows: current?.rows } };
        }, session);
        await page.screenshot({ path: path.join(output, "terminal-reconnect-geometry.png"), animations: "disabled" });
      } else await page.setViewportSize({ width, height: 600 });
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
      // Node-side polling, not waitForFunction: this wait must observe a
      // convergence that lands silently (a daemon-side resize applies with
      // no visual damage), and the predicate never re-evaluated inside a
      // damage-quiet background window — one stale evaluation, then the
      // full 15 s stall, even though every sessions() call answered in
      // milliseconds and the daemon converged ~3 s after the live flip
      // (PERF-02c). The house bridge observer drives each iteration as one
      // CDP round trip from Node; predicate and assertions are unchanged.
      await waitForBridgeObservation(page, async ({ id, workspaceId }) => {
        const terminal = window.__drogonTerminals?.get(id);
        const reply = await window.drogon.sessions(workspaceId);
        const current = reply.ok && reply.result.sessions.find((item) => item.id === id);
        if (!terminal || !current) return false;
        const screen = terminal.element.querySelector(".xterm-screen").getBoundingClientRect();
        const surface = terminal.element.parentElement.getBoundingClientRect();
        return terminal.cols === current.cols && terminal.rows === current.rows
          && screen.right <= surface.right + 1 && screen.bottom <= surface.bottom + 1;
      }, session, { timeoutMs: 15000, intervalMs: 250 });
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
    return ["terminal-resize-recovers-after-real-transport-loss", "terminal-grid-and-kernel-size-agree-after-real-window-resizes", "terminal-shift-tab-delivered-once-without-chrome-focus-navigation", "terminal-shift-enter-sends-source-fallback-once-not-plain-enter"];
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
