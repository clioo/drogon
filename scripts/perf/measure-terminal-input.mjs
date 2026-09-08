#!/usr/bin/env node
// Keystroke-latency probe (FIX-TERM-LAT, #358): measures user-perceived
// terminal typing latency of the Drogon desktop against the live
// orca-drogon reference, modeled on scripts/perf/measure-navigation.mjs.
//
//   # Packaged candidate (harness owns the lifecycle: a setup spawn creates
//   # one git project + worktree + workspace + one live echo session
//   # (/bin/cat, canonical-mode kernel echo), then a fresh measured spawn
//   # types --keys keystrokes in a paced phase and a burst phase; both are
//   # stopped by PID):
//   node scripts/perf/measure-terminal-input.mjs --bundle <Drogon.app> \
//     --data-dir /tmp/drogon-typelat-data --profile-dir /tmp/drogon-typelat-profile \
//     --fixture-repo /tmp/drogon-typelat-repo --keys 100 --out report.json
//
//   # Reference (attach only: never starts, stops, types into, or reloads
//   # the live instance). Uses the fork's own devtools probe
//   # (window.__orcaTypingDiagnostic, src/renderer/src/lib/typing-latency/
//   # diagnostic.ts): start it, wait --passive-seconds for real-user
//   # keystrokes to be captured, then read the report. Zero captured
//   # samples is reported honestly as no-data, never faked.
//   node scripts/perf/measure-terminal-input.mjs --reference-cdp "$ORCA_REFERENCE_CDP"
//
// Per keystroke the in-page collector timestamps (a) key dispatch
// (capture-phase keydown on the xterm textarea, in-page performance.now)
// and (b) the echo parsed into the xterm buffer (onWriteParsed) and painted
// (first onRender after the parse). p50/p95 are reported per phase. A
// daemon-side pty-receive timestamp (c) has no log/test hook in protocol v1
// and is reported as unavailable rather than guessed; per-write bridge
// round-trips are not monkey-patched because the preload bridge is frozen
// (contextBridge Object.freeze) — backpressure shows up in the burst
// drain-tail metric instead.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { packagedFixtureDaemon } from "../packaged-fixture-daemon.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = args[i + 1];
  return next !== undefined && !next.startsWith("--") ? next : true;
};
function mode() {
  if (flag("reference-cdp", null)) return "reference";
  if (flag("bundle", null)) return "bundle";
  return null;
}
const KEYS = Number(flag("keys", "100"));
const PASSIVE_SECONDS = Number(flag("passive-seconds", "45"));
const OUT = flag("out", null);
const OPEN_TIMEOUT = 15000;

/** Nearest-rank percentile; a probe reports what it actually observed. */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, rank)];
}

/** Median/p95 summary over one numeric sample series (ms). */
export function summarizeValues(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  const sorted = [...finite].sort((a, b) => a - b);
  const round = (v) => (v === null ? null : Math.round(v * 10) / 10);
  return {
    unit: "ms",
    count: sorted.length,
    median: round(sorted.length ? percentile(sorted, 50) : null),
    p95: round(sorted.length ? percentile(sorted, 95) : null),
    max: round(sorted.length ? sorted[sorted.length - 1] : null),
  };
}

/**
 * Per-keystroke series from the in-page collector: dispatch→parsed and
 * dispatch→rendered latencies for every keystroke whose echo was observed.
 * Keystrokes without an observed echo are counted, never silently dropped.
 */
export function keystrokeSeries(samples) {
  const parsed = [];
  const rendered = [];
  let unmatched = 0;
  for (const sample of samples ?? []) {
    if (!Number.isFinite(sample?.dispatchAt)) continue;
    if (Number.isFinite(sample.parsedAt)) parsed.push(sample.parsedAt - sample.dispatchAt);
    if (Number.isFinite(sample.renderedAt)) rendered.push(sample.renderedAt - sample.dispatchAt);
    if (!Number.isFinite(sample.parsedAt)) unmatched += 1;
  }
  return {
    dispatchToParsed: summarizeValues(parsed),
    dispatchToRendered: summarizeValues(rendered),
    unmatchedEchoes: unmatched,
  };
}

