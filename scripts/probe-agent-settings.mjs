import assert from "node:assert/strict";
import { chmod, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { runAcceptanceProcess } from "./acceptance-process.mjs";
import { waitForTerminalText } from "./acceptance-terminal-text.mjs";

export async function writeAgentSettingsFixtures(bin) {
  const body =
    '#!/bin/sh\nprintf "agent-settings-fixture\\n"\nprintf "ARG=%s\\n" "$@"\nprintf "ENV=%s\\n" "$AGENT_FIXTURE_VALUE"\nwhile IFS= read -r line; do printf "fixture-input=%s\\n" "$line"; done\n';
  for (const name of [
    "claude",
    "codex",
    "pi",
    "opencode",
    "agy",
    "custom-pi",
  ]) {
    const target = path.join(bin, name);
    await writeFile(target, body);
    await chmod(target, 0o755);
  }
}
export async function probeAgentSettingsNarrow({ page, output }) {
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+," : "Control+,",
  );
  await page
    .locator(".settings-view-shell aside")
    .getByRole("button", { name: "Agents", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Pi", exact: true })
    .and(page.locator('[aria-pressed="true"]'))
    .waitFor();
  const narrow = await page.evaluate(() => {
    const content = document.querySelector(
      ".settings-view-shell > div > .overflow-y-auto",
    );
    return {
      width: innerWidth,
      client: content.clientWidth,
      scroll: content.scrollWidth,
    };
  });
  assert.equal(narrow.width, 760);
  assert.ok(narrow.scroll <= narrow.client + 1, JSON.stringify(narrow));
  await page.screenshot({ path: path.join(output, "agents-native-760.png") });
  await page.getByRole("button", { name: "Back to app", exact: true }).click();
  return [
    "agents-native-760-no-overflow-and-default-persists-through-desktop-relaunch",
  ];
}

export async function probeAgentSettings({
  page,
  workspaceId,
  output,
  dataDir,
  cli,
  fixtureBin,
}) {
  const checks = [];
  const owned = [];
  const cdp = await page.context().newCDPSession(page);
  const rpc = async (method, params) => {
    const response = await runAcceptanceProcess(cli, [
      "--data-dir",
      dataDir,
      "--json",
      "rpc",
      method,
      "--params",
      JSON.stringify(params),
    ]);
    const result = JSON.parse(response.stdout);
    assert.equal(result.ok, true, response.stdout);
    return result.result;
  };
  const hook = async (session, event, prompt = "") => {
    const response = await runAcceptanceProcess("/bin/sh", [
      "-c",
      'printf %s "$1" | "$2" --data-dir "$3" --json internal hook-event --session "$4" --incarnation "$5" --event "$6"',
      "agent-hook-fixture",
      JSON.stringify({ prompt }),
      cli,
      dataDir,
      session.id,
      session.incarnation,
      event,
    ]);
    const result = JSON.parse(response.stdout);
    assert.equal(result.ok, true, response.stdout);
  };
  const prefs = async () => {
    const result = await page.evaluate(() => window.drogon.agentSettings.get());
    assert.equal(result.ok, true);
    return result.result.settings;
  };
  const waitSetting = async (key, expected) => {
    await page.waitForFunction(
      async ({ key, expected }) => {
        const result = await window.drogon.agentSettings.get();
        return (
          result.ok &&
          JSON.stringify(result.result.settings[key]) ===
            JSON.stringify(expected)
        );
      },
      { key, expected },
    );
  };
  const open = async () => {
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+," : "Control+,",
    );
    await page
      .locator(".settings-view-shell aside")
      .getByRole("button", { name: "Agents", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Default Agent", exact: true })
      .waitFor();
    await page.getByText("5 detected", { exact: true }).waitFor();
  };
  const close = () =>
    page.getByRole("button", { name: "Back to app", exact: true }).click();
  const launch = async (name, useDefault = false) => {
    if (useDefault && process.platform === "darwin")
      await page.keyboard.press("Meta+Alt+t");
    else {
      await page.getByRole("button", { name: "New tab", exact: true }).click();
      await page
        .getByRole("menuitem", { name: new RegExp(`^${name}`) })
        .click();
    }
    const id = name === "Claude" ? "claude" : "pi";
    const deadline = Date.now() + 15000;
    let session;
    while (!session && Date.now() < deadline) {
      const { sessions } = await rpc("session.list", { workspaceId });
      session = sessions.find(
        (item) =>
          item.harnessId === id &&
          item.verdict === "live" &&
          !owned.some((previous) => previous.id === item.id),
      );
      if (!session) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(session, `${name} launch must produce a live tracked session`);
    owned.push(session);
    await waitForTerminalText(page, "agent-settings-fixture", {
      timeout: 15000,
    });
    return session;
  };
  try {
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await page.waitForFunction(() => innerWidth >= 1400);
    await open();
    await page.screenshot({
      path: path.join(output, "agents-source-pane.png"),
    });
    const awake = page.getByRole("radiogroup", {
      name: "Keep computer awake",
      exact: true,
    });
    for (const [label, mode] of [
      ["On", "on"],
      ["Agent", "auto"],
      ["Off", "off"],
    ]) {
      await awake.getByRole("radio", { name: label, exact: true }).click();
      await awake
        .getByRole("radio", { name: label, exact: true })
        .and(page.locator('[aria-checked="true"]'))
        .waitFor();
      const power = await page.evaluate(() => window.drogon.usage.snapshot());
      assert.equal(power.result.awake.mode, mode);
    }
    checks.push(
      "agents-source-pane-defaults-hooks-titles-awake-cache-permissions-catalog",
    );
    await page.getByRole("button", { name: "Pi", exact: true }).click();
    await waitSetting("defaultTuiAgent", "pi");
    await page
      .getByRole("switch", { name: "Auto-generate tab titles", exact: true })
      .click();
    await waitSetting("tabAutoGenerateTitle", true);
    await page
      .getByRole("switch", { name: "Cache Timer", exact: true })
      .click();
    await waitSetting("promptCacheTimerEnabled", true);
    await page.getByRole("combobox", { name: "Timer Duration" }).click();
    await page.getByRole("option", { name: "1 hour", exact: true }).click();
    await waitSetting("promptCacheTtlMs", 3600000);
    const row = page.locator('[data-agent-id="pi"]');
    await row.getByRole("button", { name: "Expand command override" }).click();
    const customCommand = path.join(fixtureBin, "custom-pi");
    await row
      .getByRole("textbox", { name: "Command", exact: true })
      .fill(customCommand);
    await row
      .getByRole("textbox", { name: "Command", exact: true })
      .press("Tab");
    await page.waitForFunction(
      async (expected) =>
        (await window.drogon.agentSettings.get()).result?.settings
          .agentCmdOverrides.pi === expected,
      customCommand,
    );
    await row
      .getByRole("textbox", { name: "Arguments", exact: true })
      .fill("--model 'fixture/model' --thinking high");
    await row
      .getByRole("textbox", { name: "Arguments", exact: true })
      .press("Tab");
    await row
      .getByRole("textbox", { name: "Environment", exact: true })
      .fill("AGENT_FIXTURE_VALUE=hello");
    await row
      .getByRole("textbox", { name: "Environment", exact: true })
      .press("Tab");
    await page.waitForFunction(
      async () =>
        (await window.drogon.agentSettings.get()).result?.settings
          .agentDefaultEnv.pi?.AGENT_FIXTURE_VALUE === "hello",
    );
    await row
      .getByRole("textbox", { name: "Command", exact: true })
      .fill("/cancelled/command");
    await row
      .getByRole("textbox", { name: "Command", exact: true })
      .press("Escape");
    assert.equal((await prefs()).agentCmdOverrides.pi, customCommand);
    assert.equal(
      await page
        .getByRole("heading", { name: "Default Agent", exact: true })
        .isVisible(),
      true,
    );
    await page
      .getByRole("radiogroup", { name: "Agent Permissions" })
      .getByRole("radio", { name: "Manual", exact: true })
      .click();
    await page.waitForFunction(
      async () =>
        (await window.drogon.agentSettings.get()).result?.settings
          .agentDefaultArgs.claude === "",
    );
    assert.equal(
      (await prefs()).agentDefaultArgs.pi,
      "--model 'fixture/model' --thinking high",
    );
    checks.push(
      "agents-command-args-env-persist-cancel-is-local-permission-mode-preserves-overrides",
    );
    await row.getByRole("radio", { name: "Disabled", exact: true }).click();
    await waitSetting("disabledTuiAgents", ["pi"]);
    await waitSetting("defaultTuiAgent", null);
    await close();
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    assert.equal(await page.getByRole("menuitem", { name: /^Pi/ }).count(), 0);
    await page.keyboard.press("Escape");
    await open();
    await row.getByRole("radio", { name: "Enabled", exact: true }).click();
    await waitSetting("disabledTuiAgents", []);
    await page.getByRole("button", { name: "Pi", exact: true }).click();
    await waitSetting("defaultTuiAgent", "pi");
    await close();
    const pi = await launch("Pi", true);
    assert.equal(pi.command, await realpath(customCommand));
    assert.deepEqual(pi.args.slice(0, 4), [
      "--model",
      "fixture/model",
      "--thinking",
      "high",
    ]);
    await waitForTerminalText(page, "ENV=hello", { timeout: 10000 });
    await hook(
      pi,
      "AgentStart",
      "Can you please refactor the auth middleware to use JWT tokens?",
    );
    await page
      .getByRole("tab", { name: /Refactor the auth middleware to use JWT/ })
      .first()
      .waitFor({ timeout: 15000 });
    checks.push(
      "agents-disabled-hidden-from-launch-menu-real-pty-command-args-env-generated-title",
    );
    const claude = await launch("Claude");
    const settingsPath = claude.args[claude.args.indexOf("--settings") + 1];
    assert.ok(settingsPath.startsWith(await realpath(dataDir)));
    const originalHooks = await readFile(settingsPath, "utf8");
    assert.equal(JSON.parse(originalHooks).hooks.UserPromptSubmit.length, 1);
    assert.ok(originalHooks.includes("hook-event"));
    await hook(claude, "Stop");
    await page
      .locator(`[data-worktree-agent-row="${claude.id}"]`)
      .getByLabel(/Prompt cache expires in/)
      .waitFor({ timeout: 15000 });
    await open();
    await page
      .getByRole("switch", { name: "Agent status hooks", exact: true })
      .click();
    await waitSetting("agentStatusHooksEnabled", false);
    await page
      .getByRole("switch", { name: "Agent status hooks", exact: true })
      .and(page.locator('[aria-checked="false"]'))
      .waitFor();
    assert.deepEqual(
      JSON.parse(await readFile(settingsPath, "utf8")).hooks,
      {},
    );
    await page
      .getByRole("switch", { name: "Agent status hooks", exact: true })
      .click();
    await waitSetting("agentStatusHooksEnabled", true);
    await page
      .getByRole("switch", { name: "Agent status hooks", exact: true })
      .and(page.locator('[aria-checked="true"]'))
      .waitFor();
    assert.equal(await readFile(settingsPath, "utf8"), originalHooks);
    checks.push(
      "agents-cache-countdown-consumes-stop-hook-live-hook-removal-and-restoration",
    );
    await row.getByRole("textbox", { name: "Command", exact: true }).waitFor();
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(output, "agents-command-expanded.png"),
    });
    await close();
    await page.reload();
    await page
      .getByRole("tab", { name: /Refactor the auth middleware to use JWT/ })
      .first()
      .waitFor({ timeout: 15000 });
    await open();
    assert.equal((await prefs()).defaultTuiAgent, "pi");
    assert.equal(
      (await prefs()).agentDefaultEnv.pi.AGENT_FIXTURE_VALUE,
      "hello",
    );
    assert.equal((await prefs()).promptCacheTtlMs, 3600000);
    checks.push(
      "agents-preferences-and-generated-title-survive-renderer-reload",
    );
    await close();
    return checks;
  } finally {
    await cdp.detach();
    for (const session of owned) {
      const result = await page.evaluate(
        async (session) =>
          window.drogon.close({
            sessionId: session.id,
            incarnation: session.incarnation,
          }),
        session,
      );
      assert.equal(result.ok, true);
      assert.equal(result.result.verdict, "exited");
    }
  }
}
