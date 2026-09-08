import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { waitForBridgeObservation } from "./acceptance-bridge-observation.mjs";

export function renderedPiIsReady(root = document) {
  // Self-contained (serialized into the page): read the live xterm buffers
  // from the debug registry when the WebGL renderer leaves no DOM text.
  const registry =
    typeof window !== "undefined" ? window.__drogonTerminals : undefined;
  let rendered = "";
  if (registry && registry.size > 0) {
    const lines = [];
    for (const terminal of registry.values()) {
      const buffer = terminal.buffer.active;
      for (let row = 0; row < buffer.length; row += 1) {
        lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
      }
    }
    rendered = lines.join("\n");
  } else {
    rendered = root.querySelector(".xterm-screen")?.textContent ?? "";
  }
  return (
    /\bpi v\d+\.\d+\.\d+\b/.test(rendered) && rendered.includes("clear/exit")
  );
}

/**
 * Self-contained predicate (serialized into the page by
 * `waitForSessionStripTab`): true when the session's own strip tab carries
 * the daemon verdict as the tail of its accessible name. R16-E (#164)
 * renamed strip tabs to "Terminal N" — the harness name never becomes the
 * tab label — while keeping the legacy "<label> <verdict>" accessible-name
 * shape (TabBar.tsx), so the probe matches the verdict suffix on the
 * session's own tab instead of a hardcoded "Pi <verdict>" name. An
 * "unverifiable" tab additionally carries "· <id>:<incarnation>" inside its
 * label (session-recovery.ts `recoveryTabLabel`), which the suffix match
 * tolerates. Scoped to the Sessions tablist: the right sidebar renders its
 * own tabs with overlapping roles.
 */
export function sessionTabShowsVerdict({ id, suffix }) {
  const tab = document.querySelector(
    `[role="tablist"][aria-label="Sessions"] [role="tab"][data-tab-id="${CSS.escape(id)}"]`,
  );
  return tab?.getAttribute("aria-label")?.endsWith(suffix) ?? false;
}

/**
 * Waits for a session's strip tab to show a daemon verdict. One helper for
 * the session-tab surface: callers pass the launched session id plus
 * "live" or "unverifiable".
 */
export async function waitForSessionStripTab(page, sessionId, verdict) {
  await page.waitForFunction(sessionTabShowsVerdict, {
    id: sessionId,
    suffix: ` ${verdict}`,
  });
}

/** Self-contained: true once the session owns no tab in the Sessions strip. */
export function sessionStripTabGone({ id }) {
  return (
    document.querySelector(
      `[role="tablist"][aria-label="Sessions"] [role="tab"][data-tab-id="${CSS.escape(id)}"]`,
    ) === null
  );
}

// Local-only model fixture for every agent launch in acceptance: never a
// paid model.
const PI_MODEL = "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4";
const PI_PROVIDER = "dgx-spark";
const PI_MODEL_ID = "qwen3.8-flash-next-nvidia-nvfp4";

/**
 * Seeds the isolated `PI_CODING_AGENT_DIR` (a bare temp dir in acceptance)
 * with the team-local provider route so Pi can boot the local model: the
 * repo's QA doctrine runs in-app sessions only on this model, and the key
 * is the `"local"` placeholder, never a credential. Without it Pi reports
 * `Unknown provider` and exits before rendering.
 */
async function seedLocalPiProvider(dataDir) {
  const piDir = path.join(path.dirname(dataDir), "pi");
  await mkdir(piDir, { recursive: true });
  await writeFile(
    path.join(piDir, "models.json"),
    JSON.stringify({
      providers: {
        [PI_PROVIDER]: {
          baseUrl: "http://100.85.64.21:9292/v1",
          api: "openai-completions",
          apiKey: "local",
          models: [
            {
              id: PI_MODEL_ID,
              name: PI_MODEL_ID,
              reasoning: false,
              input: ["text"],
              contextWindow: 131072,
              maxTokens: 4096,
            },
          ],
        },
      },
    }),
  );
}

async function openAgentsSettings(page) {
  await page
    .locator(".session-header")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Agents", exact: true })
    .click();
  await page
    .getByRole("radiogroup", { name: "Default harness" })
    .waitFor();
}

async function readAgentDefaults(page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("drogon:settings:ui");
    return raw ? JSON.parse(raw).settings : null;
  });
}

