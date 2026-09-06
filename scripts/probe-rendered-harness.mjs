import assert from "node:assert/strict";
import path from "node:path";

export async function probeRenderedHarness({ page, workspaceId, output }) {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page
    .getByRole("button", { name: "New terminal", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Pi", exact: true }).click();
  await page.getByRole("heading", { name: "Pi", exact: true }).waitFor();
  const trigger = await page
    .getByRole("button", { name: "New terminal", exact: true })
    .first()
    .boundingBox();
  const form = await page.locator(".harness-launch-form").boundingBox();
  assert.ok(
    trigger && form && Math.abs(form.x - trigger.x) <= 2,
    "Launch form stays aligned with its trigger, not over the sidebar",
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
    .getByRole("button", { name: "New terminal", exact: true })
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
  await page.waitForFunction(async (identity) => {
    const read = await window.drogon.read({ ...identity, cursor: 0 });
    return (
      read.ok &&
      read.result.session.verdict === "live" &&
      read.result.nextCursor > 40
    );
  }, identity);
  await page.waitForFunction(() =>
    /pi|ctrl|model/i.test(
      document.querySelector(".xterm-screen")?.textContent ?? "",
    ),
  );
  await page.screenshot({
    path: path.join(output, "pi-running.png"),
    animations: "disabled",
  });
  await page.reload();
  await page.getByText("Service 0.1.0", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Pi live", exact: true }).waitFor();
  await page.waitForFunction(async (identity) => {
    const result = await window.drogon.read({ ...identity, cursor: 0 });
    return (
      result.ok &&
      result.result.session.id === identity.sessionId &&
      result.result.session.verdict === "live"
    );
  }, identity);
  await page
    .getByRole("button", { name: /Close .* session/ })
    .last()
    .click();
  await page.waitForFunction(async (identity) => {
    const result = await window.drogon.read({ ...identity, cursor: 0 });
    return result.ok && result.result.session.verdict === "exited";
  }, identity);
  const stopped = await page.evaluate(async (identity) => {
    const result = await window.drogon.read({ ...identity, cursor: 0 });
    return result.ok ? result.result.session : null;
  }, identity);
  assert.equal(stopped?.verdict, "exited");
  return [
    "rendered-native-pi-launch-without-inference",
    "harness-form-anchor-light-dark-narrow-escape-and-reload-exact-identity",
    "exact-pi-stop-through-ui",
  ];
}
