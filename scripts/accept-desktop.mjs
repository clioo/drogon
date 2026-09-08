import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
import { probeRenderedHarness } from "./probe-rendered-harness.mjs";
import { probeRenderedFiles } from "./probe-rendered-files.mjs";
import { probeEditorKeyboardInput } from "./probe-editor-keyboard-input.mjs";
import { probeRenderedTabs } from "./probe-rendered-tabs.mjs";
import {
  probeGhUnavailable,
  probePackagedSurfaces,
} from "./probe-packaged-surfaces.mjs";
import { waitForTerminalText } from "./acceptance-terminal-text.mjs";
import {
  bundlePaths,
  sealedBundleDigest,
  verifiedBuildInfo,
  verifySealedBundle,
} from "./desktop-artifacts.mjs";
import { packagedFixtureDaemon } from "./packaged-fixture-daemon.mjs";

const args = process.argv.slice(2);
const bundle =
  args[0] === "--bundle" ? path.resolve(args.splice(0, 2)[1]) : null;
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
const fixtureDaemon = packaged
  ? packagedFixtureDaemon(packaged.daemon, packaged.cli, dataDir)
  : null;
const workspace = path.join(fixture, "folder");
await mkdir(workspace);
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
  fixture,
};
let daemon, desktop, browser, page, registered;
async function stopOwned(child, label) {
  if (!child) return;
  const result = await stopAcceptanceProcess(child);
  if (result.forced || result.verdict !== "exited") report.status = "FAILED";
  if (result.forced)
    report.cleanup.push(`${label}: required force after timeout`);
  report.cleanup.push(`${label}: ${result.verdict}`);
  return result;
}
async function launchDesktop() {
  const child = startAcceptanceProcess(
    packaged?.executable ?? electron,
    [...(packaged ? [] : [appDir]), "--remote-debugging-port=0"],
    {
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        DROGON_DATA_DIR: dataDir,
        DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"),
        DROGON_BACKGROUND_WINDOW: "1",
        ...(process.platform !== "win32" ? { SHELL: "/bin/sh" } : {}),
        ...(packaged ? { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" } : {}),
        ...(withHarness
          ? { PI_CODING_AGENT_DIR: path.join(fixture, "pi") }
          : {}),
      },
    },
  );
  desktop = child;
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
  await emulatePageFocus(page);
  assert.ok(page, "Electron must create a rendered page");
  page.setDefaultTimeout(15000);
  // R9-B: the sidebar footer is the source toolbar now (settings, help,
  // reveal) — the "Service x.y.z" text is gone, so readiness waits for it.
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor();
}
try {
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
          ...(withHarness
            ? { PI_CODING_AGENT_DIR: path.join(fixture, "pi") }
            : {}),
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
  // the composer opens the implicit workspace straight away.
  await page.getByRole("button", { name: "New workspace", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Create workspace" });
  await composer.locator("#composer-project").selectOption({ label: "folder" });
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
  await waitForTerminalText(page, marker);
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
  await runAcceptanceProcess("git", [...gitIdentity, "add", "notes.txt"], {
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
  await worktreeComposer.locator("#composer-project").selectOption({ label: "repo" });
  const gitComposer = page.getByRole("dialog", { name: "Create worktree" });
  await gitComposer.getByLabel("Branch name").fill("demo-a");
  await gitComposer.getByRole("button", { name: "Create worktree" }).click();
  await page.getByRole("button", { name: "Select demo-a" }).waitFor();
  await page.locator(".shell-project-row", { hasText: "repo" }).waitFor();
  report.checks.push("composer-creates-git-worktree-and-selects-it");
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
  report.status = "PASSED";
} catch (error) {
  report.error = error.message;
  report.errorStack = error.stack;
  if (page) {
    report.failureService = await page
      .evaluate(() => window.drogon.status())
      .catch((cause) => ({ error: cause.message }));
    await page
      .screenshot({ path: path.join(output, "failure.png") })
      .catch(() => {});
    report.failureUi = await page
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
