import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import {
  startAcceptanceProcess,
  stopAcceptanceProcess,
  runAcceptanceProcess,
} from "./acceptance-process.mjs";
import { emulatePageFocus } from "./acceptance-page-focus.mjs";
import {
  startForegroundObservation,
  verifyForegroundObservation,
} from "./acceptance-foreground.mjs";
import { probeRenderedHarness } from "./probe-rendered-harness.mjs";
import { probeAgentSettings, probeAgentSettingsNarrow, writeAgentSettingsFixtures } from "./probe-agent-settings.mjs";
import { probeRenderedSessionRestart } from "./probe-rendered-session-restart.mjs";
import { probeRenderedExitedStubs } from "./probe-rendered-exited-stubs.mjs";
import { probeRenderedFiles } from "./probe-rendered-files.mjs";
import { probeEditorKeyboardInput } from "./probe-editor-keyboard-input.mjs";
import { probeRenderedTabs } from "./probe-rendered-tabs.mjs";
import { probeRenderedDaemonRestart } from "./probe-rendered-daemon-restart.mjs";
import {
  probeRenderedBrowserTabsAcrossDaemonRestart,
} from "./probe-rendered-browser-tabs-restart.mjs";
import {
  probeGhUnavailable,
  probePackagedSurfaces,
} from "./probe-packaged-surfaces.mjs";
import {
  probeAutomationRunNowDetail,
  probeBotPresetManualRun,
  probeJumpPaletteSwitch,
  probeMentuApproveRunEvidence,
  probePiAgentStateWorkingIdle,
  probeTasksStartIssue,
  probeThemePersistsAcrossRelaunch,
  seedLocalPiProvider,
  writeFixtureGh,
} from "./probe-sealed-journeys.mjs";
import { waitForTerminalText } from "./acceptance-terminal-text.mjs";
import { probeSessionNavigation } from "./probe-session-navigation.mjs";
import {
  BUNDLE_ICON_FILE,
  bundlePaths,
  sealedBundleDigest,
  verifiedBuildInfo,
  verifyBundleCarriesDrogonIcon,
  verifySealedBundle,
} from "./desktop-artifacts.mjs";
import { packagedFixtureDaemon } from "./packaged-fixture-daemon.mjs";
import { probeStandaloneSessions } from "./probe-standalone-sessions.mjs";

const args = process.argv.slice(2);
const bundle =
  args[0] === "--bundle" ? path.resolve(args.splice(0, 2)[1]) : null;
const sessionsIndex = args.indexOf("--sessions");
const withSessions = sessionsIndex !== -1;
if (withSessions) args.splice(sessionsIndex, 1);
const agentsIndex = args.indexOf("--agents");
const withAgents = agentsIndex !== -1;
if (withAgents) args.splice(agentsIndex, 1);
const filesIndex = args.indexOf("--files");
const withFiles = filesIndex !== -1;
if (withFiles) args.splice(filesIndex, 1);
const withHarness = args.join(" ") === "--harness pi";
assert.ok(
  args.length === 0 || withHarness,
  "Use [--bundle <Drogon.app>] [--files] [--harness pi]",
);
if (bundle)
  assert.equal(
    process.platform,
    "darwin",
    "Packaged acceptance currently targets macOS",
  );
const build = bundle ? await verifiedBuildInfo(bundle) : null;
const packaged = bundle ? bundlePaths(bundle) : null;
// Sealed final-artifact identity, computed AFTER packaging/signing and stored
// only in this detached report. verifiedBuildInfo above stays as legacy
// build-metadata recovery; the sealed digest below is the actual
// final-artifact proof verified before launch and re-verified after
// acceptance. A changed candidate fails closed.
const candidateSealed = bundle ? await sealedBundleDigest(bundle) : null;
if (bundle) await verifySealedBundle(bundle, candidateSealed);

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps", "desktop");
const appRequire = createRequire(path.join(appDir, "package.json"));
const electron = appRequire("electron");
const fixture = await mkdtemp(path.join(tmpdir(), "dgu-"));
const dataDir = path.join(fixture, "data");
let fixtureDaemon = packaged
  ? packagedFixtureDaemon(packaged.daemon, packaged.cli, dataDir)
  : null;
