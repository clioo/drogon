// MIT Copyright (c) 2026 Lovecast Inc.
// Install-resilience P5 sealed probe: a changed `drogond` binary behind a
// still-running detached daemon must never become a silent mismatched
// attach. The probe builds a genuinely different daemon binary (a re-signed
// copy with extra bytes — different sha256, still a runnable drogond),
// installs it as the incumbent against the fixture data dir, and launches
// the app twice:
//   1. clean session state → the app quiesces the changed daemon through
//      its own `runtime.shutdown`, respawns the bundled build, and SHOWS
//      the "Drogon updated …" notice;
//   2. a live session in flight → the daemon refuses to quiesce, the app
//      keeps it attached, shows the honest "update pending" state, and the
//      USER-chosen restart from the banner resolves the update.
// Daemon identity is proved through the daemon's own authenticated
// `status` (serviceInstanceId + daemonArtifactSha256 + processId); exits
// are proved with the kernel exit observer — the probe signals nothing.
import assert from "node:assert/strict";
import { readFileSync, appendFileSync } from "node:fs";
import { chmod, copyFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { runAcceptanceProcess, startAcceptanceProcess } from "./acceptance-process.mjs";
import { startExitObserver } from "./live-child-crash-fixture.mjs";

const OBSERVER_SCRIPT = new URL("./live-child-exit-observer.py", import.meta.url)
  .pathname;

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function rpc(method, params, cli, dataDir) {
  const envelope = JSON.parse(
    (
      await runAcceptanceProcess(cli, [
        "--data-dir",
        dataDir,
        "--json",
        "rpc",
        method,
        "--params",
        JSON.stringify(params ?? {}),
      ])
    ).stdout,
  );
  assert.equal(
    envelope.ok,
    true,
    `${method} must succeed: ${JSON.stringify(envelope)}`,
  );
  return envelope.result;
}

async function rpcStatus(cli, dataDir) {
  return rpc("status", {}, cli, dataDir);
}

async function waitForHealthyDaemon(cli, dataDir, deadlineMs = 30_000) {
  const deadline = Date.now() + deadlineMs;
  let lastError = "no attempt";
  for (;;) {
    try {
      return await rpcStatus(cli, dataDir);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() >= deadline)
      throw new Error(`no daemon answered status: ${lastError}`);
    await delay(100);
  }
}

/**
 * Spawns one detached incumbent daemon from `binaryPath` against `dataDir`
 * and returns its identity (status-derived) plus a scoped kernel-observer
 * exit proof. `exitProven()` reports whether the exit was already proved;
 * `abandon()` releases the observer when a phase failed before the proof —
 * the caller decides any last-resort termination with its own ownership
 * checks; this module never signals.
 */
async function spawnIncumbentDaemon(binaryPath, dataDir, cli) {
  const child = startAcceptanceProcess(
    binaryPath,
    ["--data-dir", dataDir],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  const pid = child.pid;
  assert.ok(pid, "incumbent daemon spawn must produce a pid");
  const status = await waitForHealthyDaemon(cli, dataDir);
  assert.equal(
    status.processId,
    pid,
    "the answering daemon must be the spawned incumbent",
  );
  const observer = await startExitObserver(pid, {
    scriptPath: OBSERVER_SCRIPT,
    deadlineMs: 20_000,
  });
  let exitProvenFlag = false;
  return {
    pid,
    status,
    exitProven: () => exitProvenFlag,
    exitProof: async () => {
      if (exitProvenFlag) return "exit";
      const observed = await observer.waitExit(20_000);
      assert.equal(
        observed,
        "exit",
        `incumbent daemon (pid ${pid}) exit unverifiable via kernel observer: ${observed}`,
      );
      exitProvenFlag = true;
      await observer.stop(3000);
      return observed;
    },
    abandon: async () => {
      try {
        await observer.stop(3000);
      } catch {
        // best-effort observer cleanup after an already-failed proof
      }
    },
  };
}

/** Builds a runnable daemon variant with a genuinely different digest:
 *  strip the ad-hoc signature and re-sign with codesign. The rewritten
 *  CodeDirectory changes the bytes (different sha256) while keeping the
 *  executable structurally valid — appending padding would fail codesign's
 *  strict validation and the kernel's exec check. */
export async function buildSkewVariant(daemonBinary, target) {
  await copyFile(daemonBinary, target);
  await chmod(target, 0o755);
  await runAcceptanceProcess("codesign", ["--remove-signature", target], {
    timeout: 60_000,
  });
  await runAcceptanceProcess("codesign", ["--sign", "-", target], {
    timeout: 60_000,
  });
  await runAcceptanceProcess("codesign", ["--verify", "--strict", target], {
    timeout: 60_000,
  });
  const variantDigest = sha256File(target);
  assert.notEqual(
    variantDigest,
    sha256File(daemonBinary),
    "the re-signed variant must have a genuinely different digest",
  );
  return { variant: target, variantDigest };
}

export async function probeRenderedChangedDaemonBinary({
  page: _page,
  workspaceId,
  cli,
  dataDir,
  daemonBinary,
  output,
  fixture,
  // quit-and-reopen: closes CDP, stops the desktop, launches it again,
  // and resolves with the fresh rendered page (outer `relaunchDesktop`).
  relaunch,
}) {
  const logFile = path.join(output, "changed-binary-probe.log");
  const logStep = (message) => {
    appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
  };
  logStep("probe start");
  const checks = [];
  const bundledDigest = sha256File(daemonBinary);
  const skewBinary = path.join(fixture, "drogond-skew-variant");
  const { variantDigest } = await buildSkewVariant(daemonBinary, skewBinary);
  assert.notEqual(
    variantDigest,
    bundledDigest,
    "the skew variant must have a genuinely different digest",
  );

  // Sanity: the daemon attached right now was spawned by this very bundle,
  // so its self-reported digest must equal the bundled binary's.
  const attached = await rpcStatus(cli, dataDir);
  assert.equal(
    attached.daemonArtifactSha256,
    bundledDigest,
    "sanity: the attached daemon must report the bundled binary's digest",
  );

  let skew = null;
  try {
    // ------------------------------------------------------------- phase 1
    // Clean session state: changed binary → graceful auto-restart + notice.
    await relaunch(); // quit-and-reopen; the detached daemon survives
    let incumbent = await stopBundledDaemon(daemonBinary, cli, dataDir);

    skew = await spawnIncumbentDaemon(skewBinary, dataDir, cli);
    assert.equal(
      skew.status.daemonArtifactSha256,
      variantDigest,
      "the incumbent must report the skew variant's digest",
    );
    const beforeServiceInstanceId = skew.status.serviceInstanceId;
    logStep(`phase 1: incumbent ${beforeServiceInstanceId} pid ${skew.pid}; relaunching the app`);
    const relaunched = await relaunch();
    logStep("phase 1: app relaunched");

    // The honest, visible notice — never a silent attach.
    logStep("phase 1: waiting for the updated banner");
    await relaunched
      .locator('[data-daemon-update-banner="updated"]')
      .waitFor({ timeout: 45_000 });
    logStep("phase 1: updated banner visible");
    checks.push("changed-binary-launch-shows-updated-notice-not-silent-attach");

    const after = await waitForHealthyDaemon(cli, dataDir);
    assert.notEqual(
      after.serviceInstanceId,
      beforeServiceInstanceId,
      "the answering daemon must be a NEW service instance",
    );
    assert.equal(
      after.daemonArtifactSha256,
      bundledDigest,
      "the answering daemon must be this install's bundled binary",
    );
    await skew.exitProof();
    checks.push("changed-binary-launch-restarts-daemon-to-bundled-build");
    await relaunched.screenshot({
      path: path.join(output, "changed-binary-updated-banner.png"),
      animations: "disabled",
    });

    // ------------------------------------------------------------- phase 2
    // A live session in flight: the daemon refuses to quiesce → the app
    // must NOT kill it; it stays attached and the state says "pending".
    await relaunch();
    await stopBundledDaemon(daemonBinary, cli, dataDir);

    const skew2 = await spawnIncumbentDaemon(skewBinary, dataDir, cli);
    try {
      // Give the incumbent a LIVE session so quiescence is genuinely refused.
      const liveSession = await rpc(
        "session.start",
        { workspaceId },
        cli,
        dataDir,
      );
      assert.equal(liveSession.verdict, "live", "the fixture session must be live");
      const liveSessionId = liveSession.id;

      const pendingServiceInstanceId = skew2.status.serviceInstanceId;
      logStep(`phase 2: incumbent ${pendingServiceInstanceId} pid ${skew2.pid} live session ${liveSessionId}; relaunching the app`);
      const relaunched2 = await relaunch();
      logStep("phase 2: app relaunched");

      const banner = relaunched2.locator('[data-daemon-update-banner="pending"]');
      await banner.waitFor({ timeout: 45_000 });
      checks.push("cannot-quiesce-launch-shows-honest-update-pending-state");
      await relaunched2.screenshot({
        path: path.join(output, "changed-binary-pending-banner.png"),
        animations: "disabled",
      });

      // The old daemon is still the one answering — never killed under the user.
      logStep("phase 2: asserting the old daemon still answers");
      const stillOld = await rpcStatus(cli, dataDir);
      assert.equal(
        stillOld.serviceInstanceId,
        pendingServiceInstanceId,
        "a refused quiesce must keep the old daemon attached",
      );
      assert.equal(stillOld.processId, skew2.pid);
      checks.push("cannot-quiesce-keeps-old-daemon-attached-with-skew-signal");

      // The user chooses the restart from the banner (stop-all → shutdown →
      // respawn bundled). Drive the same bridge the button calls, but log
      // main's exact result so a failure names its reason. The button is
      // still asserted enabled first — that is what the user clicks.
      const restartButton = banner.getByRole("button", { name: "Restart service" });
      await restartButton.waitFor({ timeout: 10_000 });
      assert.equal(
        await restartButton.isEnabled(),
        true,
        "the Restart service affordance must be enabled",
      );
      const restartResult = await relaunched2.evaluate(() =>
        window.drogon.daemon.restart(),
      );
      logStep(
        `banner restart bridge result: ${JSON.stringify(restartResult)}`,
      );
      assert.equal(restartResult.restarted, true, "the user-chosen restart must succeed");
      const deadline = Date.now() + 45_000;
      for (;;) {
        const status = await rpcStatus(cli, dataDir);
        if (status.serviceInstanceId !== pendingServiceInstanceId) break;
        if (Date.now() >= deadline)
          throw new Error("banner restart never replaced the incumbent daemon");
        await delay(200);
      }
      logStep("phase 2: waiting for the replacement to answer");
      const resolved = await waitForHealthyDaemon(cli, dataDir);
      assert.equal(resolved.daemonArtifactSha256, bundledDigest);
      logStep(`phase 2: replacement healthy pid ${resolved.processId}`);
      await skew2.exitProof();
      checks.push("user-chosen-banner-restart-resolves-the-pending-update");

      const sessions = await rpc(
        "session.list",
        { workspaceId },
        cli,
        dataDir,
      );
      const row = sessions.sessions.find((item) => item.id === liveSessionId);
      assert.ok(row, "the fixture session row must survive the restart");
      assert.equal(
        row.verdict,
        "exited",
        "the banner restart stops the live session through session.stop",
      );
      // The banner must be gone once the renderer reconnects to the new
      // daemon (identity change → state re-pull → null). The reconnect
      // ladder owns the timing, so bound it generously.
      const clearedDeadline = Date.now() + 60_000;
      for (;;) {
        if ((await relaunched2.locator("[data-daemon-update-banner]").count()) === 0)
          break;
        if (Date.now() >= clearedDeadline)
          throw new Error("the update banner outlived the resolved update");
        await delay(500);
      }
      checks.push("update-banner-clears-after-the-user-chosen-restart");

      // The probe owns its fixture session: the banner restart stopped it
      // (row now exited); forget it so the later keyboard journey sees the
      // same tab population this probe was seeded with.
      const forgotten = await rpc(
        "session.forget",
        { sessionId: liveSessionId, incarnation: liveSession.incarnation },
        cli,
        dataDir,
      );
      assert.equal(forgotten.id, liveSessionId);
    } finally {
      if (!skew2.exitProven()) await skew2.abandon();
    }
  } finally {
    if (skew && !skew.exitProven()) await skew.abandon();
  }
  return checks;
}

/** Gracefully stops the current bundled daemon through its own managed
 *  shutdown (stop-all → runtime.shutdown), scoped to this probe. */
async function stopBundledDaemon(daemonBinary, cli, dataDir) {
  const { packagedFixtureDaemon } = await import("./packaged-fixture-daemon.mjs");
  const incumbent = packagedFixtureDaemon(daemonBinary, cli, dataDir);
  await incumbent.capture();
  await incumbent.stop();
  return incumbent;
}
