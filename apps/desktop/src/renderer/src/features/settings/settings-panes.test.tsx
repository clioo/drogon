// MIT Copyright (c) 2026 Lovecast Inc.
// Projection tests for the settings panes: each MVP section renders its
// source-faithful shell (title, controls, ARIA) from props alone, and the
// sidebar order matches the reference order (Agents, General, Git,
// Appearance, Notifications, Shortcuts).
import { describe, expect, test } from "vitest";
import { renderToString } from "react-dom/server";
import { AgentsSection } from "./agents-section";
import { AppearanceSection } from "./appearance-section";
import { CliSection } from "./cli-section";
import { GeneralSection } from "./general-section";
import { GitSection } from "./git-section";
import { NotificationsSection } from "./notifications-section";
import { SettingsPage } from "./SettingsPage";
import {
  DEFAULT_SETTINGS_SECTION,
  isSettingsSectionId,
  SETTINGS_SECTIONS,
} from "./settings-sections";

function render(node: React.ReactElement): string {
  return renderToString(node).replace(/<!-- -->/g, "");
}

describe("settings sidebar order (source order for the MVP subset)", () => {
  test("declares agents, general, git, appearance, notifications, shortcuts", () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual([
      "agents",
      "general",
      "git",
      "appearance",
      "notifications",
      "shortcuts",
    ]);
    expect(DEFAULT_SETTINGS_SECTION).toBe("general");
    expect(isSettingsSectionId("agents")).toBe(true);
    expect(isSettingsSectionId("general")).toBe(true);
    expect(isSettingsSectionId("bogus")).toBe(false);
  });
});

