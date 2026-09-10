import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { startAcceptanceProcess, stopAcceptanceProcess } from "./acceptance-process.mjs";
import { bundlePaths, sealedBundleDigest, fingerprintBundle } from "./desktop-artifacts.mjs";
import { packagedFixtureDaemon } from "./packaged-fixture-daemon.mjs";

/** Real archived daemon, current packaged consumers, then actual native migrations.
 * No provider calls are made; the Pi launch uses the caller's private HOME/route. */
export async function probeMixedVersionRecovery({ oldBundle, packaged, fixture, fixtureBin, output, launch, close }) {
  const old = bundlePaths(oldBundle);
  const oldIdentity = await sealedBundleDigest(oldBundle);
  // Verify the archived bytes without requiring today's icon branding on
  // this deliberately pre-feature baseline. This is not install authority.
  const oldBuild = JSON.parse(await readFile(old.info, "utf8"));
  const oldFingerprint = await fingerprintBundle(oldBundle);
  assert.equal(oldBuild.dirty, false);
  assert.match(oldBuild.revision, /^[a-f0-9]{40}$/);
  assert.deepEqual(oldBuild.artifacts, oldFingerprint.artifacts);
  assert.equal(oldBuild.artifactDigest, oldFingerprint.artifactDigest);
  const dataDir = path.join(fixture, "mixed-version-data");
  const legacyPath = path.join(fixture, "mixed-legacy-folder");
  await mkdir(legacyPath, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(legacyPath, "keep.txt"), "legacy files stay untouched\n");
  const checks = [];
  const exitedPeers = [];
  let peer = null;
  let child = null;
  let page = null;
  let stage = "old-daemon-start";
  async function stopPeer() {
    if (!peer) return;
    const sessions = await peer.rpc("session.list");
    for (const session of sessions.sessions) {
      if (session.verdict === "exited") continue;
      assert.equal(session.verdict, "live", "do not force cleanup of an unverifiable session");
      const stopped = await peer.rpc("session.stop", { sessionId: session.id, incarnation: session.incarnation });
      assert.equal(stopped.verdict, "exited");
    }
    const identity = peer.identity();
    await peer.stop();
    exitedPeers.push({ ...identity, verdict: "exited", proof: "authenticated quiescent shutdown and kernel observer" });
    peer = null;
  }
  try {
    await close();
    child = startAcceptanceProcess(old.daemon, ["--data-dir", dataDir], {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, DROGON_DATA_DIR: dataDir, PATH: `${fixtureBin}${path.delimiter}${process.env.PATH ?? ""}`, SHELL: "/bin/sh" },
    });
    peer = packagedFixtureDaemon(old.daemon, packaged.cli, dataDir);
    const deadline = Date.now() + 15000;
    while (true) {
      try { await peer.capture(); break; }
      catch (error) { if (Date.now() >= deadline) throw error; await delay(100); }
    }
    const original = await peer.rpc("status");
    assert(!original.capabilities.includes("agent.settings.v1"), "baseline must actually lack Agent settings");
    assert(!original.capabilities.includes("bot.snapshot.v1"), "baseline must actually lack Bots");
    const workspace = await peer.rpc("workspace.register", { path: legacyPath });
    const incumbent = await peer.rpc("session.start", { workspaceId: workspace.id, command: "/bin/sh", args: ["-c", "printf MIXED_INCUMBENT_ALIVE; sleep 300"] });
    page = await launch(dataDir);
    await page.getByRole("button", { name: "Sessions", exact: true }).click();
    await page.waitForFunction((id) => window.__drogonTerminals?.has(id), incumbent.id, { timeout: 15000 });
    const attached = await page.evaluate(() => window.drogon.status());
    assert.equal(attached.ok, true);
    assert.equal(attached.result.serviceInstanceId, original.serviceInstanceId);
    assert.equal(child.exitCode, null, "the incumbent daemon must not be replaced");
    checks.push("mixed-version-packaged-client-attaches-to-real-incumbent-without-replacing-it");
    stage = "launch-without-agent-settings";
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem").filter({ has: page.getByText("Pi", { exact: true }) }).click();
    await page.waitForFunction(async ({ workspaceId, incumbentId }) => {
      const result = await window.drogon.sessions(workspaceId);
      return result.ok && result.result.sessions.some((session) => session.id !== incumbentId && session.verdict === "live");
    }, { workspaceId: workspace.id, incumbentId: incumbent.id }, { timeout: 15000 });
    const launched = (await peer.rpc("session.list", { workspaceId: workspace.id })).sessions.find((session) => session.id !== incumbent.id && session.verdict === "live");
    const catalog = await peer.rpc("harness.list");
    const pi = catalog.harnesses.find((item) => item.harnessId === "pi");
    assert.equal(pi?.availability, "available");
    assert.equal(launched.command, pi.executable, "the UI must launch the real discovered Pi executable, including resolved symlinks");
    checks.push("mixed-version-missing-agent-settings-does-not-block-real-pi-launch");
    stage = "bots-consumer";
    await page.getByRole("button", { name: "Bots", exact: true }).click();
    await page.getByRole("status").filter({ hasText: /service.*does not support Bots/i }).waitFor();
    assert.equal(await page.getByRole("button", { name: /create bot/i }).count(), 0);
    await page.screenshot({ path: path.join(output, "mixed-version-bots.png") });
    stage = "agents-consumer";
    await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
    await page.locator(".settings-view-shell aside").getByRole("button", { name: "Agents", exact: true }).click();
    const notice = page.getByRole("status").filter({ hasText: /service.*does not support Agent settings/i });
    await notice.waitFor();
    assert.match(await notice.innerText(), /Settings.*Terminal/);
    assert.match(await notice.innerText(), /stops every session/);
    assert.equal((await peer.rpc("status")).serviceInstanceId, original.serviceInstanceId);
    assert.equal((await peer.rpc("session.read", { sessionId: incumbent.id, incarnation: incumbent.incarnation, cursor: 0 })).session.verdict, "live");
    const piRead = await peer.rpc("session.read", { sessionId: launched.id, incarnation: launched.incarnation, cursor: 0 });
    assert.equal(piRead.session.verdict, "live");
    assert(Buffer.from(piRead.dataBase64, "base64").toString().includes("acceptance-only"), "the legacy launch must reach the real privately configured Pi editor");
    await page.screenshot({ path: path.join(output, "mixed-version-agent-settings.png") });
    checks.push("mixed-version-bots-and-agent-settings-show-safe-specific-notices-with-live-sessions-preserved");
    stage = "legacy-migration";
    await stopPeer();
    await close();
    page = await launch(dataDir);
    peer = packagedFixtureDaemon(packaged.daemon, packaged.cli, dataDir);
    await peer.capture();
    await page.getByRole("button", { name: "Sessions", exact: true }).click();
    await page.getByRole("button", { name: "Select mixed-legacy-folder", exact: true }).waitFor();
    const projects = await peer.rpc("project.list");
    assert(projects.projects.some((project) => project.path === workspace.path));
    assert.equal(await readFile(path.join(legacyPath, "keep.txt"), "utf8"), "legacy files stay untouched\n");
    checks.push("legacy-pre-projects-registration-recovers-through-real-packaged-upgrade");
    const orphanPath = path.join(fixture, "already-upgraded-orphan");
    const removedPath = path.join(fixture, "intentionally-removed-project");
    await mkdir(orphanPath); await mkdir(removedPath);
    const orphan = await peer.rpc("workspace.register", { path: orphanPath });
    const removed = await peer.rpc("project.add", { path: removedPath });
    await peer.rpc("project.remove", { id: removed.id });
    await stopPeer();
    await close();
    // Regression input: the affected store's Projects v3 marker plus an
    // unrepresented workspace. Extra additive columns are deliberately kept.
    const db = new DatabaseSync(path.join(dataDir, "drogon.sqlite3"));
    try { assert.equal(db.prepare("UPDATE schema_versions SET version = 3 WHERE component = 'projects'").run().changes, 1); }
    finally { db.close(); }
    stage = "already-upgraded-recovery";
    page = await launch(dataDir);
    peer = packagedFixtureDaemon(packaged.daemon, packaged.cli, dataDir);
    await peer.capture();
    await page.getByRole("button", { name: "Sessions", exact: true }).click();
    await page.getByRole("button", { name: "Select already-upgraded-orphan", exact: true }).waitFor();
    const recovered = await peer.rpc("project.list");
    assert.equal(recovered.projects.filter((project) => project.path === orphan.path).length, 1);
    assert(!recovered.projects.some((project) => project.path === removed.path));
    await page.screenshot({ path: path.join(output, "legacy-registration-recovery.png") });
    checks.push("already-upgraded-orphan-recovers-once-without-resurrecting-intentionally-removed-project");
    assert.deepEqual(await sealedBundleDigest(oldBundle), oldIdentity);
    return checks;
  } catch (error) {
    await page?.screenshot({ path: path.join(output, "mixed-version-failure.png") }).catch(() => {});
    throw error;
  } finally {
    try {
      await stopPeer();
      await close();
      if (child) {
        const stopped = await stopAcceptanceProcess(child);
        assert.equal(stopped.verdict, "exited");
        assert.equal(stopped.forced, false);
      }
    } finally {
      await writeFile(path.join(output, "mixed-version-recovery.json"), JSON.stringify({ oldRevision: oldBuild.revision, oldIdentity, dataDir, stage, checks, exitedPeers }, null, 2) + "\n");
    }
  }
}
