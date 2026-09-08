import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { runAcceptanceProcess } from "./acceptance-process.mjs";

// CLI exits non-zero on error envelopes while printing the JSON envelope;
// returns the parsed envelope either way (same posture as
// probe-packaged-surfaces.mjs's private helper).
async function runCliJson(cli, args, options) {
  try {
    return JSON.parse((await runAcceptanceProcess(cli, args, options)).stdout);
  } catch (error) {
    if (typeof error.stdout === "string" && error.stdout.trim().length > 0)
      return JSON.parse(error.stdout);
    throw error;
  }
}

/**
 * One CDP round trip against the live renderer, hard-bounded at `budgetMs`.
 * Resolves { ok, ms } — a renderer whose main process stopped servicing
 * DevTools surfaces as `ok: false` with the budget elapsed, never as a
 * throw. This is the incident's exact observable (#309): connectOverCDP
 * timing out while every process reports alive.
 */
async function cdpPing(page, budgetMs) {
  const startedAt = Date.now();
  try {
    await Promise.race([
      page.evaluate(() => 1 + 1),
      delay(budgetMs).then(() => {
        throw new Error(`cdp ping exceeded ${budgetMs}ms budget`);
      }),
    ]);
    return { ok: true, ms: Date.now() - startedAt };
  } catch {
    return { ok: false, ms: Date.now() - startedAt };
  }
}

async function restartDaemonThroughSettings(page, pingBudgetMs) {
  const mod = await page.evaluate(() =>
    navigator.userAgent.includes("Mac") ? "Meta" : "Control",
  );
  await page.keyboard.press(`${mod}+,`);
  const settings = page.locator(".settings-view-shell");
  await settings.waitFor();
  await settings.getByRole("button", { name: "Terminal", exact: true }).click();
  const terminal = page.locator('[data-settings-section="terminal"]');
  await terminal.waitFor();
  const restart = terminal.getByRole("button", {
    name: "Restart daemon",
    exact: true,
  });
  await restart.waitFor();
  await restart.click();
  await terminal
    .getByRole("button", { name: "Confirm restart daemon", exact: true })
    .click();
  // The restart window is the incident's exact shape: the daemon socket goes
  // away and comes back while persisted browser guests stay alive. The
  // renderer must keep answering CDP for the whole window — sample it.
  const restarted = page.getByText("Daemon restarted.", { exact: true });
  const deadline = Date.now() + 30000;
  const pings = [];
  for (;;) {
    const ping = await cdpPing(page, pingBudgetMs);
    pings.push(ping);
    assert.equal(
      ping.ok,
      true,
      `renderer stopped answering CDP during the daemon restart (${ping.ms}ms)`,
    );
    if (await restarted.isVisible().catch(() => false)) break;
    assert.ok(
      Date.now() < deadline,
      "daemon restart never completed within 30s",
    );
    await delay(250);
  }
  const worst = pings.reduce((max, ping) => Math.max(max, ping.ms), 0);
  await settings.getByRole("button", { name: "Back to app", exact: true }).click();
  await page.locator(".settings-view-shell").waitFor({ state: "hidden" });
  return worst;
}

async function createBrowserTab(page, url, tabNamePattern) {
  await page.getByRole("button", { name: "New tab", exact: true }).first().click();
  await page.getByRole("menuitem", { name: /^New Browser Tab/ }).click();
  const pane = page.locator('[data-testid="browser-pane"]');
  await pane.waitFor();
  // User-shaped address entry (focus handlers arm Enter-to-navigate); the
  // value is verified and retyped boundedly because the focus handlers can
  // swallow leading keystrokes on a loaded machine (probeTabStripAndBrowser
  // documents the same posture).
  const address = pane.getByLabel("Address", { exact: true });
  const selectAll = (await page.evaluate(() => navigator.userAgent.includes("Mac")))
    ? "Meta+A"
    : "Control+A";
  let addressValue = "";
  for (let attempt = 0; attempt < 3 && addressValue !== url; attempt++) {
    await address.click({ timeout: 15000 });
    await page.keyboard.press(selectAll);
    await address.pressSequentially(url, { timeout: 15000 });
    addressValue = await address.inputValue();
  }
  assert.equal(addressValue, url, "the address bar must hold the guest URL");
  await page.keyboard.press("Enter");
  // Untitled guest pages name their strip tab by URL, so each member of the
  // pair is findable by host exactly like QA r9's 127.0.0.1/localhost pair.
  await page
    .locator('[role="tablist"][aria-label="Sessions"]')
    .getByRole("tab", { name: new RegExp(tabNamePattern) })
    .first()
    .waitFor({ timeout: 30000 });
}

async function waitForBothTabsUsable(cli, dataDir, workspaceId, urls, marker) {
  const deadline = Date.now() + 60000;
  let lastError = "no attempts";
  for (;;) {
    try {
      const listed = await runCliJson(
        cli,
        ["--data-dir", dataDir, "--json", "browser", "tabs", "--workspace", workspaceId],
        { timeout: 30000 },
      );
      if (listed.ok === true) {
        const tabs = urls
          .map((url) =>
            listed.result.tabs.find(
              (tab) => tab.url === url && tab.loading === false,
            ),
          )
          .filter(Boolean);
        if (tabs.length === urls.length) {
          const snapshots = [];
          for (const tab of tabs) {
            const attempt = () =>
              runCliJson(
                cli,
                ["--data-dir", dataDir, "--json", "browser", "snapshot", "--tab", tab.tabId, "--timeout-ms", "25000"],
                { timeout: 40000 },
              );
            let snapshot = await attempt();
            // The relay ride (8s long-poll plus a guest round trip) can
            // exceed the CLI's default hold under acceptance load; the
            // failure is typed retryable, so one bounded retry is
            // principled, then fail closed (same posture as
            // probeTabStripAndBrowser).
            if (!snapshot.ok && snapshot.error?.retryable) snapshot = await attempt();
            snapshots.push(snapshot);
          }
          if (
            snapshots.every(
              (snapshot) =>
                snapshot.ok === true &&
                JSON.stringify(snapshot.result).includes(marker),
            )
          )
            return;
        }
      } else lastError = JSON.stringify(listed.error ?? listed);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() >= deadline)
      throw new Error(
        `persisted browser tabs never became usable again (last: ${lastError})`,
      );
    await delay(500);
  }
}

