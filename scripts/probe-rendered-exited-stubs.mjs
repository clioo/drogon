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

// What "exited stubs behave like the fork's exited sessions" means
// (issue #228): after a full stop/start the strip shows `unverifiable`
// stubs, and every dismissal path must act on them — the tab close forgets
// the record, Retry either re-attaches or surfaces the recovery overlay
// with its Restart action (which revives the tab's command and forgets the
// stub), and Settings → Terminal → Kill all sessions clears them together
// with live sessions. The daemon must keep the liveness rule throughout: a
// forgotten stub answers `unverifiable`, never a fabricated `exited`.
export function assertStubRecordsForgotten(sessions, { absentIds }) {
  assert.ok(Array.isArray(sessions), "session.list must return a sessions array");
  const remaining = sessions.filter((item) => absentIds.includes(item.id));
  assert.deepEqual(
    remaining.map((item) => item.id),
    [],
    `forgotten stub records must not survive in session.list, still present: ${remaining
      .map((item) => `${item.id} (${item.verdict})`)
      .join(", ")}`,
  );
}

export function assertNoLiveRecords(sessions) {
  assert.ok(Array.isArray(sessions), "session.list must return a sessions array");
  assert.deepEqual(
    sessions.map((item) => item.id),
    [],
    `Kill all must leave no session records of any verdict, still present: ${sessions
      .map((item) => `${item.id} (${item.verdict})`)
      .join(", ")}`,
  );
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

async function bridgeClose(page, identity) {
  return page.evaluate(async (item) => {
    const response = await window.drogon.close(item);
    if (!response.ok) throw new Error(response.error.message);
    return response.result;
  }, identity);
}

// Same discipline as probe-packaged-surfaces.mjs: earlier probes leave
// editor/browser tabs in the strip, and this probe asserts the strip's
// exact tab set around the stubs — so they are closed first (answering a
// dirty-close dialog when one appears).
async function closeOpenStripTabs(page) {
  const tabs = page.locator(
    '[role="tablist"][aria-label="Sessions"] [role="tab"]',
  );
  for (let guard = 0; guard < 10 && (await tabs.count()) > 0; guard += 1) {
    const tab = tabs.first();
    await tab.click();
    const closer = tab.getByRole("button", { name: /^Close / });
    if ((await closer.count()) > 0) await closer.first().click({ force: true });
    else {
      const paneClose = page.getByRole("button", { name: "Close", exact: true });
      if ((await paneClose.count()) > 0) await paneClose.first().click();
    }
    const discard = page.getByRole("button", {
      name: /^(Don't save|Close without saving|Discard)$/,
    });
    if ((await discard.count()) > 0) await discard.first().click();
    await page.waitForTimeout(200);
  }
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

// Seeds two rows straight into SQLite while the daemon is down, exactly
// like the issue's restart: on startup the recovery sweep flips them to
// `unverifiable` — the real stub path, not a synthetic verdict. The seed
// never orphans a PTY because no child process is created at all.
const SEED = `
import sqlite3, sys
db, ws, a, b, now = sys.argv[1:6]
conn = sqlite3.connect(db)
host = conn.execute("SELECT value FROM meta WHERE key = 'host_id'").fetchone()[0]
for sid, inc in ((a, "inc-a"), (b, "inc-b")):
    conn.execute(
      "INSERT INTO sessions (id, workspace_id, host_id, incarnation, command,"
      " args_json, cols, rows, verdict, exit_code, created_at, harness_id,"
      " needs_input_at) VALUES (?, ?, ?, ?, '/bin/sh', '[]',"
      " 80, 24, 'live', NULL, ?, NULL, NULL)",
      (sid, ws, host, inc, now),
    )
conn.commit()
`;

// R16-AL2 (fixes #228): kill -9 the owned daemon, seed two `live` rows that
// the startup sweep turns into `unverifiable` stubs, restart over the same
// data dir, and prove the three dismissal paths act on the rendered stubs:
// tab close (forget), Retry → recovery overlay → Restart (revives + forgets),
// and Settings → Terminal → Kill all sessions (clears stubs and live rows).
export async function probeRenderedExitedStubs({
  page,
  workspaceId,
  output,
  dataDir,
  daemon,
  daemonBin,
  cliBin,
  adoptDaemon,
}) {
  const stubAId = randomUUID();
  const stubBId = randomUUID();
  await closeOpenStripTabs(page);
  // Close whatever this daemon still owns through RPC first, so the kill
  // below cannot orphan a live PTY (same discipline as the #222 probe).
  for (const item of await bridgeSessions(page, workspaceId)) {
    await bridgeStop(page, {
      sessionId: item.id,
      incarnation: item.incarnation,
    });
  }
  daemon.kill("SIGKILL");
  const observed = await waitAcceptanceExit(daemon, 10000);
  assert.equal(observed.verdict, "exited");
  const db = path.join(dataDir, "drogon.sqlite3");
  await runAcceptanceProcess("python3", [
    "-c",
    SEED,
    db,
    workspaceId,
    stubAId,
    stubBId,
    new Date().toISOString(),
  ]);
  const next = startAcceptanceProcess(daemonBin, ["--data-dir", dataDir], {
    stdio: "ignore",
    env: { ...process.env },
  });
  adoptDaemon(next);
  await waitForDaemon(cliBin, dataDir);
  // The daemon died and came back inside one renderer heartbeat window, so
  // the connection monitor may never have seen the outage — no reconnect
  // transition means no session re-list and the new stub rows stay
  // invisible to the strip (the bridge still lists them; issue #228's
  // "restart leaves stubs" is exactly this state). A reload is the
  // deterministic user-side recovery and the journey the issue describes:
  // after it, the stubs render as tabs that every action below must act
  // on. (Without a reload the stubs appear as soon as any outage the
  // monitor does observe triggers the re-list.)
  await page.reload();
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor({ timeout: 30000 });

  // The renderer lists the sessions; the two stubs must render as tabs
  // (the exact #228 symptom is they do, but cannot be acted on — here
  // every action must work).
  await waitForBridgeObservation(
    page,
    async ({ id, a, b }) => {
      const response = await window.drogon.sessions(id);
      if (!response.ok) return false;
      const ids = response.result.sessions.map((item) => item.id);
      return ids.includes(a) && ids.includes(b);
    },
    { id: workspaceId, a: stubAId, b: stubBId },
  );
  const stubATab = page.getByRole("tab", { name: new RegExp(stubAId) });
  await stubATab.waitFor();
  await page.getByRole("tab", { name: new RegExp(stubBId) }).waitFor();
  const listed = await bridgeSessions(page, workspaceId);
  const stubA = listed.find((item) => item.id === stubAId);
  assert.equal(stubA.verdict, "unverifiable");
  await page.screenshot({
    path: path.join(output, "exited-stubs-strip.png"),
    animations: "disabled",
  });

  // 1) Retry: the click refreshes; the fresh list confirms the stubs are
  // still unverifiable, so the pane offers the recovery overlay (the
  // fork's exited-overlay structure) with its Restart action — a retry
  // must never stay a silent no-op. While the list is momentarily empty
  // the strip resets its selection and on the fresh list re-selects the
  // last listed session (pre-existing restore behavior), so the overlay
  // can appear on either stub — read the selected tab's session id.
  await stubATab.click();
  await page
    .getByRole("button", { name: "Retry connection" })
    .first()
    .click();
  const overlay = page
    .locator('[role="alert"]')
    .filter({ hasText: "Could not reconnect to terminal" })
    .first();
  await overlay.waitFor();
  const overlayTabLabel = await page
    .locator('[role="tab"][aria-selected="true"]')
    .getAttribute("aria-label");
  const revivedFromId =
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(
      overlayTabLabel ?? "",
    )?.[1];
  assert.ok(
    revivedFromId,
    `selected stub tab "${overlayTabLabel}" should carry its session id`,
  );
  await page.screenshot({
    path: path.join(output, "exited-stub-recovery-overlay.png"),
    animations: "disabled",
  });
  await overlay.getByRole("button", { name: "Restart" }).click();
  // The restart revives the tab's command as a NEW live session and
  // forgets the stub record (the daemon answers its honest verdict, but
  // the record is gone).
  await waitForBridgeObservation(
    page,
    async ({ id, a }) => {
      const response = await window.drogon.sessions(id);
      if (!response.ok) return false;
      const sessions = response.result.sessions;
      return (
        !sessions.some((item) => item.id === a) &&
        sessions.some((item) => item.verdict === "live")
      );
    },
    { id: workspaceId, a: revivedFromId },
  );
  assertStubRecordsForgotten(await bridgeSessions(page, workspaceId), {
    absentIds: [revivedFromId],
  });
  assert.equal(
    await page.getByRole("tab", { name: new RegExp(revivedFromId) }).count(),
    0,
  );

  // 2) Tab close: the exact listed stub is closed through the UI — the
  // close forgets the record, so the tab disappears instead of persisting
  // as a zombie. (Restart revived one of the two stubs, so whichever id
  // is still listed is the one left to close.)
  const remainingStubId =
    revivedFromId === stubAId ? stubBId : stubAId;
  await page
    .getByRole("button", {
      name: new RegExp(`Close .*${remainingStubId}.* session`),
    })
    .click();
  await waitForBridgeObservation(
    page,
    async ({ id, b }) => {
      const response = await window.drogon.sessions(id);
      if (!response.ok) return false;
      return !response.result.sessions.some((item) => item.id === b);
    },
    { id: workspaceId, b: remainingStubId },
  );
  assert.equal(
    await page
      .getByRole("tab", { name: new RegExp(remainingStubId) })
      .count(),
    0,
  );

  // 3) Kill all: a fresh live terminal plus the remaining stub-history
  // rows must ALL clear through Settings → Terminal → Kill all sessions.
  await page
    .getByRole("button", { name: "New tab", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: /^New Terminal/ }).click();
  await waitForBridgeObservation(
    page,
    async ({ id }) => {
      const response = await window.drogon.sessions(id);
      if (!response.ok) return false;
      return response.result.sessions.some((item) => item.verdict === "live");
    },
    { id: workspaceId },
  );
  await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+,`);
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await page.getByRole("button", { name: "Kill all sessions" }).click();
  await page
    .getByRole("button", { name: "Confirm kill all sessions" })
    .click();
  await page.getByText("Killed all sessions.").waitFor();
  await waitForBridgeObservation(
    page,
    async ({ id }) => {
      const response = await window.drogon.sessions(id);
      if (!response.ok) return false;
      return response.result.sessions.length === 0;
    },
    { id: workspaceId },
  );
  assertNoLiveRecords(await bridgeSessions(page, workspaceId));
  // The invalidate signal re-lists the strip: every forgotten row released
  // its tab, so no terminal tab survives Kill all.
  await page.waitForFunction(
    () => document.querySelectorAll('[role="tab"]').length === 0,
  );
  await page
    .getByRole("button", { name: "Back to app", exact: true })
    .click();
  await page.getByRole("heading", { name: "Start a session" }).waitFor();

  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({
      path: path.join(output, `exited-stubs-${colorScheme}.png`),
      animations: "disabled",
    });
  }
  return [
    "daemon-restart-exited-stub-retry-offers-recovery-overlay-with-restart",
    "daemon-restart-exited-stub-tab-close-forgets-record",
    "daemon-restart-exited-stub-kill-all-clears-stubs-and-live-sessions",
  ];
}
