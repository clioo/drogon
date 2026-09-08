import assert from "node:assert/strict";
import path from "node:path";
import { rename } from "node:fs/promises";
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

export async function probeRenderedHarness({
  page,
  workspaceId,
  output,
  dataDir,
}) {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page
    .getByRole("button", { name: "New tab", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Pi", exact: true }).click();
  await page.getByRole("heading", { name: "Pi", exact: true }).waitFor();
  const trigger = await page
    .getByRole("button", { name: "New tab", exact: true })
    .first()
    .boundingBox();
  const form = await page.locator(".harness-launch-form").boundingBox();
  // The form opens under the "+" trigger inside the main pane (#189: since
  // R16-D/R16-E the 28px trigger sits 8px inside the strip while the form
  // starts at the strip's content edge, measured trigger.x 289 vs form.x
  // 281 at 1280px). The check is "same column as the trigger" — a form
  // starting within the trigger's inset cannot overlap the sidebar, which
  // ends where the strip begins.
  assert.ok(
    trigger && form && form.x >= trigger.x - 12 && form.x - trigger.x <= 24,
    `Launch form stays aligned with its trigger, not over the sidebar (trigger ${JSON.stringify(trigger)} form ${JSON.stringify(form)})`,
  );
  assert.equal(
    await page.getByLabel("Model", { exact: true }).inputValue(),
    "",
  );
  assert.equal(
    await page.getByLabel("Initial prompt (optional)").inputValue(),
    "",
  );
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({
      path: path.join(output, `harness-form-${colorScheme}.png`),
      animations: "disabled",
    });
  }
  await page.getByText("Advanced", { exact: true }).click();
  await page.setViewportSize({ width: 760, height: 600 });
  const narrow = await page.locator(".harness-launch-form").boundingBox();
  assert.ok(
    narrow &&
      narrow.x >= 0 &&
      narrow.y >= 0 &&
      narrow.x + narrow.width <= 760 &&
      narrow.y + narrow.height <= 600,
  );
  await page.screenshot({
    path: path.join(output, "harness-form-narrow.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page
    .getByRole("heading", { name: "Pi", exact: true })
    .waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 1280, height: 850 });
  await page
    .getByRole("button", { name: "New tab", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Pi", exact: true }).click();
  await page.getByText("Advanced", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Trust project files" }).check();
  await page.getByRole("button", { name: "Launch", exact: true }).click();
  await page
    .getByRole("heading", { name: "Pi", exact: true })
    .waitFor({ state: "hidden" });
  const launched = await page.evaluate(async (id) => {
    const result = await window.drogon.sessions(id);
    if (!result.ok) throw new Error(result.error.message);
    return result.result.sessions.find((session) => session.verdict === "live");
  }, workspaceId);
  assert.ok(launched?.incarnation);
  assert.ok(launched.args.includes("--approve"));
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
  await page.getByRole("tab", { name: "Pi live", exact: true }).waitFor();
  const socket = path.join(dataDir, "runtime-v1.sock");
  const interrupted = path.join(dataDir, "acceptance-unreachable.sock");
  await rename(socket, interrupted);
  try {
    await page
      .getByRole("tab", { name: "Pi unverifiable", exact: true })
      .waitFor();
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
  await page.getByRole("tab", { name: "Pi live", exact: true }).waitFor();
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
  assert.equal(await page.getByRole("tab").count(), 0);
  return [
    "rendered-native-pi-launch-without-inference",
    "harness-form-anchor-light-dark-narrow-escape-and-reload-exact-identity",
    "exact-pi-stop-through-ui",
    "transport-loss-is-unverifiable-and-reconnects-the-same-pi-session",
  ];
}