/**
 * Sealed UI probe for #309: two persisted local browser tabs (127.0.0.1 and
 * localhost — QA r9's pair) must survive BOTH daemon-restart paths —
 * Settings → Restart daemon, and a quit/relaunch whose stop path quiescently
 * shuts the bundled daemon down so relaunch spawns a replacement — with the
 * renderer answering CDP within budget throughout, and the tabs usable after
 * each restart. No mocks: the guests are real WebContentsView targets, the
 * restarts are the real UI and daemon journeys.
 */
export async function probeRenderedBrowserTabsAcrossDaemonRestart({
  page,
  workspaceId,
  cli,
  dataDir,
  output,
  /** Quits the app, quiescently stops the daemon, launches a fresh app; resolves { page, readyAt } once the fresh renderer is ready. */
  relaunch,
  /** CDP budget that encodes "the renderer answers": 5s per the issue. */
  pingBudgetMs = 5000,
}) {
  const marker = `TABS_RESTART_${Date.now()}`;
  // Untitled pages keep Electron's URL-fallback tab naming, so both tabs are
  // addressed by their distinct host names like QA r9's pair.
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      `<html><body><h1>${marker}</h1><p>${request.url}</p></body></html>`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const urls = [`http://127.0.0.1:${port}/`, `http://localhost:${port}/`];
  const checks = [];
  try {
    // Persist QA r9's pair: two local tabs against one loopback server.
    await createBrowserTab(page, urls[0], "127\\.0\\.0\\.1");
    await createBrowserTab(page, urls[1], "localhost");
    await waitForBothTabsUsable(cli, dataDir, workspaceId, urls, marker);

    // Path 1: Settings → Restart daemon; the renderer answers CDP for the
    // whole restart window and the pair stays usable afterwards.
    const worstRestartPing = await restartDaemonThroughSettings(page, pingBudgetMs);
    const settled = await cdpPing(page, pingBudgetMs);
    assert.equal(settled.ok, true, "renderer must answer CDP after the daemon restart");
    checks.push(
      `persisted-browser-tabs-renderer-answers-cdp-throughout-daemon-restart-worst-${worstRestartPing}-ms`,
    );
    await waitForBothTabsUsable(cli, dataDir, workspaceId, urls, marker);
    checks.push("persisted-browser-tabs-usable-after-settings-daemon-restart");

    // Path 2: quit/relaunch whose stop quiescently shuts the daemon down, so
    // the relaunched app bootstraps a replacement (the QA r9 relaunch shape).
    const { page: relaunchedPage, readyAt } = await relaunch();
    page = relaunchedPage;
    // The QA driver's `snapshot` is an aria snapshot over CDP: measure the
    // exact observable, plus the raw evaluate ping, both within budget.
    const snapshotStart = Date.now();
    await page.locator("body").ariaSnapshot({ timeout: pingBudgetMs });
    const snapshotMs = Date.now() - snapshotStart;
    const ping = await cdpPing(page, pingBudgetMs);
    assert.equal(
      ping.ok,
      true,
      `renderer must answer CDP within ${pingBudgetMs}ms of relaunch readiness`,
    );
    const latency = Math.max(snapshotStart + snapshotMs, Date.now()) - readyAt;
    assert.ok(
      latency <= pingBudgetMs,
      `renderer must answer a snapshot within ${pingBudgetMs}ms of readiness (snapshot ${snapshotMs}ms, ping ${ping.ms}ms)`,
    );
    checks.push(`packaged-relaunch-cdp-snapshot-${snapshotMs}-ms-ping-${ping.ms}-ms-after-readiness`);
    // The persisted pair is re-created from the stored strip record and both
    // guests answer through the replacement daemon's relay.
    await waitForBothTabsUsable(cli, dataDir, workspaceId, urls, marker);
    checks.push(
      "packaged-relaunch-restarts-daemon-and-restores-usable-persisted-browser-tabs",
    );
    await page.screenshot({
      path: path.join(output, "browser-tabs-after-restarts.png"),
      animations: "disabled",
    });
    // Leave the strip as the probe found it: closing both tabs rewrites the
    // persisted envelope, so later acceptance steps see the pre-probe strip.
    for (const pattern of ["127\\.0\\.0\\.1", "localhost"]) {
      await page
        .locator('[role="tablist"][aria-label="Sessions"]')
        .getByRole("button", { name: new RegExp(`Close .*${pattern}`) })
        .first()
        .click();
    }
    await page.waitForFunction(
      () =>
        !document
          .querySelector('[role="tablist"][aria-label="Sessions"]')
          ?.textContent?.match(/127\.0\.0\.1|localhost/),
      undefined,
      { timeout: 15000 },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  return checks;
}
