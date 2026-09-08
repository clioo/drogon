// MIT Copyright (c) 2026 Lovecast Inc.
// Regression tests for the J10 typography single-writer contract: when App
// passes the typography props, the Appearance rows render the prop values
// (the store path), never the persisted envelope. Direct envelope writes
// bypass the App-held SettingsStore and would be clobbered by its next
// debounced whole-envelope flush.
import { describe, expect, test } from "vitest";
import { renderToString } from "react-dom/server";
import { AppearanceSection } from "./appearance-section";

function render(): string {
  return renderToString(
    <AppearanceSection
      theme="dark"
      onThemeChange={() => {}}
      terminalFontSize={18}
      onTerminalFontSizeChange={() => {}}
      terminalGpuAcceleration="auto"
      onTerminalGpuAccelerationChange={() => {}}
      terminalFontFamily="Menlo"
      onTerminalFontFamilyChange={() => {}}
      terminalFontWeight={600}
      onTerminalFontWeightChange={() => {}}
      terminalFontWeightBold={800}
      onTerminalFontWeightBoldChange={() => {}}
      editorFontFamily="Monaco"
      onEditorFontFamilyChange={() => {}}
      inspectorVisible
      onInspectorChange={() => {}}
      statusBarVisible
      onStatusBarVisibleChange={() => {}}
      tasksButtonVisible
      onTasksButtonVisibleChange={() => {}}
      automationsButtonVisible
      onAutomationsButtonVisibleChange={() => {}}
      titlebarAppNameVisible
      onTitlebarAppNameVisibleChange={() => {}}
    />,
  ).replace(/<!-- -->/g, "");
}

describe("AppearanceSection typography prop path", () => {
  test("renders the prop values, not the envelope defaults", () => {
    const html = render();
    expect(html).toContain('value="600"');
    expect(html).toContain('value="800"');
    expect(html).toContain("Menlo");
  });
});