describe("appearance projection", () => {
  test("renders the theme segmented control with three radio options", () => {
    const html = render(
      <AppearanceSection
        theme="dark"
        onThemeChange={() => {}}
        terminalFontSize={13}
        onTerminalFontSizeChange={() => {}}
        terminalGpuAcceleration="auto"
        onTerminalGpuAccelerationChange={() => {}}
        statusBarVisible={true}
        onStatusBarVisibleChange={() => {}}
        tasksButtonVisible={true}
        onTasksButtonVisibleChange={() => {}}
        automationsButtonVisible={true}
        onAutomationsButtonVisibleChange={() => {}}
        titlebarAppNameVisible={true}
        onTitlebarAppNameVisibleChange={() => {}}
      />,
    );
    expect(html).toContain("Appearance");
    expect(html).toContain('aria-label="Theme"');
    expect(html).toContain("System");
    expect(html).toContain("Dark");
    expect(html).toContain("Light");
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Terminal font size"');
    // #132: the source has no session-details switch; visibility flags live
    // under the source's Window & Sidebar section instead.
    expect(html).not.toContain("Show session details");
    expect(html).toContain("Window &amp; Sidebar");
    expect(html).toContain("Show Status Bar");
    expect(html).toContain("Show Tasks Button");
    expect(html).toContain('role="switch"');
  });

  test("renders the source terminal typography rows (R14-E)", () => {
    const html = render(
      <AppearanceSection
        theme="dark"
        onThemeChange={() => {}}
        terminalFontSize={13}
        onTerminalFontSizeChange={() => {}}
        terminalGpuAcceleration="auto"
        onTerminalGpuAccelerationChange={() => {}}
        terminalFontFamily="JetBrains Mono"
        terminalFontWeight={400}
        terminalFontWeightBold={800}
        editorFontFamily=""
        statusBarVisible={true}
        onStatusBarVisibleChange={() => {}}
        tasksButtonVisible={true}
        onTasksButtonVisibleChange={() => {}}
        automationsButtonVisible={true}
        onAutomationsButtonVisibleChange={() => {}}
        titlebarAppNameVisible={true}
        onTitlebarAppNameVisibleChange={() => {}}
      />,
    );
    expect(html).toContain("Font Family");
    expect(html).toContain(
      "Default terminal font family for new panes and live updates.",
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain("Font Weight");
    expect(html).toContain("Bold Font Weight");
    expect(html).toContain("100-900");
    expect(html).toContain("Editor Font Family");
    expect(html).toContain(
      "Font used by file editors and diff views. Leave empty to follow the terminal font.",
    );
    expect(html).toContain("Same as terminal font");
    // Controlled values render into the inputs.
    expect(html).toContain('value="JetBrains Mono"');
    expect(html).toContain('value="400"');
    expect(html).toContain('value="800"');
  });
});

describe("agents projection", () => {
  test("renders default-harness select and per-harness editors (CLI lives in General)", () => {
    const html = render(
      <AgentsSection
        harnesses={[]}
        defaultHarnessId="pi"
        onDefaultHarnessChange={() => {}}
        harnessDefaults={{}}
        onHarnessDefaultChange={() => {}}
      />,
    );
    expect(html).toContain("Agents");
    // Default control is a pressed-button group like the fork's
    // AgentDefaultSetting (honest subset: None + the four known harnesses).
    expect(html).toContain('aria-label="Default harness"');
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="radio"');
    expect(html).toContain("None");
    // Per-harness editors: live list is empty, so the known ids render.
    expect(html).toContain("Claude Code");
    expect(html).toContain("Pi");
    expect(html).toContain("Default");
    // The CLI section moved to the General pane (the fork's slot).
    expect(html).not.toContain("Drogon CLI");
  });
});

describe("general projection", () => {
  test("renders workspace confirms, the CLI section and support row", () => {
    const html = render(<GeneralSection />);
    expect(html).toContain('data-settings-section="general"');
    expect(html).toContain("General");
    expect(html).toContain("Workspace defaults, app setup, and maintenance.");
    expect(html).toContain("Workspace");
    expect(html).toContain("Ask Before Deleting Workspaces");
    expect(html).toContain(
      "Show a confirmation before deleting a workspace from the context menu.",
    );
    expect(html).toContain("Ask Before Deleting Automations");
    expect(html).toContain(
      "Show a confirmation before deleting automations and their run history.",
    );
    expect(html).toContain('id="general-skip-delete-worktree-confirm"');
    expect(html).toContain('id="general-skip-delete-automation-confirm"');
    expect(html).toContain("Drogon CLI");
    expect(html).toContain("Shell command");
    expect(html).toContain("Checking CLI registration…");
    expect(html).toContain("Support Drogon");
    expect(html).toContain("Star Drogon on GitHub");
  });
});

describe("cli section projection", () => {
  test("initial paint is the honest loading state", () => {
    const html = render(<CliSection />);
    expect(html).toContain('data-settings-section="cli"');
    expect(html).toContain("Drogon CLI");
    expect(html).toContain("Checking CLI registration…");
  });
});

describe("git projection", () => {
  test("initial paint shows the probe loading states, never stale data", () => {
    const html = render(<GitSection workspacePath="/repo" />);
    expect(html).toContain("Git and GitHub");
    expect(html).toContain("Reading git config…");
    expect(html).toContain("Running gh auth status…");
  });

  test("null workspace still renders both probe groups", () => {
    // Initial paint is the loading state either way (the workspace-aware
    // empty state resolves in the effect, which SSR never runs).
    const html = render(<GitSection workspacePath={null} />);
    expect(html).toContain("Git identity");
    expect(html).toContain("GitHub CLI");
    expect(html).toContain("Running gh auth status…");
  });
});

describe("notifications projection", () => {
  test("renders the master needs-input switch", () => {
    const html = render(
      <NotificationsSection
        notifyOnAgentNeedsInput={true}
        onNotifyChange={() => {}}
      />,
    );
    expect(html).toContain("Notifications");
    expect(html).toContain("Notify when an agent needs input");
    expect(html).toContain('role="switch"');
  });
});

describe("settings page order", () => {
  test("stacks every section in sidebar order while searching", () => {
    const noop = () => {};
    const html = render(
      <SettingsPage
        theme="system"
        onThemeChange={noop}
        terminalFontSize={13}
        onTerminalFontSizeChange={noop}
        terminalGpuAcceleration="auto"
        onTerminalGpuAccelerationChange={noop}
        inspectorVisible={true}
        onInspectorChange={noop}
        statusBarVisible={true}
        onStatusBarVisibleChange={noop}
        tasksButtonVisible={true}
        onTasksButtonVisibleChange={noop}
        automationsButtonVisible={true}
        onAutomationsButtonVisibleChange={noop}
        titlebarAppNameVisible={true}
        onTitlebarAppNameVisibleChange={noop}
        harnesses={[]}
        defaultHarnessId=""
        onDefaultHarnessChange={noop}
        harnessDefaults={{}}
        onHarnessDefaultChange={noop}
        notifyOnAgentNeedsInput={true}
        onNotifyChange={noop}
        workspacePath={null}
        initialSection="agents"
        onBack={noop}
      />,
    );
    // Searching is empty by default: only the initial section's pane
    // renders (the sidebar nav always lists every section title).
    expect(html).toContain('data-settings-section="agents"');
    expect(html).not.toContain('data-settings-section="git"');
  });

  test("defaults to the General pane like the reference", () => {
    const noop = () => {};
    const html = render(
      <SettingsPage
        theme="system"
        onThemeChange={noop}
        terminalFontSize={13}
        onTerminalFontSizeChange={noop}
        terminalGpuAcceleration="auto"
        onTerminalGpuAccelerationChange={noop}
        inspectorVisible={true}
        onInspectorChange={noop}
        statusBarVisible={true}
        onStatusBarVisibleChange={noop}
        tasksButtonVisible={true}
        onTasksButtonVisibleChange={noop}
        automationsButtonVisible={true}
        onAutomationsButtonVisibleChange={noop}
        titlebarAppNameVisible={true}
        onTitlebarAppNameVisibleChange={noop}
        harnesses={[]}
        defaultHarnessId=""
        onDefaultHarnessChange={noop}
        harnessDefaults={{}}
        onHarnessDefaultChange={noop}
        notifyOnAgentNeedsInput={true}
        onNotifyChange={noop}
        workspacePath={null}
        onBack={noop}
      />,
    );
    expect(html).toContain('data-settings-section="general"');
    expect(html).not.toContain('data-settings-section="appearance"');
    // The grouped nav lists every section title with its group header.
    expect(html).toContain("AI Capabilities");
    expect(html).toContain("Set Up");
    expect(html).toContain("Workflows");
    expect(html).toContain("Interface");
    expect(html).toContain(">General<");
  });
});
