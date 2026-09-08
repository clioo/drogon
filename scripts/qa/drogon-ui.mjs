#!/usr/bin/env node
// Hands for a QA agent: start the built desktop app from this checkout and
// drive it through its accessibility tree over CDP, one shell command at a
// time. No test scripts: the agent decides what to do from `snapshot` output.
//
//   node scripts/qa/drogon-ui.mjs start            # daemon + Electron (background window), writes .qa/session.json
//   node scripts/qa/drogon-ui.mjs landmarks                 # selectors you can pass to snapshot --selector
//   node scripts/qa/drogon-ui.mjs snapshot [--selector <css>] [--max-lines N]
//   node scripts/qa/drogon-ui.mjs click <role> <name> [--nth N] [--exact] [--right] [--double]
//   node scripts/qa/drogon-ui.mjs click-text <text> [--exact]
//   node scripts/qa/drogon-ui.mjs fill <role> <name> <text>
//   node scripts/qa/drogon-ui.mjs type <text>      # keyboard.type into the focused element
//   node scripts/qa/drogon-ui.mjs press <key>      # keyboard.press, e.g. Meta+J, Enter, Escape, Meta+Shift+E
//   node scripts/qa/drogon-ui.mjs wait <role> <name> [--timeout ms] [--hidden]
//   node scripts/qa/drogon-ui.mjs text [--selector <css>]
//   node scripts/qa/drogon-ui.mjs terminal-text    # text of the active terminal buffer (xterm registry)
//   node scripts/qa/drogon-ui.mjs screenshot <file.png>
//   node scripts/qa/drogon-ui.mjs eval <js>        # page.evaluate; use sparingly
//   node scripts/qa/drogon-ui.mjs cli <args...>    # drogon-cli against the QA daemon's data dir
//   node scripts/qa/drogon-ui.mjs status
//   node scripts/qa/drogon-ui.mjs stop [--wipe]    # kills only the PIDs it started; --wipe removes .qa data/profile
//
// Packaged mode drives a sealed bundle exactly like a first-time user machine:
// no separately managed daemon (the packaged app bootstraps its bundled one
// itself), isolated bundle data/profile dirs, and a quiescent daemon shutdown
// on stop (the same helper the sealed acceptance uses):
//
//   node scripts/qa/drogon-ui.mjs start --bundle <Drogon.app>
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile, open as openFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { packagedFixtureDaemon } from "../packaged-fixture-daemon.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const appDir = path.join(root, "apps", "desktop");
const qaDir = path.join(root, ".qa");
const sessionFile = path.join(qaDir, "session.json");
const exe = (name) => (process.platform === "win32" ? `${name}.exe` : name);
const daemonBin = path.join(root, "target", "debug", exe("drogond"));
const cliBin = path.join(root, "target", "debug", exe("drogon-cli"));
// Additive (R16-Z): `--bundle <Drogon.app>` drives the sealed packaged app
// instead of the dev build. Only `start` reads it; every other command
// follows the recorded session mode.
const bundleFlagIndex = process.argv.indexOf("--bundle");
const bundlePath =
  bundleFlagIndex !== -1 ? path.resolve(process.argv[bundleFlagIndex + 1] ?? "") : null;
if (bundleFlagIndex !== -1 && !bundlePath) {
  console.error("usage: drogon-ui.mjs start --bundle <Drogon.app>");
  process.exit(1);
}
/** Packaged executable inside a macOS bundle (packaged acceptance is darwin-only). */
function bundledExecutable(bundle) {
  return path.join(bundle, "Contents", "MacOS", "Drogon");
}
/** The daemon/CLI pair the bundle ships in its own Resources. */
function bundledCli(bundle) {
  return path.join(bundle, "Contents", "Resources", "bin", "drogon-cli");
}

const [, , command, ...rest] = process.argv;
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  const arg = rest[i];
  if (arg.startsWith("--")) {
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (["selector", "max-lines", "nth", "timeout", "bundle"].includes(key) && next !== undefined) {
      flags[key] = next;
      i++;
    } else flags[key] = true;
  } else positional.push(arg);
}

function die(message) {
  console.error(message);
  process.exit(1);
}