async function connectEndpoint(endpoint) {
  const browser = await chromium.connectOverCDP(endpoint);
  // A cold first run (bundled daemon spawn + schema init) can keep the
  // window pageless for well over ten seconds; wait like drogon-ui.mjs.
  let page = null;
  for (let i = 0; i < 360 && !page; i++) {
    const pages = browser.contexts().flatMap((c) => c.pages());
    page =
      pages.find((p) => p.url().startsWith("file:")) ??
      pages.find((p) => !/^https?:/.test(p.url())) ??
      pages[0] ??
      null;
    if (!page) await delay(250);
  }
  if (!page) throw new Error("no renderer page on this endpoint");
  // Background windows run unfocused; emulate focus so :focus styling and
  // hasFocus() behave as for a real user (same as scripts/qa/drogon-ui.mjs).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  page.setDefaultTimeout(OPEN_TIMEOUT);
  return { browser, page };
}

/** Spawns the packaged bundle with an isolated data/profile pair. */
async function spawnBundle(bundle, dataDir, profileDir) {
  const executable = path.join(bundle, "Contents", "MacOS", "Drogon");
  if (!existsSync(executable)) throw new Error(`not a packaged Drogon bundle: ${bundle}`);
  await mkdir(dataDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });
  const child = spawn(executable, ["--remote-debugging-port=0"], {
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: profileDir,
      DROGON_BACKGROUND_WINDOW: "1",
    },
  });
  child.unref();
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timeout = setTimeout(() => reject(new Error(`no debugging endpoint: ${tail.slice(-500)}`)), 45000);
    child.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Electron exited before publishing an endpoint"));
    });
    child.stderr.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-8192);
      const match = tail.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
  return { pid: child.pid, endpoint };
}

async function stopPid(pid) {
  if (!pid) return false;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return false;
    }
  }
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await delay(200);
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  return false;
}

/** Synchronous drogon-cli call against the bundle's daemon. */
function cliJson(cliBin, dataDir, argv) {
  const child = spawnSync(cliBin, ["--data-dir", dataDir, "--json", ...argv], { encoding: "utf8" });
  if (child.status !== 0) throw new Error(`cli ${argv[0]} exited ${child.status}: ${child.stderr?.slice(0, 300)}`);
  const envelope = JSON.parse(String(child.stdout ?? ""));
  if (!envelope.ok) throw new Error(`cli ${argv[0]}: ${envelope.error?.message ?? "failed"}`);
  return envelope.result ?? {};
}

/**
 * Ensures the typing fixtures exist: one git project (added from
 * --fixture-repo when the data dir has none), one worktree, one workspace,
 * and exactly one live echo session running /bin/cat (canonical-mode tty:
 * the kernel echoes every keystroke, so the echo is pure pty round-trip
 * with no program logic). Returns the workspace id and worktree card name.
 */
function ensureFixtures(cliBin, dataDir, options) {
  let workspaces = cliJson(cliBin, dataDir, ["workspace", "list"]).workspaces ?? [];
  let workspace = workspaces.find((w) => w.kind === "git") ?? workspaces[0] ?? null;
  let worktreeName = options.worktreeName ?? null;
  let created = false;
  if (!workspace) {
    if (!options.fixtureRepo) {
      throw new Error("no workspace registered: pass --fixture-repo <git checkout> to create the fixtures");
    }
    const projects = cliJson(cliBin, dataDir, ["project", "list"]).projects ?? [];
    let project = projects.find((p) => p.kind === "git") ?? projects[0] ?? null;
    if (!project) project = cliJson(cliBin, dataDir, ["project", "add", options.fixtureRepo]);
    worktreeName = `typelat-wt-${Date.now().toString(36)}`;
    const worktree = cliJson(cliBin, dataDir, ["worktree", "create", "--project", project.id, "--name", worktreeName]);
    workspace = cliJson(cliBin, dataDir, ["workspace", "add", worktree.path]);
    created = true;
  }
  const listed = cliJson(cliBin, dataDir, ["terminal", "list", "--workspace", workspace.id]).sessions ?? [];
  if (!listed.some((s) => s.verdict === "live")) {
    cliJson(cliBin, dataDir, ["terminal", "create", "--workspace", workspace.id, "--", "/bin/cat"]);
    created = true;
  }
  if (!worktreeName) {
    try {
      const projects = cliJson(cliBin, dataDir, ["project", "list"]).projects ?? [];
      for (const project of projects) {
        const worktrees = cliJson(cliBin, dataDir, ["worktree", "list", "--project", project.id]).worktrees ?? [];
        const match = worktrees.find((w) => w.branch || w.title) ?? null;
        if (match) {
          worktreeName = match.title || match.branch;
          break;
        }
      }
    } catch {
      // Selection stays skipped; the probe records the gap honestly.
    }
  }
  return { workspaceId: workspace.id, worktreeName, created };
}