export async function probeRenderedHarness({
  page,
  workspaceId,
  output,
  dataDir,
}) {
  await page.setViewportSize({ width: 1280, height: 850 });
  // R16-AO (#231): the "+" menu launches a harness row immediately with
  // the Settings → Agents defaults — no per-launch dialog, exactly like
  // the fork. Set Pi as the default with the local model and Unattended
  // through the real Settings pane first.
  await openAgentsSettings(page);
  await page
    .getByRole("radiogroup", { name: "Default harness" })
    .getByRole("radio", { name: "Pi", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Pi model" }).fill(PI_MODEL);
  await page
    .getByRole("radiogroup", { name: "Pi permission mode" })
    .getByRole("radio", { name: "Unattended", exact: true })
    .click();
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({
      path: path.join(output, `agents-settings-${colorScheme}.png`),
      animations: "disabled",
    });
  }
  // The store debounces saves by 1s: wait it out, then prove the persisted
  // defaults survive a renderer restart through the pane itself.
  await delay(2000);
  const stored = await readAgentDefaults(page);
  assert.equal(stored?.defaultHarnessId, "pi");
  assert.equal(stored?.harnessDefaults?.pi?.model, PI_MODEL);
  assert.equal(stored?.harnessDefaults?.pi?.permissionMode, "unattended");
  await page.reload();
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor();
  await openAgentsSettings(page);
  assert.equal(
    await page.getByRole("textbox", { name: "Pi model" }).inputValue(),
    PI_MODEL,
  );
  assert.equal(
    await page
      .getByRole("radiogroup", { name: "Pi permission mode" })
      .getByRole("radio", { name: "Unattended", exact: true })
      .getAttribute("aria-checked"),
    "true",
  );
  assert.equal(
    await page
      .getByRole("radiogroup", { name: "Default harness" })
      .getByRole("radio", { name: "Pi", exact: true })
      .getAttribute("aria-checked"),
    "true",
  );
  await page
    .getByRole("button", { name: "Back to app", exact: true })
    .click();
  await page.getByRole("heading", { name: "Start a session" }).waitFor();
  await seedLocalPiProvider(dataDir);
  // A click on the Pi row launches at once: no launch dialog may appear.
  await page
    .getByRole("button", { name: "New tab", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Pi", exact: true }).click();
  assert.equal(await page.locator(".harness-launch-form").count(), 0);
  assert.equal(
    await page.getByRole("button", { name: "Launch", exact: true }).count(),
    0,
  );
  // The session starts with the Settings defaults in argv: Unattended is
  // Pi's `--approve`, and the stored `provider/model-id` shorthand splits
  // into the separate flags this Pi build requires (it rejects the
  // combined `--model provider/id` pattern).
  const launched = await page.evaluate(async (id) => {
    const deadline = Date.now() + 15000;
    for (;;) {
      const result = await window.drogon.sessions(id);
      if (!result.ok) throw new Error(result.error.message);
      const live = result.result.sessions.find(
        (session) => session.verdict === "live",
      );
      if (live) return live;
      if (Date.now() > deadline)
        throw new Error("no live session after the Pi row launch");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, workspaceId);
  assert.ok(launched?.incarnation);
  assert.ok(
    launched.args.includes("--approve"),
    `Pi row launch must carry --approve, got ${JSON.stringify(launched.args)}`,
  );
  assert.ok(
    launched.args.includes("--provider") &&
      launched.args.includes("dgx-spark") &&
      launched.args.includes("--model") &&
      launched.args.includes("qwen3.8-flash-next-nvidia-nvfp4"),
    `Pi row launch must carry the stored provider/model, got ${JSON.stringify(launched.args)}`,
  );
  const identity = {
    sessionId: launched.id,
    incarnation: launched.incarnation,
  };
  await waitForBridgeObservation(
    page,
    async (identity) => {
      const read = await window.drogon.read({ ...identity, cursor: 0 });
      return (
        read.ok &&
        read.result.session.verdict === "live" &&
        read.result.nextCursor > 40
      );
    },
    identity,
  );
  await page.waitForFunction(renderedPiIsReady);
  await page.screenshot({
    path: path.join(output, "pi-running.png"),
    animations: "disabled",
  });
  await page.reload();
  // R9-B: sidebar footer readiness (the "Service x.y.z" text is gone).
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor();
  await waitForSessionStripTab(page, identity.sessionId, "live");
  const socket = path.join(dataDir, "runtime-v1.sock");
  const interrupted = path.join(dataDir, "acceptance-unreachable.sock");
  await rename(socket, interrupted);
  try {
    await waitForSessionStripTab(page, identity.sessionId, "unverifiable");
    await page.screenshot({
      path: path.join(output, "pi-unverifiable.png"),
      animations: "disabled",
    });
  } finally {
    await rename(interrupted, socket);
  }
  await page
    .getByRole("button", { name: "Refresh connection", exact: true })
    .click();
  await waitForSessionStripTab(page, identity.sessionId, "live");
  await waitForBridgeObservation(
    page,
    async (identity) => {
      const result = await window.drogon.read({ ...identity, cursor: 0 });
      return (
        result.ok &&
        result.result.session.id === identity.sessionId &&
        result.result.session.verdict === "live"
      );
    },
    identity,
  );
  await page
    .getByRole("button", { name: /Close .* session/ })
    .last()
    .click();
  await waitForBridgeObservation(
    page,
    async (identity) => {
      const result = await window.drogon.read({ ...identity, cursor: 0 });
      return result.ok && result.result.session.verdict === "exited";
    },
    identity,
  );
  const stopped = await page.evaluate(async (identity) => {
    const result = await window.drogon.read({ ...identity, cursor: 0 });
    return result.ok ? result.result.session : null;
  }, identity);
  assert.equal(stopped?.verdict, "exited");
  await page.reload();
  await page.getByRole("heading", { name: "Start a session" }).waitFor();
  // The closed Pi session owns no strip tab after reload. (No global tab
  // count: editor tabs persist across reload by design, and the right
  // sidebar renders its own overlapping tab roles.)
  await page.waitForFunction(sessionStripTabGone, {
    id: identity.sessionId,
  });
  return [
    "agents-settings-defaults-drive-immediate-pi-launch",
    "agent-defaults-survive-reload",
    "rendered-native-pi-launch-without-inference",
    "exact-pi-stop-through-ui",
    "transport-loss-is-unverifiable-and-reconnects-the-same-pi-session",
  ];
}
