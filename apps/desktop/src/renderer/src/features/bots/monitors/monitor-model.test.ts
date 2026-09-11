/* C10 monitors model: pure validation and projection tests. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MONITOR_RULE_KIND_GITHUB_PR,
  MONITOR_RULE_KIND_HTTP_POLL,
  MONITOR_RULE_KIND_SCRIPT,
  SUPPORTED_MONITOR_RULE_KINDS,
  emptyMonitorForm,
  isMonitorFormReady,
  monitorActionsEnabled,
  monitorRuleKindSupported,
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

  it("fails closed on an unknown rule kind", () => {
    const unknown = record({ ruleKind: "future_kind.v9", approved: false });
    expect(monitorRuleKindSupported(unknown.ruleKind)).toBe(false);
    expect(monitorActionsEnabled(unknown)).toBe(false);
    // Approval must never be implied by a kind this UI cannot describe.
    expect(monitorStatusLabel(unknown)).toBe("Unsupported rule kind");
  });

  it("admits exactly the four kinds the daemon ships — derived from the Rust source, not hand-copied", () => {
    // Drift guard: every kind the daemon accepts and this renderer can
    // render/manage must be in the supported set, and nothing else. The
    // daemon's accepted set is DERIVED from its source (rule.rs) so a
    // kind shipping daemon-side cannot silently be disowned by this UI
    // (exactly what happened to github_pr.v1) — and a kind this UI
    // stops rendering is a deliberate edit of monitor-model.ts, which
    // this test then refuses to merge silently.
    const ruleRs = fileURLToPath(
      new URL(
        "../../../../../../../../crates/drogon-core/src/bots/monitors/rule.rs",
        import.meta.url,
      ),
    );
    const source = readFileSync(ruleRs, "utf8");
    const daemonKinds = [
      ...source.matchAll(/pub const (RULE_KIND_[A-Z_]+): &str = "([^"]+)"/g),
    ].map((match) => match[2]);
    expect(daemonKinds.length).toBeGreaterThanOrEqual(1);
    expect([...SUPPORTED_MONITOR_RULE_KINDS].sort()).toEqual(
      [...daemonKinds].sort(),
    );
  });

  it("admits the script, http-poll and github-pr kinds the daemon ships", () => {
    for (const ruleKind of [
      MONITOR_RULE_KIND_SCRIPT,
      MONITOR_RULE_KIND_HTTP_POLL,
      MONITOR_RULE_KIND_GITHUB_PR,
    ]) {
      const view = record({ ruleKind, approved: false });
      expect(monitorRuleKindSupported(view.ruleKind)).toBe(true);
      expect(monitorActionsEnabled(view)).toBe(true);
      // A parked watch of a supported kind reads as what it is: parked
      // at needs-approval, never "Unsupported rule kind".
      expect(monitorStatusLabel(view)).toBe("Needs approval");
    }
  });
});
