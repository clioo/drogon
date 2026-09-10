// bug-bot-a836b4ebf8be65505 acceptance proof: drives the REAL packaged-dev
// app (built renderer + real drogond) in a hidden background window,
// creates a Bot, clicks its real "Open session" button, and proves the
// resulting session (a) stays alive instead of exiting like the pre-fix
// headless one-shot, (b) renders the bot-scoped header/tab/inspector with
// REAL values, (c) genuinely converses (a second turn, not just the
// opening line), and (d) Stop actually terminates it.
//
// No real model inference anywhere: a plain shell script fixture stands in
// for the harness on drogond's PATH (this repo's established technique,
// see crates/drogon-core/tests/native_bot_run_shell_fixture.rs), read/echo
// loop instead of a real CLI. Runs in DROGON_BACKGROUND_WINDOW=1 with its
// own temporary DROGON_DATA_DIR/DROGON_ELECTRON_PROFILE — never the
// developer's running instance, never OS-activated.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import {
  startAcceptanceProcess,
  stopAcceptanceProcess,
} from "./acceptance-process.mjs";
import { emulatePageFocus } from "./acceptance-page-focus.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps", "desktop");
const appRequire = createRequire(path.join(appDir, "package.json"));
const electronBin = appRequire("electron");
const drogondBin = path.join(root, "target", "debug", "drogond");
assert.ok(
  existsSync(drogondBin),
  `drogond debug binary missing at ${drogondBin} -- run \`cargo build -p drogond\` first`,
);
assert.ok(
  existsSync(path.join(appDir, "out", "main", "index.js")),
  `apps/desktop/out missing -- run \`pnpm --filter @drogon/desktop exec electron-vite build\` first`,
);

const fixture = await mkdtemp(path.join(tmpdir(), "dgbot-"));
const dataDir = path.join(fixture, "data");
const electronProfile = path.join(fixture, "electron");
const fixtureBin = path.join(fixture, "bin");
const projectDir = path.join(fixture, "project-worktree");
const output = path.join(root, ".preflight", "bot-session-live", `${Date.now()}`);

// Self-contained (serialized into the page, same technique as
// scripts/probe-rendered-harness.mjs's renderedPiIsReady): the WebGL
// terminal renderer leaves no real DOM text, so rendered content is read
// from the debug registry TerminalPane.tsx keeps at window.__drogonTerminals.
function readRenderedTerminalText() {
  const registry = window.__drogonTerminals;
  if (!registry || registry.size === 0)
    return document.querySelector(".xterm-screen")?.textContent ?? "";
  const lines = [];
  for (const terminal of registry.values()) {
    const buffer = terminal.buffer.active;
    for (let row = 0; row < buffer.length; row += 1) {
      lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
    }
  }
  return lines.join("\n");
}

async function waitForRenderedTextIncludes(page, needle, timeout) {
  await page.waitForFunction(
    (text) => {
      const registry = window.__drogonTerminals;
      let rendered = "";
      if (!registry || registry.size === 0) {
        rendered = document.querySelector(".xterm-screen")?.textContent ?? "";
      } else {
        const lines = [];
        for (const terminal of registry.values()) {
          const buffer = terminal.buffer.active;
          for (let row = 0; row < buffer.length; row += 1) {
            lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
          }
        }
        rendered = lines.join("\n");
      }
      return rendered.includes(text);
    },
    needle,
    { timeout },
  );
}
await mkdir(dataDir, { recursive: true });
await mkdir(electronProfile, { recursive: true });
await mkdir(fixtureBin, { recursive: true });
await mkdir(projectDir, { recursive: true });
await mkdir(output, { recursive: true });

// Stands in for the harness's OWN interactive entrypoint: prints its cwd
// (proves the isolated home, not the project worktree) then genuinely
// converses over stdin -- proves the session is a real conversation, not
// just a one-shot echo before exit. `trap` so SIGTERM (session.stop) exits
// cleanly instead of needing SIGKILL.
const fixtureScript = `#!/bin/sh
echo "CWD=$(pwd)"
echo "Session live. Ready for instructions."
trap 'exit 0' TERM INT
while IFS= read -r line; do
  echo "you said: $line"
done
exit 0
`;
const fixturePath = path.join(fixtureBin, "pi");
await writeFile(fixturePath, fixtureScript);
await chmod(fixturePath, 0o755);

let drogond = null;
let desktop = null;
let browser = null;
let livePage = null;
const report = { checks: [], screenshots: [] };

async function waitForDaemonReady() {
  // The renderer's own "Reveal active workspace" readiness gate (below)
  // already proves the daemon answered; this just avoids hammering
  // Electron's connect retry ladder immediately after spawn.
  await delay(600);
}

