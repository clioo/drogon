import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { probeTerminalEchoLatency } from "./probe-terminal-input-layout.mjs";

// PERF-01d: a missed echo sample must degrade, never fail the run. The
// stub page below replays the exact failure class from the field —
// `waitForFunction` rejecting after its timeout — and records every wait
// so the tests can pin the probe's own bounds (explicit timeout +
// interval polling, never the inherited 15 s rAF wait) and the resync
// that keeps one lost keystroke from poisoning later samples.
function makeStubPage({ failWaits = new Set(), bufferTail = "prompt$ fake-tail" } = {}) {
  const calls = { waits: [], presses: [], focuses: 0 };
  let now = 1000;
  const page = {
    locator: () => ({
      focus: async () => {
        calls.focuses += 1;
      },
    }),
    keyboard: {
      press: async (key) => {
        calls.presses.push(key);
      },
      type: async (text) => {
        calls.presses.push(`type:${text.slice(0, 16)}`);
      },
    },
    evaluate: async (fn, arg) => {
      // Clock reads (`() => performance.now()`) advance; buffer-tail reads
      // touch the terminal registry and return the canned tail.
      if (arg !== undefined || String(fn).includes("__drogonTerminals")) return bufferTail;
      now += 5;
      return now;
    },
    waitForFunction: async (fn, arg, options) => {
      const index = calls.waits.length;
      calls.waits.push({ arg, options });
      if (failWaits.has(index))
        throw new Error(`page.waitForFunction: Timeout ${options?.timeout ?? 15000}ms exceeded.`);
      return null;
    },
  };
  return { page, calls };
}

async function runProbe({ hotSamples, failWaits, bufferTail }) {
  const { page, calls } = makeStubPage({ failWaits, bufferTail });
  const output = await mkdtemp(path.join(tmpdir(), "echo-probe-"));
  const session = { id: "session-1" };
  const summary = await probeTerminalEchoLatency({ page, session, output, hotSamples });
  const file = JSON.parse(await readFile(path.join(output, "terminal-echo-latency.json"), "utf8"));
  return { summary, file, calls };
}

describe("probeTerminalEchoLatency missed samples", () => {
  it("a single missed hot sample degrades instead of failing", async () => {
    const hotSamples = 5;
    const { summary, file, calls } = await runProbe({ hotSamples, failWaits: new Set([0]) });
    assert.equal(summary.dropped, 1);
    assert.equal(summary.hot.n, hotSamples - 1);
    assert.equal(summary.samples.length, hotSamples - 1);
    assert.equal(typeof summary.coldMs, "number");
    assert.equal(typeof summary.burstMs, "number");
    assert.equal(summary.missed.length, 1);
    assert.equal(summary.missed[0].phase, "hot");
    assert.equal(summary.missed[0].sample, 0);
    assert.equal(summary.missed[0].expected, "a");
    assert.equal(summary.missed[0].timeoutMs, 3000);
    assert.match(summary.missed[0].error, /Timeout 3000ms exceeded/);
    assert.equal(summary.missed[0].bufferTail, "prompt$ fake-tail");
    assert.deepEqual(file, summary);
  });

  it("every wait bounds itself on interval polling", async () => {
    const hotSamples = 4;
    const { calls } = await runProbe({ hotSamples, failWaits: new Set() });
    assert.equal(calls.waits.length, hotSamples + 2);
    for (const [index, wait] of calls.waits.entries()) {
      assert.equal(wait.options?.polling, 10, `wait ${index} must poll on a timer, not rAF`);
      assert.ok((wait.options?.timeout ?? 0) > 0, `wait ${index} must carry its own timeout`);
    }
    const timeouts = calls.waits.map((wait) => wait.options.timeout);
    assert.deepEqual(timeouts.slice(0, hotSamples), [3000, 3000, 3000, 3000]);
    assert.equal(timeouts[hotSamples], 5000);
    assert.equal(timeouts[hotSamples + 1], 30000);
  });

  it("a lost keystroke cannot poison later cumulative matches", async () => {
    const hotSamples = 4;
    const { calls } = await runProbe({ hotSamples, failWaits: new Set([0]) });
    const wants = calls.waits.slice(0, hotSamples).map((wait) => wait.arg.want);
    assert.equal(wants[0], "a");
    // Without the resync the second wait would expect "ab" — unmatchable
    // once "a" never echoed — and hang every sample after the first miss.
    assert.equal(wants[1], "b");
    assert.ok(calls.presses.includes("Control+C"));
  });

  it("a missed burst degrades with a null burstMs", async () => {
    const hotSamples = 3;
    const { summary } = await runProbe({ hotSamples, failWaits: new Set([hotSamples + 1]) });
    assert.equal(summary.dropped, 1);
    assert.equal(summary.burstMs, null);
    assert.equal(summary.hot.n, hotSamples);
    assert.equal(typeof summary.coldMs, "number");
    assert.equal(summary.missed[0].phase, "burst");
  });

  it("a total blackout still fails naming the phase and buffer tail", async () => {
    const hotSamples = 3;
    const total = hotSamples + 2;
    const { page, calls } = makeStubPage({
      failWaits: new Set(Array.from({ length: total }, (_, i) => i)),
      bufferTail: "prompt$ stuck-here",
    });
    const output = await mkdtemp(path.join(tmpdir(), "echo-probe-"));
    await assert.rejects(
      probeTerminalEchoLatency({ page, session: { id: "session-1" }, output, hotSamples }),
      (error) => {
        assert.match(error.message, /terminal echo never landed/);
        assert.match(error.message, /hot#0/);
        assert.match(error.message, /stuck-here/);
        return true;
      },
    );
    assert.equal(calls.waits.length, total);
  });
});
