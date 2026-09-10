import { describe, expect, it } from "vitest";
import {
  botHandleLabel,
  botInitials,
  botSessionTitle,
  formatBotSessionStarted,
  formatElapsedClock,
  harnessProviderLabel,
} from "./bot-session-chrome";

describe("bot-session-chrome", () => {
  it("labels the harness with its real vendor", () => {
    expect(harnessProviderLabel("claude")).toBe("Claude (Anthropic)");
    expect(harnessProviderLabel("codex")).toBe("Codex (OpenAI)");
  });

  it("builds the tab/header title as '<name> · <Harness>'", () => {
    expect(botSessionTitle("Arya Stark", "claude")).toBe("Arya Stark · Claude");
  });

  it("derives up to two initials, never inventing a name", () => {
    expect(botInitials("Arya Stark")).toBe("AS");
    expect(botInitials("Watcher")).toBe("W");
    expect(botInitials("  ")).toBe("");
  });

  it("normalizes the handle with a leading @, or renders nothing", () => {
    expect(botHandleLabel("arya-stark")).toBe("@arya-stark");
    expect(botHandleLabel("@arya-stark")).toBe("@arya-stark");
    expect(botHandleLabel(null)).toBeNull();
  });

  it("formats an elapsed clock as HH:MM:SS", () => {
    expect(formatElapsedClock(0)).toBe("00:00:00");
    expect(formatElapsedClock(4 * 60_000 + 12_000)).toBe("00:04:12");
    expect(formatElapsedClock(90 * 60_000)).toBe("01:30:00");
  });

  it("pairs a relative phrase with the precise clock, live-ticking", () => {
    const started = 1_000_000;
    expect(formatBotSessionStarted(started, started + 30_000)).toBe(
      "Just now (00:00:30)",
    );
    expect(formatBotSessionStarted(started, started + 5 * 60_000)).toBe(
      "5m ago (00:05:00)",
    );
    expect(
      formatBotSessionStarted(started, started + 2 * 3_600_000 + 60_000),
    ).toBe("2h ago (02:01:00)");
  });
});