async function main() {
  drogond = startAcceptanceProcess(drogondBin, ["--data-dir", dataDir], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: `${fixtureBin}:${process.env.PATH ?? ""}`,
    },
  });
  assert.ok(drogond.pid, "drogond must report a pid");
  await waitForDaemonReady();
  assert.equal(drogond.exitCode, null, "drogond must still be running");

  desktop = startAcceptanceProcess(
    electronBin,
    [appDir, "--remote-debugging-port=0"],
    {
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        DROGON_DATA_DIR: dataDir,
        DROGON_ELECTRON_PROFILE: electronProfile,
        DROGON_BACKGROUND_WINDOW: "1",
        PATH: `${fixtureBin}:${process.env.PATH ?? ""}`,
      },
    },
  );
  if (desktop.pid) report.desktopPid = desktop.pid;

  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timer = setTimeout(
      () => reject(new Error(`Electron did not publish a debugging endpoint: ${tail}`)),
      20000,
    );
    desktop.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    desktop.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Electron exited before connection (code ${code}): ${tail}`));
    });
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
  let page = null;
  for (let i = 0; i < 200 && !page; i += 1) {
    page = browser.contexts()[0]?.pages()[0];
    if (!page) await delay(50);
  }
  assert.ok(page, "Electron must create a rendered page");
  livePage = page;
  page.setDefaultTimeout(20000);
  await emulatePageFocus(page);

  await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor();
  report.checks.push("app-ready");

  // Setup (not under test): register the project workspace and seed a Bot
  // directly through the real bridge -- avoids the New Bot form's own
  // fields entirely so this probe stays focused on Open Session.
  const registered = await page.evaluate(async (dir) => {
    const result = await window.drogon.addWorkspace(dir);
    if (!result.ok) throw new Error(result.error.message);
    return result.result;
  }, projectDir);
  const status = await page.evaluate(async () => {
    const result = await window.drogon.status();
    if (!result.ok) throw new Error(result.error.message);
    return result.result;
  });
  const bot = await page.evaluate(
    async ({ hostId, workspaceId }) => {
      const result = await window.drogon.botCreate({
        hostId,
        workspaceId,
        requestId: crypto.randomUUID(),
        locale: "en-US",
        body: {
          characterPreset: "arya",
          displayIdentity: {
            displayName: "Arya Stark",
            handle: "arya-stark",
            title: null,
          },
          harnessPolicy: { defaultHarness: "pi", explicitModel: null },
          instructions: "",
          memories: [],
        },
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.result;
    },
    { hostId: status.hostId, workspaceId: registered.id },
  );
  assert.ok(bot.id);
  report.checks.push(`bot-created:${bot.id}`);

  // The real click path: navigate to Bots, click the real "Open session"
  // button on the real card.
  await page.getByRole("button", { name: "Bots", exact: true }).click();
  await page.getByTestId(`open-session-${bot.id}`).waitFor();
  await page.getByTestId(`open-session-${bot.id}`).click();

  // Core regression proof: a bot-scoped header must appear (proves the
  // host recognized the opened session as a Bot session and did not just
  // drop into a plain unlabeled terminal tab).
  await page.getByTestId("bot-session-header").waitFor({ timeout: 20000 });
  report.checks.push("bot-session-header-rendered");
  assert.equal(
    (await page.getByTestId("bot-session-title").textContent())?.trim(),
    "Arya Stark · Pi",
  );
  const breadcrumbText = await page.locator('nav[aria-label="Breadcrumb"]').textContent();
  assert.ok(breadcrumbText?.includes("Bots"));
  assert.ok(breadcrumbText?.includes("Arya Stark"));
  assert.ok(breadcrumbText?.includes("Terminal"));
  report.checks.push("breadcrumb-correct");

  await page.screenshot({
    path: path.join(output, "01-bot-session-opened.png"),
    animations: "disabled",
  });
  report.screenshots.push("01-bot-session-opened.png");

  // The regression itself: the session must NOT show the "Terminal
  // exited" toast the owner observed, and the fixture's own startup line
  // must be visible in the real xterm buffer.
  await page.locator(".xterm-screen:visible").waitFor();
  await waitForRenderedTextIncludes(page, "CWD=", 15000);
  const exitedToastCount = await page.getByText("Terminal exited").count();
  assert.equal(exitedToastCount, 0, "a live Bot session must show no exit toast");
  const statusPillText = await page.getByTestId("bot-session-status-pill").textContent();
  assert.ok(!statusPillText?.includes("Exited"), `expected a live pill, got ${statusPillText}`);
  report.checks.push("session-live-no-exit-toast");

  // Isolation proof: the rendered cwd is NOT the project worktree.
  const rendered = await page.evaluate(readRenderedTerminalText);
  assert.ok(rendered.includes("CWD="), `expected rendered terminal text, got ${JSON.stringify(rendered)}`);
  assert.ok(!rendered.includes(projectDir), "cwd must not be the project worktree");
  report.checks.push("isolation-cwd-not-project-worktree");

  // A second turn: type into the real xterm and see the fixture's echo,
  // proving this is a genuine conversation, not a one-shot reply.
  await page.locator(".xterm-helper-textarea:visible").click();
  await page.keyboard.type("hello from the acceptance probe");
  await page.keyboard.press("Enter");
  await waitForRenderedTextIncludes(
    page,
    "you said: hello from the acceptance probe",
    15000,
  );
  report.checks.push("second-turn-conversation-proven");

  // The inspector: open the session panel and verify REAL values.
  await page
    .getByRole("button", { name: "Toggle session details", exact: true })
    .click();
  await page.getByTestId("bot-session-inspector").waitFor();
  const harnessRow = await page.getByTestId("bot-session-row-harness").textContent();
  assert.ok(harnessRow?.includes("Pi"));
  const workspaceRow = await page.getByTestId("bot-session-row-workspace").textContent();
  assert.ok(workspaceRow?.includes("Isolated runtime"));
  assert.ok(!workspaceRow?.includes(projectDir));
  const typeRow = await page.getByTestId("bot-session-row-type").textContent();
  assert.ok(typeRow?.includes("Child session"));
  await page.waitForFunction(
    () => document.querySelector('[data-testid="bot-session-row-pid"]')?.textContent?.includes("pid:"),
    undefined,
    { timeout: 10000 },
  );
  const pidRow = await page.getByTestId("bot-session-row-pid").textContent();
  report.checks.push(`inspector-real-values:${harnessRow}|${workspaceRow}|${typeRow}|${pidRow}`);

  await page.screenshot({
    path: path.join(output, "02-inspector-with-pid.png"),
    animations: "disabled",
  });
  report.screenshots.push("02-inspector-with-pid.png");

  // Stop must really terminate it. The button disables itself the instant
  // the click fires (its own in-flight "Stopping…" state), so that alone
  // is not proof of termination -- wait for the status pill to actually
  // read Exited, the daemon-confirmed verdict.
  await page.getByTestId("bot-session-stop").click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="bot-session-status-pill"]')?.textContent?.includes("Exited"),
    undefined,
    { timeout: 15000 },
  );
  const finalPillText = await page.getByTestId("bot-session-status-pill").textContent();
  assert.ok(finalPillText?.includes("Exited"), `expected Stop to end the session, got ${finalPillText}`);
  const stopButtonDisabled = await page
    .getByTestId("bot-session-stop")
    .isDisabled();
  assert.ok(stopButtonDisabled, "Stop must disable itself once the session has exited");
  report.checks.push("stop-terminates-session");

  await page.screenshot({
    path: path.join(output, "03-after-stop.png"),
    animations: "disabled",
  });
  report.screenshots.push("03-after-stop.png");

  console.log("PASS", JSON.stringify(report, null, 2));
}

let failure = null;
try {
  await main();
} catch (error) {
  failure = error;
  console.error("FAIL", error);
  console.error("checks so far:", JSON.stringify(report.checks, null, 2));
  if (livePage) {
    try {
      await mkdir(output, { recursive: true });
      await livePage.screenshot({
        path: path.join(output, "FAILURE.png"),
        animations: "disabled",
      });
      const bodyText = await livePage.evaluate(() => document.body.innerText);
      await writeFile(path.join(output, "FAILURE-body.txt"), bodyText);
      console.error("failure evidence written to", output);
    } catch (captureError) {
      console.error("failed to capture failure evidence:", captureError);
    }
  }
} finally {
  if (browser) {
    try {
      await browser.close();
    } catch {
      // best effort
    }
  }
  if (desktop) {
    const result = await stopAcceptanceProcess(desktop);
    report.desktopStop = result;
  }
  if (drogond) {
    const result = await stopAcceptanceProcess(drogond);
    report.drogondStop = result;
  }
  const desktopExited = !desktop || report.desktopStop?.verdict === "exited";
  const drogondExited = !drogond || report.drogondStop?.verdict === "exited";
  if (desktopExited && drogondExited) {
    await rm(fixture, { recursive: true, force: true });
  } else {
    console.error(
      `owned processes did not confirm exit -- leaving fixture dir for inspection: ${fixture}`,
    );
  }
  console.log("cleanup", JSON.stringify({ desktopExited, drogondExited }, null, 2));
}
if (failure) process.exit(1);