async function readSession() {
  if (!existsSync(sessionFile)) die("No QA session: run `start` first.");
  return JSON.parse(await readFile(sessionFile, "utf8"));
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Authenticated daemon identity for a bundle session (the packaged app
 * spawned its own daemon; no PID was ever recorded). Null when unreachable.
 */
async function bundledDaemonIdentity(session) {
  if (session.mode !== "bundle" || !session.cliBin) return null;
  const result = spawnSync(
    session.cliBin,
    ["--data-dir", session.dataDir, "--json", "status"],
    { encoding: "utf8" },
  );
  const envelope = JSON.parse(String(result.stdout ?? ""));
  return envelope.ok === true ? envelope.result : null;
}

async function start() {
  if (existsSync(sessionFile)) {
    const prior = JSON.parse(await readFile(sessionFile, "utf8"));
    if (alive(prior.electronPid) || (prior.daemonPid && alive(prior.daemonPid)))
      die("A QA session is already running; `stop` it first.");
  }
  const packaged = bundlePath;
  if (packaged) {
    if (process.platform !== "darwin") die("--bundle packaged QA currently targets macOS");
    if (!existsSync(bundledExecutable(packaged))) die(`Not a packaged Drogon bundle: ${packaged}`);
    if (!existsSync(bundledCli(packaged))) die(`Bundle ships no drogon-cli: ${packaged}`);
  } else {
    if (!existsSync(daemonBin)) die(`Missing ${daemonBin}: run cargo build -p drogond -p drogon-cli`);
    if (!existsSync(path.join(appDir, "out", "main", "index.js")))
      die("Missing apps/desktop/out: run pnpm --filter @drogon/desktop build");
  }
  // Bundle runs keep their own data/profile/logs so packaged first-run
  // walkthroughs never touch dev QA state (and vice versa).
  const dataDir = path.join(qaDir, packaged ? "bundle-data" : "data");
  const profileDir = path.join(qaDir, packaged ? "bundle-profile" : "profile");
  const logDir = path.join(qaDir, "logs");
  await mkdir(dataDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });
  await mkdir(logDir, { recursive: true });
  // The packaged app bootstraps its bundled daemon itself (isPackaged
  // runtime bootstrap); only dev mode manages a separate daemon here.
  let daemon = null;
  if (!packaged) {
    const daemonLog = await openFile(path.join(logDir, "drogond.log"), "a");
    daemon = spawn(daemonBin, ["--data-dir", dataDir], {
      detached: true,
      stdio: ["ignore", daemonLog.fd, daemonLog.fd],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    });
    daemon.unref();
  }
  const electron = packaged
    ? bundledExecutable(packaged)
    : createRequire(path.join(appDir, "package.json"))("electron");
  const electronLog = await openFile(path.join(logDir, packaged ? "electron-bundle.log" : "electron.log"), "a");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, packaged ? ["--remote-debugging-port=0"] : [appDir, "--remote-debugging-port=0"], {
    detached: true,
    stdio: ["ignore", electronLog.fd, "pipe"],
    env: {
      ...env,
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: profileDir,
      DROGON_BACKGROUND_WINDOW: "1",
    },
  });
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timeout = setTimeout(
      () => reject(new Error(`Electron did not publish a debugging endpoint: ${tail}`)),
      30000,
    );
    child.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error(`Electron exited before connection: ${tail}`));
    });
    child.stderr.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-8192);
      electronLog.write(bytes).catch(() => {});
      const match = tail.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
  child.stderr.on("data", (bytes) => electronLog.write(bytes).catch(() => {}));
  child.unref();
  const cli = packaged ? bundledCli(packaged) : cliBin;
  const session = {
    startedAt: new Date().toISOString(),
    mode: packaged ? "bundle" : "dev",
    ...(packaged ? { bundle: packaged } : {}),
    endpoint,
    dataDir,
    profileDir,
    daemonPid: daemon ? daemon.pid : null,
    electronPid: child.pid,
    cliBin: cli,
    cli: `${cli} --data-dir ${dataDir}`,
  };
  await writeFile(sessionFile, JSON.stringify(session, null, 2) + "\n");
  const { page, browser } = await connect(session);
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor({ timeout: 30000 })
    .catch(() => {});
  await browser.close();
  console.log(JSON.stringify(session, null, 2));
  process.exit(0);
}

async function connect(session) {
  const browser = await chromium.connectOverCDP(session.endpoint);
  let page = null;
  // A cold first run (bundled daemon spawn + schema init) can keep the
  // window pageless for well over ten seconds on a loaded machine; the
  // sealed acceptance met the same wall, so wait generously here.
  for (let i = 0; i < 360 && !page; i++) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    page = pages.find((candidate) => !/^https?:/.test(candidate.url())) ?? pages[0] ?? null;
    if (!page) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!page) die("Electron has no page yet.");
  // The window runs unfocused (DROGON_BACKGROUND_WINDOW=1); emulate page
  // focus so :focus styling and hasFocus() behave as for a real user.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  page.setDefaultTimeout(Number(flags.timeout ?? 10000));
  return { browser, page };
}

