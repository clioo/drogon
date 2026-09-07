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
import { probeRenderedHarness } from "./probe-rendered-harness.mjs";
import { probeRenderedFiles } from "./probe-rendered-files.mjs";
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
  assert.ok(page, "Electron must create a rendered page");
  page.setDefaultTimeout(15000);
  await page.getByText("Service 0.1.0", { exact: true }).waitFor();
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
    await page
      .locator(".build-revision")
      .filter({ hasText: build.revision.slice(0, 7) })
      .waitFor();
    report.checks.push(
      "packaged-app-starts-bundled-runtime-with-minimal-path-and-displays-revision",
    );
  }
  assert.deepEqual(
    await page.evaluate(() => ({
      require: typeof window.require,
      process: typeof window.process,
    })),
    { require: "undefined", process: "undefined" },
  );
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .last()
    .click();
  await page.getByLabel("Folder path").fill(workspace);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("heading", { name: "Start a session" }).waitFor();
  registered = await page.evaluate(async () => {
    const response = await window.drogon.workspaces();
    if (!response.ok) throw new Error(response.error.message);
    return response.result.workspaces[0];
  });
  report.checks.push("isolated-renderer-and-real-folder-registration");
  await page
    .getByRole("button", { name: "New terminal", exact: true })
    .last()
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
  await page.waitForFunction(
    (value) =>
      document.querySelector(".xterm-screen")?.textContent?.includes(value),
    marker,
  );
  report.checks.push("rendered-terminal-command-output");
  const original = await page.evaluate(async (id) => {
    const value = await window.drogon.sessions(id);
    return value.ok ? value.result.sessions[0] : null;
  }, registered.id);
  assert.ok(original?.incarnation);
  await page.reload();
  await page.waitForFunction(
    (value) =>
      document.querySelector(".xterm-screen")?.textContent?.includes(value),
    marker,
  );
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
    await page.waitForFunction(
      (value) =>
        document.querySelector(".xterm-screen")?.textContent?.includes(value),
      marker,
    );
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
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "New terminal", exact: true })
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
  await page.waitForFunction(
    (value) =>
      document.querySelector(".xterm-screen")?.textContent?.includes(value),
    marker,
  );
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
  if (withFiles) {
    report.checks.push(
      ...(await probeRenderedFiles({ page, workspace, output })),
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
