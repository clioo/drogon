// Hidden rendered regression for Cmd+Return in the terminal input path.
// Uses a deterministic PTY fixture (no model inference) and drives the real
// production TerminalPane/xterm handlers over CDP in a background Electron
// window. Artifacts land under .preflight/acceptance/terminal-command-return-*.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import {
  captureDescendants,
  runAcceptanceProcess,
  scrubInheritedDispatchBindings,
  settleOwnedProcesses,
  startAcceptanceProcess,
  stopAcceptanceProcess,
} from "./acceptance-process.mjs";
import { emulatePageFocus } from "./acceptance-page-focus.mjs";
import { terminalBufferText, waitForTerminalText } from "./acceptance-terminal-text.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps", "desktop");
const electron = createRequire(path.join(appDir, "package.json"))("electron");
const daemonBin = path.join(root, "target", "debug", process.platform === "win32" ? "drogond.exe" : "drogond");
const cliBin = path.join(root, "target", "debug", process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli");

const fixture = await mkdtemp(path.join(tmpdir(), "dtcr-"));
const dataDir = path.join(fixture, "data");
const profileDir = path.join(fixture, "electron");
const workspaceDir = path.join(fixture, "workspace");
const fixtureScript = path.join(fixture, "cmd-return-fixture.mjs");
const inputLog = path.join(fixture, "input.jsonl");
const output = path.join(root, ".preflight", "acceptance", `terminal-command-return-${Date.now()}`);
await mkdir(workspaceDir, { recursive: true });
await mkdir(output, { recursive: true });

const fixtureSource = String.raw`
import { appendFileSync } from "node:fs";
const log = process.env.DROGON_CMD_RETURN_LOG;
let submits = 0;
let previousRows = 0;
function line(text = "") { process.stdout.write(text + "\r\n"); }
function frame(label) {
  if (previousRows > 0) process.stdout.write("\x1b[" + previousRows + "A\r\x1b[J");
  const lines = [
    "⠿ Working " + label,
    "Thinking...",
    'con command + "enter / return"',
    "me duplica la vista, mira█",
  ];
  for (const value of lines) line(value);
  previousRows = lines.length;
}
process.stdin.setRawMode?.(true);
process.stdin.resume();
line("DROGON_CMD_RETURN_FIXTURE_READY");
frame("idle");
process.stdin.on("data", (chunk) => {
  appendFileSync(log, JSON.stringify({ hex: chunk.toString("hex"), text: chunk.toString("utf8") }) + "\n");
  for (const byte of chunk) {
    if (byte === 13) {
      submits += 1;
      frame("submit-" + submits);
    }
  }
});
process.on("SIGTERM", () => process.exit(0));
`;
await writeFile(fixtureScript, fixtureSource);

const report = {
  kind: "terminal-command-return-cdp",
  output,
  dataDir,
  profileDir,
  fixture,
  build: {},
  checks: [],
  screenshots: [],
  processes: {},
};

let daemon = null;
let desktop = null;
let browser = null;
let page = null;
const owned = new Map();

function cleanEnv(extra = {}) {
  const env = scrubInheritedDispatchBindings({ ...process.env });
  return {
    ...env,
    // Keep harness discovery on deterministic shell fixtures only; do not let
    // a hidden rendered check start the developer's installed coding agents.
    PATH: "/tmp/dg-toolchain-bin:/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    SDKROOT: "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
    CC_aarch64_apple_darwin: "/Library/Developer/CommandLineTools/usr/bin/clang",
    CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER: "/Library/Developer/CommandLineTools/usr/bin/clang",
    ...extra,
  };
}

async function cli(args, options = {}) {
  const result = await runAcceptanceProcess(cliBin, ["--data-dir", dataDir, "--json", ...args], {
    env: cleanEnv(),
    cwd: options.cwd ?? root,
    timeout: options.timeout ?? 15_000,
  });
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true, result.stdout || result.stderr);
  return parsed.result;
}

async function waitForDaemon() {
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      await cli(["status"], { timeout: 1000 });
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(50);
    }
  }
}

async function launchDesktop() {
  desktop = startAcceptanceProcess(electron, [appDir, "--remote-debugging-port=0"], {
    stdio: ["ignore", "ignore", "pipe"],
    env: cleanEnv({
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: profileDir,
      DROGON_BACKGROUND_WINDOW: "1",
      SHELL: "/bin/sh",
    }),
  });
  if (desktop.pid) owned.set(desktop.pid, `desktop:${desktop.spawnfile}`);
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timer = setTimeout(() => reject(new Error(`no debugging endpoint: ${tail}`)), 20_000);
    desktop.once("exit", () => reject(new Error(`electron exited before connecting: ${tail}`)));
    desktop.stderr.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-8192);
      const match = tail.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  for (let i = 0; i < 200 && !browser.contexts()[0]?.pages()[0]; i += 1) await delay(50);
  page = browser.contexts()[0].pages()[0];
  assert.ok(page, "Electron must create a page");
  await emulatePageFocus(page);
  page.setDefaultTimeout(20_000);
  await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor();
}

async function screenshot(name) {
  const file = path.join(output, name);
  await page.screenshot({ path: file, animations: "disabled" });
  report.screenshots.push(file);
}

