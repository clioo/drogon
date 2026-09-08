// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { terminalSettingsDefaults } from "../terminal/terminal-settings";
import { TerminalInteractionSection } from "./terminal-interaction-section";
import type { TerminalSettings } from "../terminal/terminal-settings";

afterEach(() => cleanup());

function settings(overrides: Partial<TerminalSettings> = {}): TerminalSettings {
  return { ...terminalSettingsDefaults(), ...overrides };
}

describe("Terminal Interaction settings", () => {
  test("renders and updates all mouse/clipboard controls", () => {
    const onChange = vi.fn();
    render(
      <TerminalInteractionSection settings={settings()} onChange={onChange} />,
    );

    expect(
      screen.getByRole("heading", { name: "Terminal Interaction" }),
    ).toBeDefined();
    fireEvent.change(screen.getByRole("slider", { name: "Normal" }), {
      target: { value: "2" },
    });
    expect(onChange).toHaveBeenCalledWith({ terminalScrollSensitivity: 2 });

    fireEvent.click(
      screen.getByRole("switch", { name: "Right-click to paste" }),
    );
    fireEvent.click(
      screen.getByRole("switch", { name: "Focus Follows Mouse" }),
    );
    fireEvent.click(screen.getByRole("switch", { name: "Copy on Select" }));
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Allow TUI Clipboard Writes (OSC 52)",
      }),
    );
    expect(onChange).toHaveBeenNthCalledWith(2, {
      terminalRightClickToPaste: true,
    });
    expect(onChange).toHaveBeenNthCalledWith(5, {
      terminalAllowOsc52Clipboard: false,
    });
  });

  test("reset restores all three scroll multipliers", () => {
    const onChange = vi.fn();
    render(
      <TerminalInteractionSection
        settings={settings({
          terminalScrollSensitivity: 2,
          terminalFastScrollSensitivity: 8,
          terminalTuiScrollSensitivity: 4,
        })}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onChange).toHaveBeenCalledWith({
      terminalScrollSensitivity: 1.15,
      terminalFastScrollSensitivity: 5,
      terminalTuiScrollSensitivity: 1,
    });
  });
});
