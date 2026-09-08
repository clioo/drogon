import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  runAcceptanceProcess,
  startAcceptanceProcess,
  waitAcceptanceExit,
} from "./acceptance-process.mjs";
import { waitForBridgeObservation } from "./acceptance-bridge-observation.mjs";

// What "the session list still renders honestly after a daemon restart"
// means (issue #222): the pre-restart waiting session is still listed with
// its wait stamp (now honestly `unverifiable`, never auto-exited), and the
// pre-restart exited session is still listed — including a legacy row that
// still carries its last agent-state timestamp — with no wipe.
export function assertRestartedSessionList(sessions, { waitedId, exitedId }) {
  assert.ok(Array.isArray(sessions), "session.list must return a sessions array");
  const waited = sessions.find((item) => item.id === waitedId);
  assert.ok(waited, "pre-restart waiting session is still listed");
  assert.equal(waited.verdict, "unverifiable");
  assert.equal(waited.agentState, "needs_input");
  assert.ok(waited.agentStateAt, "the wait stamp survives the restart");
  const exited = sessions.find((item) => item.id === exitedId);
  assert.ok(exited, "pre-restart exited session is still listed without a wipe");
  assert.equal(exited.verdict, "exited");
  assert.equal(exited.agentState, "exited");
}

async function cliJson(cliBin, dataDir, args) {
  const response = await runAcceptanceProcess(cliBin, [
    "--data-dir",
    dataDir,
    "--json",
    ...args,
  ]);
  return JSON.parse(response.stdout);
}

async function bridgeSessions(page, workspaceId) {
  return page.evaluate(async (id) => {
    const response = await window.drogon.sessions(id);
    if (!response.ok) throw new Error(response.error.message);
    return response.result.sessions;
  }, workspaceId);
}

async function bridgeStop(page, identity) {
  return page.evaluate(async (item) => {
    const response = await window.drogon.stop(item);
    if (!response.ok) throw new Error(response.error.message);
    return response.result;
  }, identity);
}

async function waitForDaemon(cliBin, dataDir) {
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      const status = await cliJson(cliBin, dataDir, ["status"]);
      if (status.ok) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() >= deadline) throw new Error("restarted daemon never came up");
    await delay(100);
  }
}

// Seeds rows straight into SQLite while the daemon is down, so the probe
// never orphans a real PTY: a SIGKILLed daemon's children outlive it and no
// handle-less session can ever be reaped through RPC again.
const SEED = `
import sqlite3, sys
db, ws, wid, eid, stamp, now = sys.argv[1:7]
conn = sqlite3.connect(db)
host = conn.execute("SELECT value FROM meta WHERE key = 'host_id'").fetchone()[0]
conn.execute(
  "INSERT INTO sessions (id, workspace_id, host_id, incarnation, command,"
  " args_json, cols, rows, verdict, exit_code, created_at, harness_id,"
  " needs_input_at) VALUES (?, ?, ?, 'inc-waited', '/bin/sh', '[]',"
  " 80, 24, 'live', NULL, ?, NULL, ?)",
  (wid, ws, host, now, stamp),
)
conn.execute(
  "INSERT INTO sessions (id, workspace_id, host_id, incarnation, command,"
  " args_json, cols, rows, verdict, exit_code, created_at, harness_id,"
  " needs_input_at) VALUES (?, ?, ?, 'inc-exited', '/bin/sh', '[]',"
  " 80, 24, 'exited', 1, ?, NULL, ?)",
  (eid, ws, host, now, stamp),
)
conn.commit()
`;

const UNSEED = `
import sqlite3, sys
db, wid, eid = sys.argv[1:4]
conn = sqlite3.connect(db)
cur = conn.execute("DELETE FROM sessions WHERE id IN (?, ?)", (wid, eid))
assert cur.rowcount == 2, "seeded rows missing"
conn.commit()
`;

