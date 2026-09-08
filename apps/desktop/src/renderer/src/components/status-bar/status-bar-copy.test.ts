import { describe, expect, test } from "vitest";
import type { ProviderUsage } from "../../../../shared/usage-contract";
import {
  memoryLabel,
  memoryTitle,
  portsAriaLabel,
  portsLabel,
  portsTitle,
  providerMeterRows,
  providerTitle,
  terminalsTitle,
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

describe("resource copy", () => {
  test("memory renders bytes or unavailable with the reason", () => {
    expect(memoryLabel(1024 ** 3)).toBe("1.0 GB");
    expect(memoryLabel(null)).toBe("unavailable");
    expect(
      memoryTitle({ rssBytes: null, processCount: null, unavailableReason: "denied" }),
    ).toContain("denied");
    expect(
      memoryTitle({ rssBytes: 1024, processCount: 3, unavailableReason: null }),
    ).toContain("3 processes");
  });
  test("ports count honestly, including the empty and failed scans", () => {
    // Source PortsStatusSegment form: the count alone in the strip; the
    // word "ports" lives in the aria-label and tooltip.
    expect(portsLabel({ listening: [], unavailableReason: null })).toBe("0");
    expect(
      portsLabel({ listening: [{ port: 3000, process: "node" }], unavailableReason: null }),
    ).toBe("1");
    expect(portsLabel({ listening: [], unavailableReason: "no lsof" })).toBe("unavailable");
    expect(portsAriaLabel({ listening: [], unavailableReason: null })).toBe(
      "Ports, 0 workspace ports",
    );
    expect(
      portsAriaLabel({ listening: [{ port: 3000, process: "node" }], unavailableReason: null }),
    ).toBe("Ports, 1 workspace port");
    expect(portsTitle({ listening: [], unavailableReason: "no lsof" })).toContain("no lsof");
    expect(terminalsTitle(1)).toBe("1 live terminal");
    expect(terminalsTitle(2)).toBe("2 live terminals");
  });
});
