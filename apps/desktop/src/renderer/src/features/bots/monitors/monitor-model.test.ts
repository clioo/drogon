/* C10 monitors model: pure validation and projection tests. */

import { describe, expect, it } from "vitest";
import {
  emptyMonitorForm,
  isMonitorFormReady,
  monitorStatusLabel,
  validateMonitorCron,
  validateMonitorResource,
  visibleMonitorChecks,
} from "./monitor-model";
import type { MonitorCheckView, MonitorRecordView } from "./monitor-model";

function record(overrides: Partial<MonitorRecordView> = {}): MonitorRecordView {
  return {
    id: "mon-1",
    botId: "bot-1",
    version: 1,
    ruleKind: "local_file_digest.v1",
    hostId: "host-1",
    projectId: "proj-1",
    resource: "notes/status.md",
    maxBytes: 65536,
    trigger: { kind: "manual" },
    cursor: null,
    enabled: true,
    approved: true,
    consecutiveErrors: 0,
    lastEventId: null,
    lastError: null,
    ...overrides,
  };
}

describe("monitor-model", () => {
  it("starts empty and becomes ready with a scoped relative file", () => {
    expect(isMonitorFormReady(emptyMonitorForm())).toBe(false);
    expect(
      isMonitorFormReady({
        ...emptyMonitorForm(),
        name: "Watcher",
        resource: "notes/status.md",
      }),
    ).toBe(true);
  });

  it("refuses absolute paths, dotdot escapes, and oversized bounds", () => {
    expect(validateMonitorResource("/etc/passwd")).not.toBeNull();
    expect(validateMonitorResource("../secret")).not.toBeNull();
    expect(validateMonitorResource("notes/status.md")).toBeNull();
    expect(
      isMonitorFormReady({
        ...emptyMonitorForm(),
        name: "Watcher",
        resource: "notes/status.md",
        maxBytes: 256 * 1024 + 1,
      }),
    ).toBe(false);
  });

  it("gates scheduled triggers on a real cron string", () => {
    expect(validateMonitorCron("")).not.toBeNull();
    expect(validateMonitorCron("* * * * *")).toBeNull();
    expect(
      isMonitorFormReady({
        ...emptyMonitorForm(),
        name: "Watcher",
        resource: "notes/status.md",
        trigger: { kind: "scheduled", cron: "" },
      }),
    ).toBe(false);
  });

  it("labels disabled/needs-approval/error/watching/new states", () => {
    expect(monitorStatusLabel(record({ enabled: false }))).toBe("Disabled");
    expect(monitorStatusLabel(record({ approved: false }))).toBe("Needs approval");
    expect(monitorStatusLabel(record({ lastError: "gone" }))).toBe("Error");
    expect(monitorStatusLabel(record({ cursor: "v1:abc" }))).toBe("Watching");
    expect(monitorStatusLabel(record())).toBe("New");
  });

  it("orders history newest-first and caps the card surface", () => {
    const check = (id: string, at: number): MonitorCheckView => ({
      id,
      monitorId: "mon-1",
      monitorVersion: 1,
      outcome: "no_change",
      eventId: null,
      cursor: "v1:abc",
      errorKind: null,
      message: null,
      observedAtMs: at,
      delivery: "not_applicable",
    });
    const visible = visibleMonitorChecks(
      [check("a", 1), check("b", 3), check("c", 2)],
      2,
    );
    expect(visible.map((c) => c.id)).toEqual(["b", "c"]);
  });
});
