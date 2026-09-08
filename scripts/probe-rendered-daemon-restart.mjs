import assert from "node:assert/strict";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runAcceptanceProcess } from "./acceptance-process.mjs";

async function cliStatus(cli, dataDir) {
  const response = await runAcceptanceProcess(cli, [
    "--data-dir",
    dataDir,
    "--json",
    "status",
  ]);
  const envelope = JSON.parse(response.stdout);
  assert.equal(envelope.ok, true, `status must succeed: ${JSON.stringify(envelope)}`);
  return envelope.result;
}

async function waitForStatus(cli, dataDir, previousServiceInstanceId) {
  const deadline = Date.now() + 30000;
  let lastError = "no response";
  for (;;) {
    try {
      const status = await cliStatus(cli, dataDir);
      if (status.serviceInstanceId !== previousServiceInstanceId) return status;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() >= deadline)
      throw new Error(`replacement daemon never became healthy: ${lastError}`);
    await delay(100);
  }
}

async function bridgeSessions(page, workspaceId) {
  return page.evaluate(async (id) => {
    const response = await window.drogon.sessions(id);
    if (!response.ok) throw new Error(response.error.message);
    return response.result.sessions;
  }, workspaceId);
}

async function waitForBridgeSessions(page, workspaceId, ids) {
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const sessions = await bridgeSessions(page, workspaceId);
      if (ids.every((id) => sessions.some((session) => session.id === id)))
        return sessions;
    } catch {
      // The reconnect poll is expected to fail while the old daemon is down.
    }
    if (Date.now() >= deadline)
      throw new Error("renderer did not reconnect after daemon restart");
    await delay(100);
  }
}

/**
 * Sealed UI probe for #259: the packaged app must stop its own sessions,
 * release the old daemon through `runtime.shutdown`, and start the bundled
 * replacement. The only liveness proof is a new authenticated status reply;
 * no daemon PID is inspected or signalled.
 */
export async function probeRenderedDaemonRestart({
  page,
  workspaceId,
  cli,
  dataDir,
  output,
}) {
  const beforeStatus = await cliStatus(cli, dataDir);
  const beforeSessions = await bridgeSessions(page, workspaceId);
  assert.ok(
    beforeSessions.some((session) => session.verdict === "live"),
    "daemon restart probe needs a live session to stop",
  );
  const beforeIds = beforeSessions.map((session) => session.id);

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
  await page.getByText("Daemon restarted.", { exact: true }).waitFor({
    timeout: 30000,
  });

  const afterStatus = await waitForStatus(cli, dataDir, beforeStatus.serviceInstanceId);
  assert.notEqual(afterStatus.serviceInstanceId, beforeStatus.serviceInstanceId);
  const afterSessions = await waitForBridgeSessions(page, workspaceId, beforeIds);
  for (const session of afterSessions.filter((item) => beforeIds.includes(item.id)))
    assert.equal(
      session.verdict,
      "exited",
      `session ${session.id} must be stopped before daemon shutdown`,
    );
  await page.screenshot({
    path: path.join(output, "daemon-restart.png"),
    animations: "disabled",
  });
  await settings.getByRole("button", { name: "Back to app", exact: true }).click();
  await page.locator(".settings-view-shell").waitFor({ state: "hidden" });
  return [
    "packaged-daemon-restart-stops-live-session-and-spawns-new-service-instance",
    "packaged-daemon-restart-reconnects-renderer-and-retains-exited-session",
  ];
}
