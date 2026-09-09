import assert from "node:assert/strict";
import path from "node:path";
import { waitForTerminalText } from "./acceptance-terminal-text.mjs";

export async function probeTerminalExitLayout(options) {
  try {
    await runTerminalExitLayout(options);
  } catch (error) {
    await options.page.screenshot({
      path: path.join(options.output, "terminal-exit-failure.png"),
    });
    throw error;
  }
}

async function runTerminalExitLayout({ page, output }) {
  const panel = page.locator("#active-session-panel");
  const panes = panel.locator(".terminal-split-pane");
  const tabs = page.locator('[role="tab"][data-tab-id]');
  const newTerminal = async () => {
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: /^New Terminal/ }).click();
    await panel.locator('[data-split="single"]').waitFor();
    await page.locator(".xterm-helper-textarea:visible").waitFor();
  };
  const exitPane = async (pane, code) => {
    await pane.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type(
      `printf 'preserved-exit-${code}\\n'; exit ${code}`,
    );
    await page.keyboard.press("Enter");
    await pane
      .getByRole("alert")
      .filter({ hasText: `exit code ${code}.` })
      .waitFor();
    await waitForTerminalText(page, `preserved-exit-${code}`);
  };
  const assertGeometry = async (count) => {
    assert.equal(await panes.count(), count);
    assert.equal(await panel.locator(".error-banner").count(), 0);
    const outer = await panel.boundingBox();
    const host = await panel.locator(".terminal-split-host").boundingBox();
    assert.ok(
      Math.abs(host.x - outer.x) < 2,
      "exit UI must not become an extra flex column",
    );
    assert.ok(
      Math.abs(host.width - outer.width) < 2,
      "terminal uses full panel width",
    );
    for (const pane of await panes.all()) {
      const rect = await pane.boundingBox();
      assert.ok(rect.width >= (outer.width - 8) / count);
      const alert = pane.getByRole("alert");
      if (await alert.count()) {
        const box = await alert.boundingBox();
        assert.ok(
          box.x >= rect.x && box.x + box.width <= rect.x + rect.width + 1,
        );
        assert.ok(
          box.y >= rect.y && box.y + box.height <= rect.y + rect.height + 1,
        );
      }
    }
  };
  await newTerminal();
  await exitPane(panes.first(), 7);
  await assertGeometry(1);
  const tabCount = await tabs.count();
  await panes
    .first()
    .getByRole("button", { name: "Restart", exact: true })
    .click();
  await panel.getByRole("alert").waitFor({ state: "hidden" });
  await page.locator(".xterm-helper-textarea:visible").waitFor();
  assert.equal(
    await tabs.count(),
    tabCount,
    "Restart replaces rather than adding a tab",
  );
  await page.locator(".xterm-screen:visible").click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Split Terminal Right/ }).click();
  await panel.locator('[data-split="split"]').waitFor();
  await exitPane(panes.first(), 1);
  await exitPane(panes.nth(1), 2);
  await assertGeometry(2);
  await page.screenshot({ path: path.join(output, "terminal-exit-split.png") });
  await panes
    .first()
    .getByRole("button", { name: "Restart", exact: true })
    .click();
  await panes.first().getByRole("alert").waitFor({ state: "hidden" });
  await panes.first().locator(".xterm-helper-textarea").waitFor();
  assert.equal(await tabs.count(), tabCount);
  await assertGeometry(2);
  await page.reload();
  await panel.locator('[data-split="split"]').waitFor();
  await panes.nth(1).getByRole("alert").waitFor();
  await assertGeometry(2);
  await panes
    .nth(1)
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await panel.locator('[data-split="single"]').waitFor();
  await assertGeometry(1);
  await panes.first().locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("exit 0");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll('[role="tab"][data-tab-id]').length ===
      count - 1,
    tabCount,
  );
}
