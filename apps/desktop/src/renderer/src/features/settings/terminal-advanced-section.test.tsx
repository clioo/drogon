// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { terminalSettingsDefaults } from "../terminal/terminal-settings";
import { TerminalAdvancedSection } from "./terminal-advanced-section";
import type { TerminalSettings } from "../terminal/terminal-settings";

afterEach(() => cleanup());

function settings(overrides: Partial<TerminalSettings> = {}): TerminalSettings {
  return { ...terminalSettingsDefaults(), ...overrides };
}

describe("Terminal Advanced settings", () => {
  test("changes a scrollback preset and commits a bounded custom value", () => {
    const onChange = vi.fn();
    render(
      <TerminalAdvancedSection settings={settings()} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "25000 rows" }));
    expect(onChange).toHaveBeenCalledWith({ terminalScrollbackRows: 25_000 });

    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    const input = screen.getByRole("spinbutton", {
      name: "Custom scrollback rows",
    });
    fireEvent.change(input, { target: { value: "999999" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith({
      terminalScrollbackRows: 50_000,
    });
  });

  test("shows the custom editor when persisted rows are not a preset", () => {
    render(
      <TerminalAdvancedSection
        settings={settings({ terminalScrollbackRows: 12_345 })}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("spinbutton", { name: "Custom scrollback rows" }),
    ).toBeDefined();
  });

  test("persists word separators from the accessible input", () => {
    const onChange = vi.fn();
    render(
      <TerminalAdvancedSection settings={settings()} onChange={onChange} />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Word Separators" }), {
      target: { value: " /" },
    });
    expect(onChange).toHaveBeenCalledWith({ terminalWordSeparator: " /" });
  });
});