async function readInputEntries() {
  if (!existsSync(inputLog)) return [];
  const text = await readFile(inputLog, "utf8");
  return text.trim() ? text.trim().split("\n").map((line) => JSON.parse(line)) : [];
}

try {
  report.build.gitHead = (await runAcceptanceProcess("/Library/Developer/CommandLineTools/usr/bin/git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  report.build.desktopOut = path.join(appDir, "out");
  daemon = startAcceptanceProcess(daemonBin, ["--data-dir", dataDir], {
    stdio: "ignore",
    env: cleanEnv(),
  });
  if (daemon.pid) owned.set(daemon.pid, `daemon:${daemon.spawnfile}`);
  await waitForDaemon();
  const workspace = await cli(["workspace", "add", workspaceDir, "--name", "Cmd Return Fixture"]);
  const session = await cli([
    "terminal",
    "create",
    "--workspace",
    workspace.id,
    "--",
    "/usr/bin/env",
    `DROGON_CMD_RETURN_LOG=${inputLog}`,
    process.execPath,
    fixtureScript,
  ], { cwd: workspaceDir });
  report.session = { id: session.id, incarnation: session.incarnation, workspaceId: workspace.id };

  await launchDesktop();
  await waitForTerminalText(page, "DROGON_CMD_RETURN_FIXTURE_READY", { timeout: 20_000 });
  await page.locator(".xterm-helper-textarea").first().focus();
  await screenshot("before-command-return.png");

  const eventTrace = await page.evaluate((sessionId) => {
    const terminal = window.__drogonTerminals?.get(sessionId) ?? [...(window.__drogonTerminals?.values?.() ?? [])][0];
    if (!terminal) throw new Error("terminal registry missing session");
    const data = [];
    const disposable = terminal.onData((chunk) => data.push(chunk));
    const target = document.querySelector(".xterm-helper-textarea");
    if (!target) throw new Error("terminal helper textarea missing");
    const bubbled = [];
    const onBubble = (event) => bubbled.push(event.type);
    window.addEventListener("keydown", onBubble);
    window.addEventListener("keypress", onBubble);
    window.addEventListener("keyup", onBubble);
    const events = [];
    try {
      for (const type of ["keydown", "keypress", "keyup"]) {
        const event = new KeyboardEvent(type, {
          key: "Enter",
          code: "Enter",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        });
        const accepted = target.dispatchEvent(event);
        events.push({ type, accepted, defaultPrevented: event.defaultPrevented });
      }
    } finally {
      window.removeEventListener("keydown", onBubble);
      window.removeEventListener("keypress", onBubble);
      window.removeEventListener("keyup", onBubble);
      disposable.dispose();
    }
    return { events, bubbled, data };
  }, session.id);
  report.eventTrace = eventTrace;
  assert.deepEqual(eventTrace.data, ["\r"], "one Cmd+Return gesture must emit exactly one CR from xterm");
  assert.deepEqual(eventTrace.events.map((event) => [event.type, event.defaultPrevented]), [
    ["keydown", true],
    ["keypress", true],
    ["keyup", true],
  ]);
  assert.deepEqual(eventTrace.bubbled, [], "claimed Cmd+Return events must not reach window shortcuts");
  report.checks.push("cmd-return-keydown-keypress-keyup-claimed-once");

  const deadline = Date.now() + 10_000;
  let entries = [];
  while (Date.now() < deadline) {
    entries = await readInputEntries();
    if (entries.length >= 1) break;
    await delay(50);
  }
  assert.deepEqual(entries.map((entry) => entry.hex), ["0d"], "fixture PTY must receive one Return byte");
  report.inputEntries = entries;
  report.checks.push("pty-received-one-return-byte");

  await waitForTerminalText(page, "Working submit-1", { timeout: 10_000 });
  const text = await terminalBufferText(page);
  const workingCount = (text.match(/Working submit-/g) ?? []).length;
  const thinkingCount = (text.match(/Thinking\.\.\./g) ?? []).length;
  assert.equal(workingCount, 1, text);
  assert.equal(thinkingCount, 1, text);
  assert.ok(text.includes('con command + "enter / return"'), text);
  report.terminalTail = text.slice(-2000);
  report.checks.push("rendered-buffer-has-one-working-and-one-thinking-row");
  await screenshot("after-command-return.png");

  const listed = await cli(["terminal", "list", "--workspace", workspace.id]);
  const matching = listed.sessions.filter((item) => item.id === session.id);
  assert.equal(matching.length, 1, "gesture must not create/split another terminal session");
  report.checks.push("no-extra-terminal-session-created");

  report.status = "PASSED";
} catch (error) {
  report.status = "FAILED";
  report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  try {
    if (page) await screenshot("failure.png");
  } catch {}
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch {}
  await captureDescendants([desktop?.pid, daemon?.pid].filter(Boolean), owned);
  if (desktop) report.processes.desktop = await stopAcceptanceProcess(desktop);
  if (daemon) report.processes.daemon = await stopAcceptanceProcess(daemon);
  report.processes.owned = await settleOwnedProcesses(owned);
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  if (report.status !== "PASSED") {
    console.error(JSON.stringify(report, null, 2));
  } else {
    console.log(JSON.stringify({ status: report.status, output, checks: report.checks, screenshots: report.screenshots, processes: report.processes }, null, 2));
  }
  if (report.status === "PASSED") await rm(fixture, { recursive: true, force: true });
}