export async function probeRenderedSessionRestart({
  page,
  workspaceId,
  output,
  dataDir,
  daemon,
  daemonBin,
  cliBin,
  adoptDaemon,
}) {
  const waitedId = randomUUID();
  const exitedId = randomUUID();
  const stamp = "2026-09-08T06:00:00Z";
  // Close whatever this daemon still owns through RPC first, so the kill
  // below cannot orphan a live PTY: sessions with a retained handle exit
  // for real, and only durable rows survive.
  for (const item of await bridgeSessions(page, workspaceId)) {
    await bridgeStop(page, {
      sessionId: item.id,
      incarnation: item.incarnation,
    });
  }
  // Kill -9 ONLY the daemon PID, exactly like the issue report.
  daemon.kill("SIGKILL");
  const observed = await waitAcceptanceExit(daemon, 10000);
  assert.equal(observed.verdict, "exited");
  const db = path.join(dataDir, "drogon.sqlite3");
  const now = new Date().toISOString();
  await runAcceptanceProcess("python3", [
    "-c",
    SEED,
    db,
    workspaceId,
    waitedId,
    exitedId,
    stamp,
    now,
  ]);
  // The seeded `live` row stands in for a session that was waiting on the
  // agent when the daemon died; the seeded `exited` row stands in for a
  // row written by a pre-fix daemon (#222) that kept its stale wait stamp
  // past the exit. Post-fix daemons clear the stamp on exit, but rows
  // written before the fix must still list without a wipe.
  const next = startAcceptanceProcess(daemonBin, ["--data-dir", dataDir], {
    stdio: "ignore",
    env: { ...process.env },
  });
  adoptDaemon(next);
  await waitForDaemon(cliBin, dataDir);
  // The exact #222 symptom: `terminal list` must succeed after the restart.
  const listed = await cliJson(cliBin, dataDir, ["terminal", "list"]);
  assert.equal(listed.ok, true);
  assertRestartedSessionList(listed.result.sessions, { waitedId, exitedId });
  // The renderer reconnects on its own status poll; only then can the
  // bridge list again. (Bridge predicates poll in Node: a browser
  // predicate returning a Promise is truthy, so page.waitForFunction
  // cannot observe them.)
  await waitForBridgeObservation(page, async () => {
    const status = await window.drogon.status();
    return status.ok === true;
  });
  await waitForBridgeObservation(
    page,
    async ({ id, waitedId, exitedId }) => {
      const response = await window.drogon.sessions(id);
      if (!response.ok) return false;
      const ids = response.result.sessions.map((item) => item.id);
      return ids.includes(waitedId) && ids.includes(exitedId);
    },
    { id: workspaceId, waitedId, exitedId },
  );
  assertRestartedSessionList(await bridgeSessions(page, workspaceId), {
    waitedId,
    exitedId,
  });
  // The #222 side effect: the tab strip must keep its New tab button right
  // after the mid-session restart — and the button must work, proving a
  // post-restart create still lands a live session.
  const newTab = page.getByRole("button", { name: "New tab", exact: true });
  await newTab.first().waitFor();
  assert.ok((await newTab.count()) >= 1, "New tab button survives the restart");
  const tabsBefore = await page.getByRole("tab").count();
  await newTab.first().click();
  await page.getByRole("menuitem", { name: /^New Terminal/ }).click();
  await page.waitForFunction(
    (count) => document.querySelectorAll('[role="tab"]').length === count + 1,
    tabsBefore,
  );
  const created = (await bridgeSessions(page, workspaceId)).find(
    (item) => item.verdict === "live" && item.id !== waitedId && item.id !== exitedId,
  );
  assert.ok(created, "post-restart create lands a live session");
  const stopped = await bridgeStop(page, {
    sessionId: created.id,
    incarnation: created.incarnation,
  });
  assert.equal(stopped.verdict, "exited");
  await page.setViewportSize({ width: 1280, height: 850 });
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({
      path: path.join(output, `session-restart-${colorScheme}.png`),
      animations: "disabled",
    });
  }
  // Remove only the seeded rows; the created-then-closed session stays for
  // the acceptance finally-block, which stops it to `exited` again through
  // its retained handle.
  await runAcceptanceProcess("python3", ["-c", UNSEED, db, waitedId, exitedId]);
  await page.reload();
  await waitForBridgeObservation(page, async ({ id, waitedId, exitedId }) => {
    const response = await window.drogon.sessions(id);
    if (!response.ok) return false;
    const ids = response.result.sessions.map((item) => item.id);
    return !ids.includes(waitedId) && !ids.includes(exitedId);
  }, { id: workspaceId, waitedId, exitedId });
  return [
    "daemon-restart-keeps-terminal-list-with-exited-history",
    "daemon-restart-renders-session-list-with-new-tab",
  ];
}