async function withPage(fn) {
  const session = await readSession();
  const { browser, page } = await connect(session);
  try {
    await fn(page, session);
  } finally {
    await browser.close();
  }
}

async function locator(page, role, name) {
  const options = { name, exact: Boolean(flags.exact) };
  const all = page.getByRole(role, options);
  const count = await all.count();
  if (count === 0) {
    const names = await page
      .getByRole(role)
      .evaluateAll((nodes) =>
        nodes
          .map((node) => node.getAttribute("aria-label") || node.textContent?.trim() || "")
          .filter(Boolean)
          .slice(0, 40),
      )
      .catch(() => []);
    die(`No ${role} named "${name}". ${role} names on screen: ${JSON.stringify(names)}`);
  }
  if (flags.nth !== undefined) return all.nth(Number(flags.nth));
  if (count > 1) console.error(`note: ${count} ${role}s match "${name}"; using the first (pass --nth N to choose)`);
  return all.first();
}

/** Landmarks the agent can pass to --selector: roles and labelled regions. */
async function landmarks(page) {
  return page.evaluate(() => {
    const out = [];
    const seen = new Set();
    for (const node of document.querySelectorAll("main, nav, header, footer, section, [role], [data-testid]")) {
      const role = node.getAttribute("role");
      const label = node.getAttribute("aria-label");
      const testId = node.getAttribute("data-testid");
      const tag = node.tagName.toLowerCase();
      let selector = null;
      if (testId) selector = `[data-testid="${testId}"]`;
      else if (label && role) selector = `[role="${role}"][aria-label="${label}"]`;
      else if (label) selector = `${tag}[aria-label="${label}"]`;
      else if (["main", "nav", "header", "footer"].includes(tag)) selector = tag;
      else if (role && ["dialog", "tablist", "menu", "listbox", "region", "complementary", "navigation"].includes(role))
        selector = `[role="${role}"]`;
      if (!selector || seen.has(selector)) continue;
      seen.add(selector);
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      out.push(`${selector}  (${Math.round(rect.width)}x${Math.round(rect.height)})`);
    }
    return out.slice(0, 80);
  });
}