const workspace = path.join(fixture, "folder");
await mkdir(workspace);
// R16-BB: the sealed journeys run every in-app agent launch on the
// team-local free model (Pi resolves its config from this isolated dir,
// never the user's ~/.pi) and the Tasks journey rides a deterministic gh
// fixture that must be on the daemon PATH before it spawns.
const piDir = path.join(fixture, "pi");
const fixtureBin = path.join(fixture, "bin");
await seedLocalPiProvider(piDir);
await writeFixtureGh(fixtureBin, [
  { number: 1, title: "Acceptance issue one" },
  { number: 2, title: "Acceptance issue two" },
]);
if (withAgents || withSessions) await writeAgentSettingsFixtures(fixtureBin);
const output = path.join(
  root,
  ".preflight",
  "acceptance",
  `desktop-${Date.now()}-${randomUUID()}`,
);
await mkdir(output, { recursive: true });
const report = {
  kind: bundle ? "packaged-desktop" : "development-desktop",
  ...(build
    ? {
        bundle,
        revision: build.revision,
        artifactDigest: build.artifactDigest,
        artifactProvenance: "legacy-partial-build-metadata-not-final-proof",
        identityProof: "sealed-final-artifact",
        sealedVersion: candidateSealed.sealedVersion,
        sealedDigest: candidateSealed.sealedDigest,
        sealedFileCount: candidateSealed.fileCount,
        sealedTotalBytes: candidateSealed.totalBytes,
      }
    : { identityProof: "source-build-not-final-artifact" }),
  status: "FAILED",
  startedAt: new Date().toISOString(),
  checks: [],
  cleanup: [],
  desktopPids: [],
  fixture,
};
let daemon, desktop, browser, page, registered;
let foregroundObservation;
let lastLivePage = null; // kept for failure evidence after phase-local cleanup
let agentWindowBounds = "1440x928+4000+4000";
let ranUpgradeCheck = false; // guards the explicit exit in the upgrade path
async function stopOwned(child, label) {
  if (!child) return;
  const result = await stopAcceptanceProcess(child);
  if (result.forced || result.verdict !== "exited") report.status = "FAILED";
  if (result.forced)
    report.cleanup.push(`${label}: required force after timeout`);
  report.cleanup.push(`${label}: ${result.verdict}`);
  return result;
}
async function launchDesktop(overrideDataDir = null) {
  const activeDataDir = overrideDataDir ?? dataDir;
  const child = startAcceptanceProcess(
    packaged?.executable ?? electron,
    [...(packaged ? [] : [appDir]), "--remote-debugging-port=0"],
    {
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        DROGON_DATA_DIR: activeDataDir,
        DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"),
        DROGON_BACKGROUND_WINDOW: "1",
        ...(withAgents ? { DROGON_WINDOW_BOUNDS: agentWindowBounds } : {}),
        PI_CODING_AGENT_DIR: piDir,
        ...(process.platform !== "win32" ? { SHELL: "/bin/sh" } : {}),
        ...(packaged || withAgents || withSessions
          ? { PATH: `${fixtureBin}:/usr/bin:/bin:/usr/sbin:/sbin` }
          : {}),
        ...(withHarness
          ? { PI_CODING_AGENT_DIR: path.join(fixture, "pi") }
          : {}),
      },
    },
  );
  desktop = child;
  if (child.pid) report.desktopPids.push(child.pid);
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timeout = setTimeout(
      () =>
        reject(
          new Error(`Electron did not publish a debugging endpoint: ${tail}`),
        ),
      20000,
    );
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error(`Electron exited before connection: ${tail}`));
    });
    child.stderr.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-8192);
      const match = tail.match(
        /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/,
      );
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  for (let i = 0; i < 200 && !browser.contexts()[0]?.pages()[0]; i++)
    await delay(50);
  page = browser.contexts()[0].pages()[0];
  lastLivePage = page;
  await emulatePageFocus(page);
  assert.ok(page, "Electron must create a rendered page");
  page.setDefaultTimeout(15000);
  // R9-B: the sidebar footer is the source toolbar now (settings, help,
  // reveal) — the "Service x.y.z" text is gone, so readiness waits for it.
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor();
}
// R16-BB (J10): quit and reopen the desktop quiescently so a Settings
// change can be proven across a real relaunch. Fails closed through
// stopOwned when the quit requires force.
async function relaunchDesktop() {
  await browser.close();
  browser = null;
  await stopOwned(desktop, "journey-probe desktop relaunch");
  desktop = null;
  let lastError = null;
  // Electron can briefly retain the just-closed profile/single-instance lock;
  // retry the real quit-and-reopen path a bounded number of times rather than
  // converting that transient into a false theme failure.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await delay(attempt * 500);
      await launchDesktop();
      return page;
    } catch (error) {
      lastError = error;
      await browser?.close().catch(() => {});
      browser = null;
      await stopOwned(desktop, "journey-probe desktop relaunch retry");
      desktop = null;
    }
  }
  throw lastError;
}
try {
  if (process.env.DROGON_VERIFY_OS_FOCUS === "1") {
    foregroundObservation = await startForegroundObservation(output);
  }
  if (bundle) {
    // R16-BO (#319): prove the sealed bundle carries the Drogon icon
    // before any rendered journey runs, so PASSED implies installable.
    await verifyBundleCarriesDrogonIcon(bundle, {
      expectedIcon: path.join(
        root,
        "apps",
        "desktop",
        "resources",
        BUNDLE_ICON_FILE,
      ),
    });
    report.checks.push("bundle-carries-drogon-icon");
  }
  let daemonError;
  if (!packaged) {
    daemon = startAcceptanceProcess(
      path.join(
        root,
        "target",
        "debug",
        process.platform === "win32" ? "drogond.exe" : "drogond",
      ),
      ["--data-dir", dataDir],
      {
        stdio: "ignore",
        env: {
          ...process.env,
          PATH: `${fixtureBin}${path.delimiter}${process.env.PATH ?? ""}`,
          PI_CODING_AGENT_DIR: piDir,
        },
      },
    );
    daemon.on("error", (error) => {
      daemonError = error;
    });
    const deadline = Date.now() + 10000;
    while (true) {
      if (daemonError) throw daemonError;
      try {
        const response = await runAcceptanceProcess(
          path.join(
            root,
            "target",
            "debug",
            process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli",
          ),
          ["--data-dir", dataDir, "--json", "status"],
          { timeout: 1000 },
        );
        assert.equal(JSON.parse(response.stdout).ok, true);
        break;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await delay(50);
      }
    }
  }
  await launchDesktop();
  if (daemonError) throw daemonError;
  if (fixtureDaemon) {
    await fixtureDaemon.capture();
    assert.equal(
      (await page.evaluate(() => window.drogon.buildInfo()))?.revision,
      build.revision,
    );
    // R9-B removed the footer's revision display (fidelity to the source
    // toolbar), so the sealed identity is proved through buildInfo, not a
    // rendered revision string.
    report.checks.push(
      "packaged-app-starts-bundled-runtime-with-minimal-path-and-reports-revision",
    );
  }
  assert.deepEqual(
    await page.evaluate(() => ({
      require: typeof window.require,
      process: typeof window.process,
    })),
    { require: "undefined", process: "undefined" },
  );
  // Exercise the real left-sidebar click path before any workspace exists.
  // The shell used to update its route state but immediately replace every
  // routed page with Landing, making Bots, Tasks and Automations look inert.
  // R17-E (#348): Bots now mounts its real surface with zero workspaces —
  // the fork renders BotsPage for activeView 'bots' with no workspace
  // condition — so the fork header (title + New Bot) is the expectation
  // here, not the NoWorkspacePage. Automations keeps the placeholder.
  await page.getByRole("button", { name: "Bots", exact: true }).click();
  await page.locator('[data-testid="bots-page-host"]').waitFor();
  await page
    .locator('[data-testid="bots-page-host"]')
    .getByRole("heading", { name: "Bots", exact: true })
    .waitFor();
  await page
    .locator('[data-testid="bots-page-host"]')
    .getByRole("button", { name: "New Bot", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Bots", exact: true })
      .getAttribute("aria-current"),
    "page",
  );
  {
    const pageCase = { button: "Automations", title: "Automations" };
    await page.getByRole("button", { name: pageCase.button, exact: true }).click();
    await page.getByTestId("no-workspace-page").waitFor();
    await page
      .getByTestId("no-workspace-page")
      .getByRole("heading", { name: pageCase.title, exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: pageCase.button, exact: true })
        .getAttribute("aria-current"),
      "page",
    );
  }
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByTestId("tasks-page-host").waitFor();
  await page.getByRole("button", { name: "Close tasks", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Tasks", exact: true })
      .getAttribute("aria-current"),
    "page",
  );
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.getByRole("heading", { name: "Drogon", exact: true }).waitFor();
  report.checks.push("no-workspace-sidebar-navigation-clicks");
  if (withSessions) report.checks.push(await probeStandaloneSessions({ page, output, dataDir }));

  // Add Project dialog (ported folder picker): registers the folder as a
  // project AND its implicit workspace, so the sidebar renders its row
  // with one card — the legacy path form registered a bare workspace
  // that never appeared as a card.
  await page.getByRole("button", { name: "Add Project", exact: true }).click();
  const addDialog = page.getByRole("dialog", { name: "Add Project" });
  await addDialog.getByLabel("Folder or repository path").fill(workspace);
  await addDialog
    .getByRole("button", { name: "Add Project", exact: true })
    .click();
  await page.getByRole("heading", { name: "Start a session" }).waitFor();
  // The folder project renders one row with its implicit-workspace card,
  // and selecting the card selects that workspace.
  await page.locator(".shell-project-row", { hasText: "folder" }).waitFor();
  await page.getByRole("button", { name: "Select folder" }).waitFor();
  report.checks.push("folder-project-renders-row-with-implicit-card");
  // New-workspace composer (Projects header "+"): for a folder project
  // the composer opens the implicit workspace straight away. The project
  // picker is the fork's type-ahead combobox; "Blank Terminal" keeps the
  // journey sessionless (the composer auto-picks an available agent, so an
  // explicit blank pick keeps this fixture from launching a real one).
  await page.getByRole("button", { name: "New workspace", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Create workspace" });
  await composer.getByRole("combobox", { name: "Project" }).click();
  await page.getByRole("option", { name: /^folder/ }).click();
  await composer.locator('[data-agent-combobox-root="true"][role="combobox"]').click();
  await page.getByRole("option", { name: "Blank Terminal" }).click();
  await composer.getByRole("button", { name: "Create workspace" }).click();
  await page.getByRole("heading", { name: "Start a session" }).waitFor();
  report.checks.push("composer-opens-folder-implicit-workspace");
  registered = await page.evaluate(async () => {
    const response = await window.drogon.workspaces();
    if (!response.ok) throw new Error(response.error.message);
    return response.result.workspaces[0];
  });
  report.checks.push("isolated-renderer-and-real-folder-registration");
  await page
    .getByRole("button", { name: "New tab", exact: true })
    .last()
    .click();
  await page
    .getByRole("menuitem", { name: /^New Terminal/ })
    .click();
  await page.getByRole("tab").first().waitFor();
  await page.locator(".xterm-helper-textarea").focus();
  const nonce = randomUUID().replaceAll("-", "");
  const marker = `DROGON_${nonce}`;
  const command =
    process.platform === "win32"
      ? `echo DROGON_${nonce}`
      : `printf 'DROGON_%s\\n' '${nonce}'`;
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
  await waitForTerminalText(page, marker);
  report.checks.push("rendered-terminal-command-output");
  const original = await page.evaluate(async (id) => {
    const value = await window.drogon.sessions(id);
    return value.ok ? value.result.sessions[0] : null;
  }, registered.id);
  assert.ok(original?.incarnation);
  report.checks.push(await probeSessionNavigation({
    page, workspaceId: registered.id, session: original, marker,
  }));
  await page.reload();
  await waitForTerminalText(page, marker);
  const reconnected = await page.evaluate(async (id) => {
    const value = await window.drogon.sessions(id);
    return value.ok ? value.result.sessions[0] : null;
  }, registered.id);
  assert.equal(reconnected?.id, original.id);
  assert.equal(reconnected?.incarnation, original.incarnation);
  report.checks.push("renderer-reload-retains-exact-session-and-output");
  if (fixtureDaemon) {
    const before = await fixtureDaemon.rpc("status");
    await browser.close();
    browser = null;
    const stopped = await stopOwned(desktop, "first desktop instance");
    assert.equal(stopped.verdict, "exited");
    assert.equal(stopped.forced, false, "Quit/reopen must not require force");
    const whileClosed = await fixtureDaemon.rpc("status");
    assert.equal(whileClosed.serviceInstanceId, before.serviceInstanceId);
    assert.ok(before.serviceInstanceId);
    await launchDesktop();
    await waitForTerminalText(page, marker);
    const after = await fixtureDaemon.rpc("status");
    assert.equal(after.serviceInstanceId, before.serviceInstanceId);
    const { sessions } = await fixtureDaemon.rpc("session.list", {
      workspaceId: registered.id,
    });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, original.id);
    assert.equal(sessions[0].incarnation, original.incarnation);
    assert.equal(sessions[0].verdict, "live");
    report.checks.push(
      "packaged-quit-and-reopen-preserves-incumbent-runtime-session-and-output",
    );
  }
  if (packaged) {
    // Run the destructive daemon-restart probe only after the packaged
    // quit/reopen check. That check intentionally proves the incumbent
    // session remains live; restart then turns it into the exited row that
    // the probe verifies, without invalidating the earlier assertion.
    report.checks.push(
      ...(await probeRenderedDaemonRestart({
        page,
        workspaceId: registered.id,
        cli: packaged.cli,
        dataDir,
        output,
      })),
    );
    // The fixture handle intentionally pins one service identity. A managed
    // restart creates a new identity, so capture a fresh handle before the
    // final quiescent cleanup rather than weakening that ownership check.
    fixtureDaemon = packagedFixtureDaemon(packaged.daemon, packaged.cli, dataDir);
    await fixtureDaemon.capture();
    // Issue #309 regression: QA r9's pair of persisted local browser tabs
    // (127.0.0.1 + localhost) must survive BOTH daemon-restart paths with
    // the renderer answering CDP within budget — Settings → Restart daemon,
    // and a quit/relaunch whose stop quiescently shuts the bundled daemon
    // down so relaunch bootstraps a replacement (new identity, asserted).
    report.checks.push(
      ...(await probeRenderedBrowserTabsAcrossDaemonRestart({
        page,
        workspaceId: registered.id,
        cli: packaged.cli,
        dataDir,
        output,
        relaunch: async () => {
          await browser.close();
          browser = null;
          const stopped = await stopOwned(
            desktop,
            "browser-tabs probe app instance",
          );
          assert.equal(stopped.verdict, "exited");
          assert.equal(
            stopped.forced,
            false,
            "browser-tabs probe relaunch must not require force",
          );
          // Fixture handles are single-identity by design and the probe's
          // Settings restart above already minted a newer identity than the
          // outer handle holds, so pin the incumbent daemon with a fresh
          // handle before shutting it down quiescently (the QA r9 `stop`).
          const incumbentHandle = packagedFixtureDaemon(
            packaged.daemon,
            packaged.cli,
            dataDir,
          );
          await incumbentHandle.capture();
          const incumbent = await incumbentHandle.rpc("status");
          await incumbentHandle.stop();
          await launchDesktop();
          const replacement = packagedFixtureDaemon(
            packaged.daemon,
            packaged.cli,
            dataDir,
          );
          await replacement.capture();
          const fresh = await replacement.rpc("status");
          assert.notEqual(
            fresh.serviceInstanceId,
            incumbent.serviceInstanceId,
            "relaunch must have restarted the daemon (new service identity)",
          );
          fixtureDaemon = replacement;
          return { page, readyAt: Date.now() };
        },
      })),
    );
  }
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page
    .getByRole("menuitem", { name: /^New Terminal/ })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll('[role="tab"]').length === 2,
  );
  await page.getByRole("tab").last().focus();
  await page.keyboard.press("Home");
  await page.waitForFunction(() => {
    const tab = document.querySelector('[role="tab"]');
    return (
      tab?.getAttribute("aria-selected") === "true" &&
      document.activeElement === tab
    );
  });
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].at(-1);
    return (
      tab?.getAttribute("aria-selected") === "true" &&
      document.activeElement === tab
    );
  });
  await page
    .getByRole("button", { name: /^Close .* session$/ })
    .last()
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll('[role="tab"]').length === 1,
  );
  if (!packaged) {
    await waitForTerminalText(page, marker);
  } else {
    // The packaged daemon-restart probe intentionally stops the original
    // session, so its retained terminal output is no longer the live tab
    // proof used by this generic keyboard journey. The restart probe already
    // proves the exited-row reconnect; here only assert that the surviving
    // tab is rendered after the sibling close.
    await page.getByRole("tab").first().waitFor();
  }
  report.checks.push("keyboard-tab-navigation-and-sibling-close");
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({
      path: path.join(output, `${colorScheme}.png`),
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 760, height: 600 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: path.join(output, "narrow.png"),
    animations: "disabled",
  });
  report.checks.push("light-dark-captures-and-narrow-no-overflow");
  await page.getByRole("button", { name: /Close .* session/ }).click();
  await page.getByRole("heading", { name: "Start a session" }).waitFor();
  report.checks.push("exact-session-close-through-ui");
  await page.reload();
  await page.getByRole("heading", { name: "Start a session" }).waitFor();
  assert.equal(await page.getByRole("tab").count(), 0);
  report.checks.push("explicitly-closed-tabs-stay-dismissed-after-reload");
  // Git project journey: the composer creates a real worktree through
  // `worktree.create` and selects it; the sidebar gains a second card.
  const gitDir = path.join(fixture, "repo");
  await mkdir(gitDir);
  const gitIdentity = [
    "-c",
    "user.email=acceptance@drogon.local",
    "-c",
    "user.name=Drogon Acceptance",
    "-c",
    "init.defaultBranch=main",
  ];
  await runAcceptanceProcess("git", [...gitIdentity, "init"], {
    cwd: gitDir,
  });
  await writeFile(path.join(gitDir, "notes.txt"), "composer fixture\n");
  await mkdir(path.join(gitDir, "src"));
  await writeFile(path.join(gitDir, "src", "fixture.txt"), "sparse fixture\n");
  await mkdir(path.join(gitDir, "docs"));
  await writeFile(path.join(gitDir, "docs", "fixture.md"), "docs fixture\n");
  await runAcceptanceProcess("git", [...gitIdentity, "add", "notes.txt", "src", "docs"], {
    cwd: gitDir,
  });
  await runAcceptanceProcess("git", [...gitIdentity, "commit", "-m", "composer fixture"], {
    cwd: gitDir,
  });
  // R9-B: Add Project lives in the source's Workspace options menu now.
  await page
    .getByRole("button", { name: "Workspace options", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Add Project", exact: true })
    .click();
  const addGitDialog = page.getByRole("dialog", { name: "Add Project" });
  await addGitDialog.getByLabel("Folder or repository path").fill(gitDir);
  await addGitDialog
    .getByRole("button", { name: "Add Project", exact: true })
    .click();
  // A git project has no workspace until its first worktree exists, so
  // the composer (not the project row) is the way to its first card.
  await page.getByRole("button", { name: "New workspace", exact: true }).click();
  const worktreeComposer = page.getByRole("dialog", {
    name: "Create workspace",
  });
  await worktreeComposer.getByRole("combobox", { name: "Project" }).click();
  await page.getByRole("option", { name: /^repo/ }).click();
  const gitComposer = page.getByRole("dialog", { name: "Create worktree" });
  await gitComposer.locator('[data-workspace-name-input="true"]').fill("demo-a");
  await gitComposer
    .locator('[data-agent-combobox-root="true"][role="combobox"]')
    .click();
  await page.getByRole("option", { name: "Blank Terminal" }).click();
  await gitComposer.getByRole("button", { name: "Create worktree" }).click();
  await page.getByRole("button", { name: "Select demo-a" }).waitFor();
  await page.locator(".shell-project-row", { hasText: "repo" }).waitFor();
  report.checks.push("composer-creates-git-worktree-and-selects-it");

  // R16-BM2: exercise the source's Advanced rows on a disposable child:
  // explicit branch, same-project parent, note, local setup script and a
  // daemon-backed sparse preset all cross the real composer/IPC/daemon path.
  const gitProject = await page.evaluate(async () => {
    const listed = await window.drogon.project?.projectList?.();
    if (!listed?.ok) throw new Error(listed?.error?.message ?? "project list unavailable");
    return listed.result.projects.find((item) => item.path.endsWith("/repo"));
  });
  assert.ok(gitProject, "git project must be registered");
  const setupResult = await page.evaluate(async (id) => {
    return window.drogon.project?.projectUpdate?.({
      id,
      setupScript: "printf 'setup-ok\\n'",
    });
  }, gitProject.id);
  assert.equal(setupResult?.ok, true);
  const sparseResult = await page.evaluate(async (id) => {
    return window.drogon.project?.saveSparsePreset?.({
      projectId: id,
      name: "Acceptance sparse",
      directories: ["src"],
    });
  }, gitProject.id);
  assert.equal(sparseResult?.ok, true);
  const parentWorktreeId = await page.evaluate(async (id) => {
    const listed = await window.drogon.project?.worktreeList?.({ projectId: id });
    if (!listed?.ok) throw new Error(listed?.error?.message ?? "worktree list unavailable");
    return listed.result.worktrees.find((item) => item.path.endsWith("/demo-a"))?.id;
  }, gitProject.id);
  assert.ok(parentWorktreeId, "demo-a must be available as a parent candidate");
  await page.reload();
  await page.getByRole("heading", { name: "Start a session" }).waitFor();

  await page.getByRole("button", { name: "New workspace", exact: true }).click();
  const advancedComposer = page.getByRole("dialog", { name: "Create workspace" });
  await advancedComposer.getByRole("combobox", { name: "Project" }).click();
  await page.getByRole("option", { name: /^repo/ }).click();
  const advancedGitComposer = page.getByRole("dialog", { name: "Create worktree" });
  await advancedGitComposer.getByRole("button", { name: "Advanced", exact: true }).click();
  await advancedGitComposer.getByLabel("Branch name").fill("feature/demo-b");
  await advancedGitComposer.getByRole("textbox", { name: "Note" }).fill("BM2 child");
  await advancedGitComposer.getByRole("combobox", { name: "Parent worktree" }).click();
  await page.getByRole("option", { name: /demo-a/ }).first().click();
  await advancedGitComposer.getByRole("combobox").filter({ hasText: "Off" }).click();
  await page.getByRole("option", { name: "Acceptance sparse" }).click();
  await advancedGitComposer.locator('[data-workspace-name-input="true"]').fill("demo-b");
  await advancedGitComposer.locator('[data-agent-combobox-root="true"][role="combobox"]').click();
  await page.getByRole("option", { name: "Blank Terminal" }).click();
  await advancedGitComposer.getByRole("button", { name: "Create worktree" }).click();
  await page.getByRole("button", { name: "Select demo-b" }).waitFor();
  const advancedWorktree = await page.evaluate(async (id) => {
    const listed = await window.drogon.project?.worktreeList?.({ projectId: id });
    if (!listed?.ok) throw new Error(listed?.error?.message ?? "worktree list unavailable");
    return listed.result.worktrees.find((item) => item.path.endsWith("/demo-b"));
  }, gitProject.id);
  assert.equal(advancedWorktree?.branch, "feature/demo-b");
  assert.equal(advancedWorktree?.note, "BM2 child");
  assert.equal(advancedWorktree?.parentWorktreeId, parentWorktreeId);
  report.checks.push("composer-advanced-branch-parent-note-setup-sparse");

  if (withHarness) {
    // Quick Session is intentionally gated to the harness acceptance: it
    // launches the selected fixture Pi, then we remove the project through
    // the real project bridge and prove its app-owned scratch is gone.
    await page.getByRole("button", { name: "New workspace", exact: true }).click();
    const quickComposer = page.getByRole("dialog", { name: "Create workspace" });
    await quickComposer.getByRole("button", { name: /Quick Session/ }).click();
    await page
      .getByRole("button", { name: "Select Quick Session" })
      .waitFor();
    const quickProject = await page.evaluate(async () => {
      const listed = await window.drogon.project?.projectList?.();
      if (!listed?.ok) throw new Error(listed?.error?.message ?? "project list unavailable");
      return listed.result.projects.find((item) => item.quickSession);
    });
    assert.ok(quickProject?.quickSession, "Quick Session must register an owned project");
    const quickPath = quickProject.path;
    const removed = await page.evaluate(async (id) => {
      return window.drogon.project?.projectRemove?.({ id });
    }, quickProject.id);
    assert.equal(removed?.ok, true);
    assert.equal(existsSync(quickPath), false);
    report.checks.push("quick-session-registers-launches-and-cleans-up");
  }
  // Later probes address the folder workspace, so select its card again.
  await page.getByRole("button", { name: "Select folder" }).click();
  await page.getByRole("heading", { name: "Start a session" }).waitFor();
  if (withFiles) {
    report.checks.push(
      ...(await probeRenderedFiles({ page, workspace, output })),
    );
    // R16-X (fixes #144): the real keyboard path — CDP keystrokes into
    // Monaco — plus the dirty/external-write conflict that must mark and
    // suspend autosave instead of silently overwriting disk.
    report.checks.push(
      ...(await probeEditorKeyboardInput({ page, workspace, output })),
    );
    // R16-AJ (fixes #215): sealed tab-restore check — editor + browser
    // tabs persist per workspace and come back in order after a reload.
    report.checks.push(
      ...(await probeRenderedTabs({ page, workspace, output })),
    );
  }
  if (withAgents) {
    // Drop the earlier narrow viewport emulation. Relaunch at native bounds,
    // through the same hidden-window launcher used by the fidelity oracle.
    await relaunchDesktop();
    report.checks.push(...await probeAgentSettings({ page, workspaceId: registered.id, output, dataDir, fixtureBin,
      cli: packaged?.cli ?? path.join(root, "target/debug/drogon-cli"),
    }));
    if (!packaged) {
      agentWindowBounds = "760x928+4000+4000";
      await relaunchDesktop();
      report.checks.push(...await probeAgentSettingsNarrow({ page, output }));
    }
  }
  if (withHarness) {
    report.checks.push(
      ...(await probeRenderedHarness({
        page,
        workspaceId: registered.id,
        output,
        dataDir,
      })),
    );
  }
  // Extended packaged surfaces (palette, Settings, Changes, Automations,
  // Bots, status bar, Tasks). Runs against the sealed bundle; setting
  // DROGON_PROBE_SURFACES=1 also enables it on a development build for
  // iteration without a full package cycle.
  if (bundle || process.env.DROGON_PROBE_SURFACES === "1") {
    const surfacesCli = packaged
      ? packaged.cli
      : path.join(
          root,
          "target",
          "debug",
          process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli",
        );
    report.checks.push(
      ...(await probePackagedSurfaces({
        page,
        workspace,
        output,
        root,
        cli: surfacesCli,
        dataDir,
      })),
    );
  }
  // R16-BB: sealed journeys J1 (agent state), J5 (jump palette), J6
  // (Tasks start), J7 (Automations Run now), J8 (Bots preset + manual
  // run), J9 (Mentu approve & run) and J10 (theme across relaunch). Each
  // probe deletes the bots/automations/worktrees it created. Runs against
  // the sealed bundle, on --files, or with DROGON_PROBE_SURFACES=1.
  if (bundle || withFiles || process.env.DROGON_PROBE_SURFACES === "1") {
    const journeyCli = packaged
      ? packaged.cli
      : path.join(
          root,
          "target",
          "debug",
          process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli",
        );
    // The model-dependent journeys (J1/J7/J8) run real inference on the
    // team-local server; DROGON_SKIP_MODEL_JOURNEYS=1 exists only for
    // local iteration when that server is unavailable — it never defaults.
    // J1 runs first: it boots right after app launch, closest to a fresh
    // model-server window, and warms the model for J7/J8 below.
    if (process.env.DROGON_SKIP_MODEL_JOURNEYS !== "1") {
      report.checks.push(
        ...(await probePiAgentStateWorkingIdle({
          page,
          workspaceId: registered.id,
          output,
        })),
      );
    }
    report.checks.push(
      ...(await probeJumpPaletteSwitch({ page, root, output })),
    );
    report.checks.push(
      ...(await probeMentuApproveRunEvidence({ page, workspace, output })),
    );
    if (process.env.DROGON_SKIP_MODEL_JOURNEYS !== "1") {
      report.checks.push(
        ...(await probeAutomationRunNowDetail({
          page,
          cli: journeyCli,
          dataDir,
          workspaceId: registered.id,
          output,
        })),
      );
      report.checks.push(
        ...(await probeBotPresetManualRun({
          page,
          cli: journeyCli,
          dataDir,
          workspaceId: registered.id,
          output,
        })),
      );
    }
    report.checks.push(
      ...(await probeTasksStartIssue({ page, cli: journeyCli, dataDir, output })),
    );
    report.checks.push(
      ...(await probeThemePersistsAcrossRelaunch({
        page,
        relaunch: relaunchDesktop,
        output,
      })),
    );
  }
  if (bundle) {
    report.checks.push(
      ...(await probeGhUnavailable({
        daemon: packaged.daemon,
        cli: packaged.cli,
      })),
    );
  }
  if (bundle) {
    // Re-verify the exact sealed identity after acceptance: a candidate that
    // changed mid-run fails closed instead of producing a mismatched report.
    const closing = await verifySealedBundle(bundle, candidateSealed);
    assert.equal(closing.sealedDigest, report.sealedDigest);
    report.checks.push(
      "sealed-final-artifact-identity-unchanged-after-acceptance",
    );
  }
  if (!packaged) {
    // R16-AL (fixes #222): kill -9 ONLY the owned daemon mid-session,
    // restart it over the same data dir, and prove the session list still
    // renders — including a legacy exited row that still carries its last
    // agent-state timestamp — with no wipe and the New tab button intact.
    report.checks.push(
      ...(await probeRenderedSessionRestart({
        page,
        workspaceId: registered.id,
        output,
        dataDir,
        daemon,
        daemonBin: path.join(
          root,
          "target",
          "debug",
          process.platform === "win32" ? "drogond.exe" : "drogond",
        ),
        cliBin: path.join(
          root,
          "target",
          "debug",
          process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli",
        ),
        adoptDaemon: (child) => {
          daemon = child;
        },
      })),
    );
  }
  if (!packaged) {
    // R16-AL2 (fixes #228): kill -9 the restarted daemon again, seed two
    // rows the startup sweep turns into `unverifiable` stubs, and prove
    // the strip's stubs are closable (tab close forgets), retriable
    // (Retry offers the recovery overlay with Restart, which revives and
    // forgets), and clearable (Settings → Terminal → Kill all sessions
    // acts on stubs and live sessions alike).
    report.checks.push(
      ...(await probeRenderedExitedStubs({
        page,
        workspaceId: registered.id,
        output,
        dataDir,
        daemon,
        daemonBin: path.join(
          root,
          "target",
          "debug",
          process.platform === "win32" ? "drogond.exe" : "drogond",
        ),
        cliBin: path.join(
          root,
          "target",
          "debug",
          process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli",
        ),
        adoptDaemon: (child) => {
          daemon = child;
        },
      })),
    );
  }
  // R16-BP: upgrade-from-previous-build. Runs ONLY when a previous sealed
  // bundle is available on this machine (DROGON_UPGRADE_FROM_BUNDLE pointing
  // at an older sealed Drogon.app); otherwise it is skipped with an explicit
  // reason so a plain `--bundle` acceptance is never blocked. The check
  // seeds a scratch data dir through the PREVIOUS bundle's own daemon/CLI
  // (2 projects: git + folder, 3 worktrees, shell + local-model Pi
  // sessions, one cron automation), opens it with the CANDIDATE bundle and
  // verifies every seeded record is present and usable, then simulates a
  // future schema version (exactly what a newer build leaves behind) and
  // verifies the candidate refuses it with the renderer's downgrade dialog.
  const previousBundlePath = process.env.DROGON_UPGRADE_FROM_BUNDLE
    ? path.resolve(process.env.DROGON_UPGRADE_FROM_BUNDLE)
    : null;
  const upgradeSkipReason = !previousBundlePath
    ? "no previous sealed bundle configured (set DROGON_UPGRADE_FROM_BUNDLE=<old Drogon.app>)"
    : !existsSync(previousBundlePath)
      ? `DROGON_UPGRADE_FROM_BUNDLE does not exist: ${previousBundlePath}`
      : !bundle
        ? "requires --bundle: the upgrade target must be a packaged candidate"
        : null;
  if (upgradeSkipReason) {
    report.checks.push(`upgrade-from-previous-build: SKIPPED (${upgradeSkipReason})`);
  } else {
    const previousPaths = bundlePaths(previousBundlePath);
    const upgradeProjects = [];
    for (const artifact of [
      previousPaths.executable,
      previousPaths.daemon,
      previousPaths.cli,
    ])
      assert.ok(existsSync(artifact), `previous bundle artifact missing: ${artifact}`);
    const upgradeDataDir = path.join(fixture, "upgrade-data");
    // Stops the detached daemons the upgrade phases' packaged apps leave
    // behind (they outlive their app by design and are never reaped).
    // Matches ONLY the exact scratch data dir: these are this run's own.
    const upgradePids = async () => {
      try {
        const out = (
          await runAcceptanceProcess("/usr/bin/pgrep", ["-f", upgradeDataDir], {})
        ).stdout.trim();
        return out ? out.split("\n") : [];
      } catch {
        return [];
      }
    };
    const stopUpgradePhaseDaemons = async () => {
      for (const pid of await upgradePids())
        await runAcceptanceProcess("/bin/kill", [pid], {}).catch(() => {});
      for (let i = 0; i < 100 && (await upgradePids()).length > 0; i++)
        await delay(100);
      for (const pid of await upgradePids())
        await runAcceptanceProcess("/bin/kill", ["-9", pid], {}).catch(() => {});
      const left = await upgradePids();
      assert.equal(left.length, 0, `upgrade-phase daemons must stop, saw ${left}`);
      report.cleanup.push("upgrade-phase bundled daemon: stopped by exact scratch-dir match");
    };
    await mkdir(upgradeDataDir, { recursive: true });
    const gitProject = path.join(fixture, "upgrade-git");
    const folderProject = path.join(fixture, "upgrade-folder");
    await mkdir(path.join(gitProject, ".git"), { recursive: true });
    await mkdir(folderProject, { recursive: true });
    await writeFile(path.join(gitProject, "README.md"), "seed\n");
    await runAcceptanceProcess("git", ["init", "--initial-branch=main", gitProject], {});
    await runAcceptanceProcess("git", ["-C", gitProject, "config", "user.email", "accept@example.invalid"], {});
    await runAcceptanceProcess("git", ["-C", gitProject, "config", "user.name", "Accept"], {});
    await runAcceptanceProcess("git", ["-C", gitProject, "add", "."], {});
    await runAcceptanceProcess("git", ["-C", gitProject, "commit", "-m", "seed"], {});
    const oldCli = async (args, options = {}) =>
      JSON.parse(
        (
          await runAcceptanceProcess(
            previousPaths.cli,
            ["--data-dir", upgradeDataDir, "--json", ...args],
            options,
          )
        ).stdout,
      );
    // Seed through the PREVIOUS bundle's own daemon + CLI.
    let oldDaemon = startAcceptanceProcess(
      previousPaths.daemon,
      ["--data-dir", upgradeDataDir],
      { stdio: "ignore" },
    );
    try {
      const seedDeadline = Date.now() + 15_000;
      for (;;) {
        try {
          const status = await oldCli(["status"], { timeout: 1000 });
          assert.equal(status.ok, true);
          break;
        } catch (error) {
          if (Date.now() >= seedDeadline) throw error;
          await delay(50);
        }
      }
      const addedProjects = [];
      for (const seedPath of [gitProject, folderProject]) {
        const added = await oldCli(["project", "add", seedPath]);
        assert.equal(added.ok, true, `previous CLI project add failed: ${seedPath}`);
        addedProjects.push(added.result);
      }
      upgradeProjects.push(...addedProjects);
      assert.equal(addedProjects[0].kind, "git");
      assert.equal(addedProjects[1].kind, "folder");
      for (const name of ["alpha", "beta", "gamma"]) {
        const worktree = await oldCli([
          "worktree",
          "create",
          "--project",
          addedProjects[0].id,
          "--name",
          name,
        ]);
        assert.equal(worktree.ok, true, `worktree ${name} failed`);
      }
      const gitWorkspaces = JSON.parse(
        (
          await runAcceptanceProcess(
            previousPaths.cli,
            [
              "--data-dir",
              upgradeDataDir,
              "--json",
              "worktree",
              "list",
              "--project",
              addedProjects[0].id,
            ],
            {},
          )
        ).stdout,
      );
      assert.equal(gitWorkspaces.ok, true);
      const gitWorkspaceId = gitWorkspaces.result.worktrees[0]?.workspaceId ?? null;
      assert.ok(gitWorkspaceId, "git project must expose a workspace");
      for (const command of [["/bin/sh", "-l"], ["/bin/echo", "seeded"]]) {
        const session = await oldCli([
          "terminal",
          "create",
          "--workspace",
          gitWorkspaceId,
          "--",
          ...command,
        ]);
        assert.equal(session.ok, true, "shell session seed failed");
      }
      // The free LOCAL model only (never paid): Pi on dgx-spark.
      const piSession = await oldCli([
        "harness",
        "start",
        "--workspace",
        gitWorkspaceId,
        "--harness",
        "pi",
        "--provider",
        "dgx-spark",
        "--model",
        "qwen3.8-flash-next-nvidia-nvfp4",
        "--prompt",
        "reply with the single word ready",
      ]);
      assert.equal(piSession.ok, true, `local Pi seed failed: ${piSession.error?.message ?? ""}`);
      const automation = await oldCli([
        "automation",
        "create",
        "--name",
        "upgrade-seed",
        "--cron",
        "* * * * *",
        "--workspace",
        gitWorkspaceId,
        "--harness",
        "pi",
        "--prompt",
        "reply with the single word ready",
        "--disabled",
      ]);
      assert.equal(automation.ok, true, `automation seed failed: ${automation.error?.message ?? ""}`);
    } finally {
      await stopOwned(oldDaemon, "previous-bundle daemon");
    }
    // The CANDIDATE build opens the same data dir: everything survives.
    await launchDesktop(upgradeDataDir);
    try {
      await emulatePageFocus(page);
      const refusalOverlay = await page.locator("[data-dadir-refusal-overlay]").count();
      assert.equal(refusalOverlay, 0, "a same-or-older data dir must never show the refusal dialog");
      const status = await page.evaluate(() => window.drogon.status());
      assert.equal(status.ok, true, "candidate daemon must serve the upgraded dir");
      // The sidebar loads workspaces asynchronously after boot; wait for the
      // seeded projects instead of snapshotting a possibly-empty first frame.
      for (const name of [path.basename(gitProject), path.basename(folderProject)])
        await page.getByText(name, { exact: false }).first().waitFor({ timeout: 20_000 });
      const snapshot = await page.locator("body").ariaSnapshot();
      for (const name of [path.basename(gitProject), path.basename(folderProject)])
        assert.ok(
          snapshot.includes(name),
          `project card for ${name} must render after upgrade`,
        );
      const sessions = JSON.parse(
        (
          await runAcceptanceProcess(
            packaged.cli,
            ["--data-dir", upgradeDataDir, "--json", "terminal", "list"],
            {},
          )
        ).stdout,
      );
      assert.equal(sessions.ok, true);
      assert.ok(
        sessions.result.sessions.length >= 3,
        `seeded sessions must survive the upgrade, saw ${sessions.result.sessions.length}`,
      );
      const worktrees = JSON.parse(
        (
          await runAcceptanceProcess(
            packaged.cli,
            [
              "--data-dir",
              upgradeDataDir,
              "--json",
              "worktree",
              "list",
              "--project",
              upgradeProjects[0].id,
            ],
            {},
          )
        ).stdout,
      );
      assert.equal(worktrees.ok, true);
      assert.ok(worktrees.result.worktrees.length >= 3, "seeded worktrees must survive");
      await page.screenshot({ path: path.join(output, "upgrade-from-previous-build-after.png") });
      report.checks.push("upgrade-from-previous-build-data-survives");
    } finally {
      if (browser) await browser.close().catch(() => {});
      await stopOwned(desktop, "upgrade desktop");
      await stopUpgradePhaseDaemons().catch((error) => {
        report.cleanup.push(`upgrade-phase daemon cleanup: ${error.message}`);
        report.status = "FAILED";
      });
      desktop = null;
      browser = null;
      page = null;
    }
    // The upgrade phase's finally already stopped its detached daemon; a
    // second sweep is cheap insurance before the downgrade relaunch.
    await stopUpgradePhaseDaemons();
    // Downgrade refusal: a future schema version is exactly what a newer
    // build leaves behind. The candidate must refuse with the dialog naming
    // the data dir — never a hang, never a silent blank window.
    await runAcceptanceProcess(
      "/usr/bin/sqlite3",
      [
        path.join(upgradeDataDir, "drogon.sqlite3"),
        "UPDATE schema_versions SET version = 99 WHERE component = 'bots';",
      ],
      {},
    );
    await launchDesktop(upgradeDataDir);
    try {
      await emulatePageFocus(page);
      const dialog = page.locator("[data-dadir-refusal-overlay]");
      await dialog.waitFor({ state: "visible", timeout: 30_000 });
      const dialogText = await dialog.innerText();
      assert.ok(
        dialogText.includes("is newer than") && dialogText.includes(upgradeDataDir),
        `refusal dialog must name the marker and the data dir, got: ${dialogText.slice(0, 400)}`,
      );
      await page.screenshot({ path: path.join(output, "upgrade-from-previous-build-refusal.png") });
      report.checks.push("upgrade-from-previous-build-downgrade-refusal-dialog");
    } finally {
      if (browser) await browser.close().catch(() => {});
      await stopOwned(desktop, "refusal desktop");
      await stopUpgradePhaseDaemons().catch((error) => {
        report.cleanup.push(`refusal-phase daemon cleanup: ${error.message}`);
        report.status = "FAILED";
      });
      desktop = null;
      browser = null;
      page = null;
    }
    ranUpgradeCheck = true;
  }
  report.status = "PASSED";
} catch (error) {
  report.error = error.message;
  report.errorStack = error.stack;
  const evidencePage = page ?? lastLivePage;
  if (evidencePage) {
    report.failureService = await evidencePage
      .evaluate(() => window.drogon.status())
      .catch((cause) => ({ error: cause.message }));
    await evidencePage
      .screenshot({ path: path.join(output, "failure.png") })
      .catch(() => {});
    report.failureUi = await evidencePage
      .locator("body")
      .ariaSnapshot()
      .catch(() => "Unavailable");
  }
} finally {
  if (page && registered) {
    try {
      const cleanup = await page.evaluate(async (id) => {
        const value = await window.drogon.sessions(id);
        if (!value.ok) throw new Error(value.error.message);
        return Promise.all(
          value.result.sessions.map((item) =>
            window.drogon.stop({
              sessionId: item.id,
              incarnation: item.incarnation,
            }),
          ),
        );
      }, registered.id);
      assert.ok(
        cleanup.every((value) => value.ok && value.result.verdict === "exited"),
      );
      report.cleanup.push("owned workspace sessions: exited");
    } catch {
      report.status = "FAILED";
      report.cleanup.push("owned workspace sessions: unverifiable");
    }
  }
  if (browser) await browser.close().catch(() => {});
  await stopOwned(desktop, "desktop");
  await stopOwned(daemon, "daemon");
  if (fixtureDaemon) {
    try {
      await fixtureDaemon.stop();
      report.cleanup.push("exact packaged fixture daemon and sessions: exited");
    } catch (error) {
      report.status = "FAILED";
      report.cleanup.push(`packaged fixture cleanup: ${error.message}`);
    }
  }
  if (foregroundObservation) {
    try {
      report.osForeground = await foregroundObservation.stop();
      verifyForegroundObservation(report.osForeground, report.desktopPids);
      report.checks.push("macos-no-desktop-activation-or-visible-windows");
      report.cleanup.push("OS foreground observer: exited");
    } catch (error) {
      report.status = "FAILED";
      report.error = [report.error, error.message].filter(Boolean).join("; ");
    }
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.checks,
      error: report.error,
      report: path.join(output, "report.json"),
    }),
  );
}
if (report.status !== "PASSED") process.exitCode = 1;
// The upgrade phases leave an intentionally detached daemon (stopped by
// exact scratch-dir match in their own finally blocks); on this path a
// surviving child can hold the runner's stdio long after the report is
// written, so the harness exits explicitly instead of draining the loop.
// The default path below keeps the historical drain-and-return behavior.
if (ranUpgradeCheck) {
  // Self-cleaning sweep: any Electron/drogond this run left attached to its
  // own fixture dir (exact dgu-* match — never a sibling worktree's) dies
  // here, so the harness cannot leak an instance past process.exit.
  const { execFileSync } = await import("node:child_process");
  try {
    const out = execFileSync("/usr/bin/pgrep", ["-f", fixture], {
      encoding: "utf8",
    }).trim();
    for (const pid of out ? out.split("\n") : []) {
      try {
        execFileSync("/bin/kill", ["-9", pid]);
      } catch {}
    }
  } catch {}
  process.exit(process.exitCode ?? 0);
}