/** Selects the worktree card so the sessions page shows the terminal tab. */
async function selectWorktree(page, worktreeName) {
  if (!worktreeName) return "skipped";
  const target = page.getByText(worktreeName).first();
  try {
    await target.waitFor({ state: "visible", timeout: 30000 });
  } catch {
    return "no-card";
  }
  await target.click();
  const tabs = await page
    .getByTestId("sortable-tab")
    .first()
    .waitFor({ state: "visible", timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  return tabs ? "selected" : "no-tabs";
}

/**
 * Installs the in-page collector on the single live xterm (the
 * `window.__drogonTerminals` debug registry — the WebGL renderer leaves no
 * DOM text). Keystrokes are captured on the xterm textarea (capture phase,
 * in-page clock); echoes are matched as the longest common prefix of the
 * reconstructed buffer stream against the typed sequence (/bin/cat echoes
 * exactly what was typed, so the LCP advances monotonically). The collector
 * is cumulative for the whole run so phase boundaries are index slices,
 * never state resets. Returns "missing" when no live terminal exists yet,
 * "remounted" when the registry swapped terminals (caller must re-install).
 */
async function installCollector(page) {
  return page.evaluate(() => {
    const registry = window.__drogonTerminals;
    if (!registry || registry.size === 0) return "missing";
    const terminal = [...registry.values()][0];
    if (!terminal.element?.isConnected || !terminal.textarea?.isConnected) return "missing";
    if (window.__drogonTypingProbe?.terminal === terminal) return "installed";
    if (window.__drogonTypingProbe) return "remounted";
    const probe = {
      terminal,
      typed: "",
      // Per keystroke: dispatchAt from the capture-phase keydown; parsedAt /
      // renderedAt stamped when the echo prefix reaches this char's index.
      samples: [],
      // Diagnostic counters: keydowns seen by the capture listener vs data
      // events xterm actually emitted (a gap means xterm vetoed the key;
      // data without echo means the pty/write side dropped it).
      keydowns: 0,
      dataEvents: 0,
    };
    terminal.onData(() => {
      probe.dataEvents += 1;
    });
    const bufferStream = () => {
      const buffer = terminal.buffer.active;
      let text = "";
      for (let row = 0; row < buffer.length; row += 1) {
        text += buffer.getLine(row)?.translateToString(true) ?? "";
      }
      return text;
    };
    let matchedParsed = 0;
    let matchedRendered = 0;
    const echoPrefixLength = () => {
      const stream = bufferStream();
      const typed = probe.typed;
      let k = 0;
      while (k < stream.length && k < typed.length && stream[k] === typed[k]) k += 1;
      return k;
    };
    const stampParsed = () => {
      const k = echoPrefixLength();
      if (k <= matchedParsed) return;
      const now = performance.now();
      for (let i = matchedParsed; i < k; i += 1) {
        const sample = probe.samples[i];
        if (sample && sample.parsedAt === undefined) sample.parsedAt = now;
      }
      matchedParsed = k;
    };
    const stampRendered = () => {
      // The render can only paint what the parser already saw, but each
      // field keeps its own prefix cursor: sharing one would suppress the
      // rendered stamp for chars the parse stamp just claimed.
      const k = Math.min(echoPrefixLength(), matchedParsed);
      if (k <= matchedRendered) return;
      const now = performance.now();
      for (let i = matchedRendered; i < k; i += 1) {
        const sample = probe.samples[i];
        if (sample && sample.renderedAt === undefined) sample.renderedAt = now;
      }
      matchedRendered = k;
    };
    terminal.onWriteParsed(() => {
      stampParsed();
      // First paint of the parsed echo: onRender fires after the frame the
      // parser fed, so this is the user-visible echo moment.
      const disposable = terminal.onRender(() => {
        disposable.dispose();
        stampRendered();
      });
    });
    terminal.textarea.addEventListener(
      "keydown",
      (event) => {
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
        probe.keydowns += 1;
        probe.typed += event.key;
        probe.samples.push({ key: event.key, dispatchAt: performance.now() });
      },
      { capture: true },
    );
    window.__drogonTypingProbe = probe;
    return "installed";
  });
}

/** Deterministic pseudo-random printable char (no spaces/quotes). */
function keyFor(index) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return alphabet[(index * 7 + 3) % alphabet.length];
}

/** Types `count` keys starting at sequence `offset` with `gapMs` between. */
async function typeKeys(page, offset, count, gapMs) {
  for (let i = 0; i < count; i += 1) {
    await page.keyboard.press(keyFor(offset + i));
    if (gapMs > 0) await delay(gapMs);
  }
}

/** Current collector size (keystrokes seen) and echoed count. */
async function collectorProgress(page) {
  return page.evaluate(() => {
    const probe = window.__drogonTypingProbe;
    if (!probe) return { samples: 0, echoed: 0 };
    return {
      samples: probe.samples.length,
      echoed: probe.samples.filter((s) => s.renderedAt !== undefined).length,
      keydowns: probe.keydowns,
      dataEvents: probe.dataEvents,
    };
  });
}

/** Diagnostic snapshot for a dead warmup: focus, registry, buffer tail. */
async function collectorDiagnostics(page) {
  return page.evaluate(() => {
    const registry = window.__drogonTerminals;
    const probe = window.__drogonTypingProbe;
    const terminal = probe?.terminal;
    let tail = "";
    if (terminal) {
      const buffer = terminal.buffer.active;
      for (let row = 0; row < Math.min(buffer.length, 3); row += 1) {
        tail += buffer.getLine(row)?.translateToString(true) ?? "";
      }
    }
    return {
      registrySize: registry?.size ?? -1,
      probeOnLiveTerminal: terminal ? [...(registry?.values() ?? [])].includes(terminal) : false,
      textareaFocused: document.activeElement === terminal?.textarea,
      activeElement: document.activeElement?.className ?? null,
      keydowns: probe?.keydowns ?? 0,
      dataEvents: probe?.dataEvents ?? 0,
      typed: probe?.typed?.length ?? 0,
      bufferTail: tail,
    };
  });
}

/** Waits until the echo prefix covers `expected` keystrokes. */
async function waitForEchoes(page, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const progress = await collectorProgress(page);
    if (progress.echoed >= expected) return true;
    await delay(100);
  }
  return false;
}

