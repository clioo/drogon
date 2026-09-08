import { describe, expect, test } from "vitest";
import type { ProviderUsage } from "../../../../shared/usage-contract";
import {
  awakeStatusLabel,
  hasVisibleUsage,
  memoryBadge,
  portsAriaLabel,
  portsLabel,
  portsTitle,
  providerBadgeLetter,
  providerMeterRows,
  providerStatusLabel,
  providerTitle,
  REFRESH_RATE_LIMITS_LABEL,
  resourceManagerAriaLabel,
  resourceManagerSessionCount,
  resourceManagerTooltipLines,
} from "./status-bar-copy";

function claude(): ProviderUsage {
  return {
    provider: "claude",
    session: { usedPercent: 55.4, windowMinutes: 300, resetsAt: 3_600_000, resetDescription: "x" },
    weekly: { usedPercent: 30, windowMinutes: 10080, resetsAt: null, resetDescription: null },
    fableWeekly: { usedPercent: 8, windowMinutes: 10080, resetsAt: null, resetDescription: null },
    updatedAt: 1,
    error: null,
    status: "ok",
  };
}

describe("provider meter projections", () => {
  test("renders session, weekly and the Fable tier share", () => {
    const rows = providerMeterRows(claude(), 0);
    expect(rows.map((row) => row.key)).toEqual(["session", "weekly", "fable"]);
    expect(rows[0].label).toBe("55% used 1h");
    expect(rows[1].label).toBe("30% used wk");
    expect(rows[2].label).toBe("8% used Fable");
    expect(rows[0].title).toContain("Resets in 1h");
    expect(rows[1].title).toContain("reset unknown");
  });
  test("an unavailable provider explains itself, never a fake number", () => {
    const provider: ProviderUsage = {
      ...claude(),
      session: null,
      weekly: null,
      fableWeekly: null,
      status: "unavailable",
      error: "Claude is not signed in on this machine.",
    };
    expect(providerMeterRows(provider, 0)).toEqual([]);
    expect(providerTitle(provider, 0)).toContain("not signed in");
  });
  test("ok providers list every meter line in the tooltip", () => {
    expect(providerTitle(claude(), 0)).toContain("Fable · 8% used");
  });
});

describe("source provider status labels (usage-error-copy.ts)", () => {
  test("a failed network request is a Network issue", () => {
    expect(
      providerStatusLabel({
        ...claude(),
        session: null,
        weekly: null,
        fableWeekly: null,
        status: "error",
        error: "Claude usage is unreachable (HTTP 503).",
      }),
    ).toBe("Network issue");
  });
  test("a provider-side rate-limit refusal reads Limited", () => {
    expect(
      providerStatusLabel({
        ...claude(),
        session: null,
        weekly: null,
        fableWeekly: null,
        status: "error",
        error: "Codex reported rate limits exceeded.",
      }),
    ).toBe("Limited");
  });
  test("everything else is a failed refresh, and ok statuses have no label", () => {
    expect(
      providerStatusLabel({
        ...claude(),
        session: null,
        weekly: null,
        fableWeekly: null,
        status: "error",
        error: "Codex helper exited before reporting usage.",
      }),
    ).toBe("Refresh failed");
    expect(providerStatusLabel(claude())).toBeNull();
    expect(
      providerStatusLabel({ ...claude(), status: "unavailable", error: "signed out" }),
    ).toBeNull();
  });
  test("icon-only letter badges match the source (Claude C, Codex X)", () => {
    expect(providerBadgeLetter("claude")).toBe("C");
    expect(providerBadgeLetter("codex")).toBe("X");
  });
});

describe("source chrome copy (#127)", () => {
  test("refresh names rate limits and gates on non-empty usage", () => {
    expect(REFRESH_RATE_LIMITS_LABEL).toBe("Refresh rate limits");
    expect(hasVisibleUsage([claude(), claude()], 0)).toBe(true);
    const empty: ProviderUsage = {
      ...claude(),
      session: null,
      weekly: null,
      fableWeekly: null,
      status: "ok",
      error: null,
    };
    expect(hasVisibleUsage([empty, empty], 0)).toBe(false);
  });
  test("awake carries the mode plus the Active/Inactive suffix", () => {
    expect(awakeStatusLabel("off", false)).toBe("Keep computer awake, Off · Inactive");
    expect(awakeStatusLabel("on", true)).toBe("Keep computer awake, On · Active");
  });
});

describe("resource manager copy (resource-manager-terminal-copy.ts)", () => {
  test("memory badge uses the source formatMemory tiers and an em dash when unmeasured", () => {
    expect(memoryBadge(1024 * 1024 * 888.3 * 1)).toBe("888.3 MB");
    expect(memoryBadge(512 * 1024)).toBe("512 KB");
    expect(memoryBadge(1536 * 1024 * 1024)).toBe("1.50 GB");
    expect(memoryBadge(null)).toBe("—");
  });
  test("session count pluralizes like the source", () => {
    expect(resourceManagerSessionCount(1)).toBe("1 terminal session");
    expect(resourceManagerSessionCount(2)).toBe("2 terminal sessions");
    expect(resourceManagerAriaLabel(1)).toBe("Resource Manager, 1 terminal session");
    expect(resourceManagerAriaLabel(3)).toBe("Resource Manager, 3 terminal sessions");
  });
  test("tooltip lines summarize memory and sessions, then the workspace hint", () => {
    expect(resourceManagerTooltipLines("888.3 MB", 1)).toEqual([
      "Resource Manager - 888.3 MB - 1 terminal session",
      "Terminal sessions are grouped by workspace.",
    ]);
    expect(resourceManagerTooltipLines(null, 0)).toEqual([
      "Resource Manager - memory unavailable - 0 terminal sessions",
      "No terminal sessions yet.",
    ]);
  });
});

describe("ports copy", () => {
  test("ports count honestly, including the empty and failed scans", () => {
    // Source PortsStatusSegment form: the count alone in the strip; the
    // word "ports" lives in the aria-label and tooltip.
    expect(portsLabel({ listening: [], unavailableReason: null })).toBe("0");
    expect(
      portsLabel({ listening: [{ port: 3000, process: "node" }], unavailableReason: null }),
    ).toBe("1");
    expect(portsLabel({ listening: [], unavailableReason: "no lsof" })).toBe("0");
    expect(portsAriaLabel({ listening: [], unavailableReason: null })).toBe(
      "Ports, 0 workspace ports",
    );
    expect(
      portsAriaLabel({ listening: [{ port: 3000, process: "node" }], unavailableReason: null }),
    ).toBe("Ports, 1 workspace port");
    expect(portsTitle({ listening: [], unavailableReason: "no lsof" })).toContain("no lsof");
    expect(portsTitle({ listening: [], unavailableReason: null })).toBe(
      "Ports — 0 workspace ports",
    );
    expect(
      portsTitle({ listening: [{ port: 3000, process: "node" }], unavailableReason: null }),
    ).toBe("Ports — 1 workspace port");
  });
});