const commands = {
  start,
  async status() {
    if (!existsSync(sessionFile)) return console.log("no session");
    const session = JSON.parse(await readFile(sessionFile, "utf8"));
    const daemon = await bundledDaemonIdentity(session).catch(() => null);
    console.log(
      JSON.stringify(
        {
          ...session,
          daemonAlive:
            session.mode === "bundle" ? daemon !== null : alive(session.daemonPid),
          electronAlive: alive(session.electronPid),
        },
        null,
        2,
      ),
    );
  },
  async stop() {
    if (!existsSync(sessionFile)) return console.log("no session");
    const session = JSON.parse(await readFile(sessionFile, "utf8"));
    for (const pid of [session.electronPid, session.daemonPid].filter(Boolean)) {
      if (!alive(pid)) continue;
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        try {
          process.kill(pid, "SIGTERM");
        } catch {}
      }
    }
    const deadline = Date.now() + 8000;
    while (
      Date.now() < deadline &&
      (alive(session.electronPid) || (session.daemonPid && alive(session.daemonPid)))
    )
      await new Promise((resolve) => setTimeout(resolve, 200));
    for (const pid of [session.electronPid, session.daemonPid].filter(Boolean)) {
      if (!alive(pid)) continue;
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
    }
    // Bundle mode never started a daemon of its own: the packaged app
    // bootstrapped its bundled one, so shut it down quiescently through
    // the same helper the sealed acceptance uses (stops live sessions,
    // asks for shutdown, kernel-verifies the exit).
    let daemonShutdown = "dev-managed";
    if (session.mode === "bundle") {
      try {
        const fixture = packagedFixtureDaemon(null, session.cliBin, session.dataDir);
        await fixture.capture();
        await fixture.stop();
        daemonShutdown = "quiescent-shutdown-exited";
      } catch (error) {
        daemonShutdown = `unverifiable: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    await rm(sessionFile, { force: true });
    if (flags.wipe) {
      await rm(session.dataDir, { recursive: true, force: true });
      await rm(session.profileDir, { recursive: true, force: true });
    }
    console.log(
      JSON.stringify({
        stopped: true,
        electronAlive: alive(session.electronPid),
        daemonAlive:
          session.mode === "bundle"
            ? (await bundledDaemonIdentity(session).catch(() => null)) !== null
            : session.daemonPid
              ? alive(session.daemonPid)
              : false,
        daemonShutdown,
        wiped: Boolean(flags.wipe),
      }),
    );
  },
  async landmarks() {
    await withPage(async (page) => {
      console.log((await landmarks(page)).join("\n"));
    });
  },
  async snapshot() {
    await withPage(async (page) => {
      const selector = flags.selector ?? "body";
      if ((await page.locator(selector).count()) === 0) {
        console.error(`No element matches ${selector}. Visible landmarks you can use with --selector:`);
        console.error((await landmarks(page)).join("\n"));
        process.exit(1);
      }
      const snapshot = await page.locator(selector).first().ariaSnapshot();
      const lines = snapshot.split("\n");
      const max = Number(flags["max-lines"] ?? 400);
      console.log(lines.slice(0, max).join("\n"));
      if (lines.length > max) console.log(`... (${lines.length - max} more lines; use --selector or --max-lines)`);
    });
  },
  async click() {
    const [role, name] = positional;
    if (!role || !name) die("usage: click <role> <name> [--nth N] [--exact] [--right] [--double]");
    await withPage(async (page) => {
      const target = await locator(page, role, name);
      if (flags.double) await target.dblclick();
      else await target.click({ button: flags.right ? "right" : "left" });
      console.log(`clicked ${role} "${name}"`);
    });
  },
  async "click-text"() {
    const [text] = positional;
    if (!text) die("usage: click-text <text> [--exact]");
    await withPage(async (page) => {
      await page.getByText(text, { exact: Boolean(flags.exact) }).first().click();
      console.log(`clicked text "${text}"`);
    });
  },
  async fill() {
    const [role, name, text] = positional;
    if (!role || !name || text === undefined) die("usage: fill <role> <name> <text>");
    await withPage(async (page) => {
      await (await locator(page, role, name)).fill(text);
      console.log(`filled ${role} "${name}"`);
    });
  },
  async type() {
    const [text] = positional;
    if (text === undefined) die("usage: type <text>");
    await withPage(async (page) => {
      await page.keyboard.type(text);
      console.log(`typed ${text.length} chars`);
    });
  },
  async press() {
    const [key] = positional;
    if (!key) die("usage: press <key>");
    await withPage(async (page) => {
      await page.keyboard.press(key);
      console.log(`pressed ${key}`);
    });
  },
  async wait() {
    const [role, name] = positional;
    if (!role || !name) die("usage: wait <role> <name> [--timeout ms] [--hidden]");
    await withPage(async (page) => {
      await (await locator(page, role, name)).waitFor({
        state: flags.hidden ? "hidden" : "visible",
        timeout: Number(flags.timeout ?? 10000),
      });
      console.log(`${role} "${name}" is ${flags.hidden ? "hidden" : "visible"}`);
    });
  },
  async text() {
    await withPage(async (page) => {
      console.log(await page.locator(flags.selector ?? "body").innerText());
    });
  },
  async "terminal-text"() {
    await withPage(async (page) => {
      const text = await page.evaluate(() => {
        const registry = window.__drogonTerminals;
        if (!registry || registry.size === 0) return null;
        const terminal = [...registry.values()].at(-1);
        const buffer = terminal.buffer.active;
        const lines = [];
        for (let i = 0; i < buffer.length; i++) lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
        return lines.join("\n").replace(/\n+$/, "");
      });
      console.log(text ?? "(no terminal mounted)");
    });
  },
  async screenshot() {
    const [file] = positional;
    if (!file) die("usage: screenshot <file.png>");
    await withPage(async (page) => {
      await mkdir(path.dirname(path.resolve(file)), { recursive: true });
      await page.screenshot({ path: path.resolve(file), animations: "disabled" });
      console.log(`saved ${path.resolve(file)}`);
    });
  },
  async eval() {
    const [code] = positional;
    if (!code) die("usage: eval <js>");
    await withPage(async (page) => {
      const value = await page.evaluate(code);
      console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
    });
  },
  async cli() {
    const session = await readSession();
    const result = spawnSync(session.cliBin ?? cliBin, ["--data-dir", session.dataDir, ...rest], {
      stdio: "inherit",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    });
    process.exit(result.status ?? 1);
  },
};

if (!command || !commands[command]) {
  die(`usage: drogon-ui.mjs <${Object.keys(commands).join("|")}> ...`);
}
commands[command]().catch((error) => die(error?.message ?? String(error)));