/** Pulls the cumulative collector (no reset; phases are index slices). */
async function drainCollector(page) {
  return page.evaluate(() => {
    const probe = window.__drogonTypingProbe;
    return probe ? { samples: probe.samples, typed: probe.typed.length } : null;
  });
}

async function main() {
  const MODE = mode();
  if (!MODE) {
    console.error(
      "usage: measure-terminal-input.mjs (--reference-cdp <url> | --bundle <app>) [--keys N] [--passive-seconds N] [--out <f>]",
    );
    process.exit(1);
  }
  const startedAt = new Date().toISOString();
  if (MODE === "reference") {
    const url = String(flag("reference-cdp"));
    const res = await fetch(`${url}/json/version`).catch(() => null);
    if (!res?.ok) throw new Error(`reference CDP unreachable at ${url}`);
    // Attach read-only: this mode never types, reloads, or stops the
    // instance. It drives only the fork's own devtools probe.
    const { browser, page } = await connectEndpoint((await res.json()).webSocketDebuggerUrl);
    const hasProbe = await page.evaluate(() => typeof window.__orcaTypingDiagnostic?.start === "function");
    if (!hasProbe) {
      const report = {
        app: "orca-drogon-reference",
        mode: MODE,
        startedAt,
        state: "no-typing-diagnostic",
        note: "window.__orcaTypingDiagnostic is absent on this reference build; no passive samples could be collected without typing (typing is prohibited on the live instance).",
        metrics: {},
      };
      console.log(JSON.stringify(report, null, 2));
      if (OUT) await writeFile(path.resolve(OUT), JSON.stringify(report, null, 2) + "\n");
      await browser.close();
      return;
    }
    await page.evaluate(() => window.__orcaTypingDiagnostic.start());
    console.error(`passive capture: waiting ${PASSIVE_SECONDS}s for real-user keystrokes (this mode never types)`);
    await delay(PASSIVE_SECONDS * 1000);
    const fork = await page.evaluate(() => {
      const report = window.__orcaTypingDiagnostic.report();
      window.__orcaTypingDiagnostic.stop();
      return report;
    });
    const exact = fork?.exact ?? {};
    const sampled = (fork?.sampling?.exactInputs ?? 0) + (fork?.sampling?.ambiguousInputs ?? 0) > 0;
    const report = {
      app: "orca-drogon-reference",
      mode: MODE,
      startedAt,
      state: sampled ? "passive-samples" : "no-passive-samples",
      note: sampled
        ? "Captured by the fork's own __orcaTypingDiagnostic from real-user keystrokes; this script never typed into the reference."
        : "No real-user keystrokes arrived during the passive window; typing into the live reference is prohibited, so the fork's numbers stay unmeasured here.",
      passiveSeconds: PASSIVE_SECONDS,
      sampling: fork?.sampling ?? null,
      metrics: {
        inputToPaintMs: exact.inputToPaintMs ?? null,
        inputToDispatchMs: exact.inputToDispatchMs ?? null,
        dispatchToParseMs: exact.dispatchToParseMs ?? null,
        parseToPaintMs: exact.parseToPaintMs ?? null,
      },
      census: fork?.census ?? null,
    };
    console.log(JSON.stringify(report, null, 2));
    if (OUT) await writeFile(path.resolve(OUT), JSON.stringify(report, null, 2) + "\n");
    await browser.close();
    return;
  }

  // MODE === "bundle": harness-owned lifecycle on an isolated data dir.
  const bundle = path.resolve(String(flag("bundle")));
  const dataDir = path.resolve(String(flag("data-dir", path.join("/tmp", "drogon-typelat-data"))));
  const profileDir = path.resolve(String(flag("profile-dir", path.join("/tmp", "drogon-typelat-profile"))));
  const cliBin = path.join(bundle, "Contents", "Resources", "bin", "drogon-cli");
  const fixtureOptions = {
    fixtureRepo: flag("fixture-repo", null) ? path.resolve(String(flag("fixture-repo"))) : null,
    worktreeName: flag("worktree-name", null) ? String(flag("worktree-name")) : null,
  };
  const pacedCount = Math.ceil(KEYS * 0.6);
  const burstCount = KEYS - pacedCount;

  const stopInstance = async (browser, pid) => {
    await browser.close();
    await stopPid(pid);
    // Bundle mode never started a daemon of its own: the packaged app
    // bootstrapped its bundled one, so shut it down quiescently through the
    // same helper the sealed acceptance uses.
    try {
      const fixture = packagedFixtureDaemon(null, cliBin, dataDir);
      await fixture.capture();
      await fixture.stop();
    } catch (error) {
      console.error(`daemon shutdown: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Setup spawn (unmeasured): fixtures must exist before the measured spawn
  // so the terminal pane never remounts mid-measurement (a mid-startup CLI
  // creation races the sidebar digest and swaps the xterm instance under
  // the collector). Only the Electron app stops here — the daemon and its
  // live sessions survive by design (session survival), so the measured
  // spawn reattaches to the still-live echo session.
  {
    const setup = await spawnBundle(bundle, dataDir, profileDir);
    const { browser, page } = await connectEndpoint(setup.endpoint);
    const fixtures = ensureFixtures(cliBin, dataDir, fixtureOptions);
    fixtureOptions.worktreeName = fixtures.worktreeName;
    fixtureOptions.workspaceId = fixtures.workspaceId;
    console.error(`fixtures: workspace=${fixtures.workspaceId} worktree=${fixtures.worktreeName} created=${fixtures.created}`);
    await browser.close();
    await stopPid(setup.pid);
    // Let the setup daemon settle its endpoint lock before the measured
    // spawn reattaches (an overlapping shutdown can strand the first reads).
    await delay(2000);
  }

  const spawned = await spawnBundle(bundle, dataDir, profileDir);
  const { browser, page } = await connectEndpoint(spawned.endpoint);
  try {
    console.error(`select: ${await selectWorktree(page, fixtureOptions.worktreeName)}`);
    // Make the terminal pane visible and focused.
    await page.getByTestId("sortable-tab").first().click().catch(() => {});
    await page.locator(".xterm").first().waitFor({ state: "visible", timeout: 30000 });
    let installed = "missing";
    for (let i = 0; i < 40 && installed !== "installed"; i += 1) {
      installed = await installCollector(page);
      if (installed === "remounted") throw new Error("terminal remounted under the collector");
      if (installed !== "installed") await delay(250);
    }
    await page.evaluate(() => {
      const terminal = [...window.__drogonTerminals.values()][0];
      terminal.focus();
    });
    await delay(300);

    // Warmup: proves the keystroke→echo loop before measuring (a cold pane
    // still seeking its replay tail would otherwise poison the first keys).
    // Focus through a real pointer click — the same path a user takes.
    await page.locator(".xterm").first().click({ position: { x: 200, y: 100 } });
    await typeKeys(page, 0, 3, 80);
    if (!(await waitForEchoes(page, 3, 10000))) {
      console.error("warmup diagnostics:", JSON.stringify(await collectorDiagnostics(page)));
      console.error(
        "warmup dom:",
        JSON.stringify(await page.evaluate(() => document.body.innerText.slice(0, 500))),
      );
      try {
        const listed = cliJson(cliBin, dataDir, ["terminal", "list", "--workspace", fixtureOptions.workspaceId ?? ""]);
        console.error(
          "warmup sessions:",
          JSON.stringify((listed.sessions ?? []).map((s) => ({ verdict: s.verdict, agentState: s.agentState }))),
        );
      } catch (error) {
        console.error(`warmup session list failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      throw new Error("warmup echoes never rendered; the keystroke loop is not live");
    }

    // Phase 1 (paced): 50 ms between keys — interactive typing.
    await typeKeys(page, 3, pacedCount, 50);
    await waitForEchoes(page, 3 + pacedCount, 15000);

    // Phase 2 (burst): no gap — backpressure/coalescing behavior.
    await typeKeys(page, 3 + pacedCount, burstCount, 0);
    const burstSentAt = Date.now();
    const settled = await waitForEchoes(page, 3 + pacedCount + burstCount, 20000);
    const drainTailMs = Date.now() - burstSentAt;

    const drained = await drainCollector(page);
    const all = drained?.samples ?? [];
    const paced = keystrokeSeries(all.slice(3, 3 + pacedCount));
    const burst = keystrokeSeries(all.slice(3 + pacedCount, 3 + pacedCount + burstCount));
    const report = {
      app: "drogon-bundle",
      mode: MODE,
      bundle,
      startedAt,
      keys: KEYS,
      warmupKeys: 3,
      phases: { paced: pacedCount, burst: burstCount, pacedGapMs: 50 },
      daemonPtyReceive: "unavailable: protocol v1 has no write-timestamp log/test hook",
      metrics: {
        "paced:dispatch-to-parsed": paced.dispatchToParsed,
        "paced:dispatch-to-rendered": paced.dispatchToRendered,
        "paced:unmatched-echoes": paced.unmatchedEchoes,
        "burst:dispatch-to-rendered": burst.dispatchToRendered,
        "burst:unmatched-echoes": burst.unmatchedEchoes,
        "burst:drain-tail": {
          unit: "ms",
          // Wall time from the last burst key to the last observed echo;
          // includes the probe's own 100 ms settle poll granularity.
          ms: settled ? drainTailMs : null,
          state: settled ? "settled" : "echo-timeout",
        },
      },
    };
    console.log(JSON.stringify(report, null, 2));
    if (OUT) await writeFile(path.resolve(OUT), JSON.stringify(report, null, 2) + "\n");
  } finally {
    await stopInstance(browser, spawned.pid);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
