// MIT Copyright (c) 2026 Lovecast Inc.
// Regression tests for the Settings "Agent skills" panels: the adapted port
// of the reference AgentSkillSetupPanel renders the real catalog state —
// installed/not-installed pills, the version-matched commands, and the
// honest unavailable/loading rows in the CLI section.
import { describe, expect, test } from "vitest";
import { renderToString } from "react-dom/server";
import {
  AgentSkillSetupPanel,
  IntegrationStatusPill,
  SkillsLoadingRow,
  loadSkillsOverview,
} from "./agent-skill-setup-panel";

function renderPanel(installed: boolean): string {
  return renderToString(
    <AgentSkillSetupPanel
      topic={{
        name: "drogon-cli",
        description: "Drive Drogon through the public `drogon-cli`.",
        installed,
        installCommand:
          "npx skills add https://github.com/clioo/drogon --skill drogon-cli --global",
        updateCommand: "npx skills update drogon-cli --global",
      }}
      title="CLI skill"
      description="Enables agents to use Drogon workspace, terminal, and progress commands."
      installed={installed}
      loading={false}
      error={null}
      onRecheck={() => {}}
    />,
  ).replace(/<!-- -->/g, "");
}

describe("AgentSkillSetupPanel", () => {
  test("shows the not-installed pill and the install command", () => {
    const html = renderPanel(false);
    expect(html).toContain("Not installed");
    expect(html).toContain("CLI skill");
    expect(html).toContain("npx skills add https://github.com/clioo/drogon --skill drogon-cli --global");
    expect(html).not.toContain("npx skills update drogon-cli");
    expect(html).toContain("Install");
    expect(html).toContain("aria-label=\"Copy command\"");
  });

  test("shows the installed pill and switches to the update command", () => {
    const html = renderPanel(true);
    expect(html).toContain("Installed");
    expect(html).not.toContain("Not installed");
    expect(html).toContain("npx skills update drogon-cli --global");
    expect(html).toContain("Update");
  });

  test("pills carry the reference tone classes", () => {
    const connected = renderToString(
      <IntegrationStatusPill tone="connected">Installed</IntegrationStatusPill>,
    );
    expect(connected).toContain("border-emerald-500/40");
    const attention = renderToString(
      <IntegrationStatusPill tone="attention">Not installed</IntegrationStatusPill>,
    );
    expect(attention).toContain("border-amber-500/40");
  });

  test("loadSkillsOverview degrades when the preload bridge is absent", async () => {
    const state = await loadSkillsOverview();
    expect(state.status).toBe("unavailable");
    expect(state.status === "unavailable" && state.reason).toBe(
      "skills bridge is missing",
    );
  });

  test("loading row announces the check", () => {
    expect(renderToString(<SkillsLoadingRow />)).toContain(
      "Checking installed agent skills",
    );
  });
});
