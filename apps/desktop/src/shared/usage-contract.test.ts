import { describe, expect, test } from "vitest";
import {
  barColorClass,
  clampUsedPercent,
  formatBytes,
  formatResetCountdown,
  formatResetDuration,
  formatWindowChipLabel,
  formatWindowLabel,
  setAwakeInputSchema,
  usageSnapshotSchema,
} from "./usage-contract";

const window = { usedPercent: 10, windowMinutes: 300, resetsAt: null, resetDescription: null };

function snapshot() {
  return {
    claude: {
      provider: "claude",
      session: window,
      weekly: null,
      updatedAt: 1,
      error: null,
      status: "ok",
    },
    codex: {
      provider: "codex",
      session: null,
      weekly: null,
      updatedAt: 1,
      error: "nope",
      status: "error",
    },
    memory: { rssBytes: 1024, processCount: 3, unavailableReason: null },
    ports: { listening: [{ port: 3000, process: "node" }], unavailableReason: null },
    awake: { mode: "off", active: false, supported: true },
    updatedAt: 1,
  };
}

describe("usage contract (fail closed at the boundary)", () => {
  test("accepts a well-formed snapshot", () => {
    expect(usageSnapshotSchema.safeParse(snapshot()).success).toBe(true);
  });
  test("rejects out-of-range percents, NaN and wrong providers", () => {
    const bad = snapshot();
    bad.claude.session = { ...window, usedPercent: 101 };
    expect(usageSnapshotSchema.safeParse(bad).success).toBe(false);
    const nan = snapshot();
    nan.memory.rssBytes = Number.NaN;
    expect(usageSnapshotSchema.safeParse(nan).success).toBe(false);
    const provider = snapshot() as Record<string, unknown>;
    provider.claude = { ...(provider.claude as object), provider: "gemini" };
    expect(usageSnapshotSchema.safeParse(provider).success).toBe(false);
  });
  test("awake input accepts only on/off", () => {
    expect(setAwakeInputSchema.safeParse("on").success).toBe(true);
    expect(setAwakeInputSchema.safeParse("off").success).toBe(true);
    expect(setAwakeInputSchema.safeParse("auto").success).toBe(false);
    expect(setAwakeInputSchema.safeParse("").success).toBe(false);
    expect(setAwakeInputSchema.safeParse(null).success).toBe(false);
  });
});

describe("usage formatting", () => {
  test("clamps percents and colors bars on the 60/80 bands", () => {
    expect(clampUsedPercent(Number.NaN)).toBe(0);
    expect(clampUsedPercent(42.6)).toBe(43);
    expect(barColorClass(10)).toBe("status-bar-fill-low");
    expect(barColorClass(60)).toBe("status-bar-fill-mid");
    expect(barColorClass(80)).toBe("status-bar-fill-high");
  });
  test("formats reset countdowns", () => {
    expect(formatResetDuration(0)).toBe("now");
    expect(formatResetDuration(47 * 60_000)).toBe("47m");
    expect(formatResetDuration((3 * 60 + 54) * 60_000)).toBe("3h 54m");
    expect(formatResetCountdown(-1)).toBe("Resets now");
    expect(formatResetCountdown(60_000)).toBe("Resets in 1m");
  });
  test("labels window chips with live remaining time when known", () => {
    expect(formatWindowLabel(10080)).toBe("wk");
    expect(formatWindowLabel(300)).toBe("5h");
    expect(formatWindowChipLabel({ windowMinutes: 300, resetsAt: null })).toBe("5h");
    expect(formatWindowChipLabel({ windowMinutes: 300, resetsAt: 3_600_000 }, 0)).toBe("1h");
    expect(
      formatWindowChipLabel({ windowMinutes: 300, resetsAt: 47 * 60_000 }, 0),
    ).toBe("47m");
  });
  test("formats bytes, preserving null for unmeasured", () => {
    expect(formatBytes(null)).toBeNull();
    expect(formatBytes(-1)).toBeNull();
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2 * 1024 ** 3)).toBe("2.0 GB");
  });
});
