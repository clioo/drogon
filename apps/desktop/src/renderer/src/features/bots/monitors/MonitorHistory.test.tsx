/* C10 monitors history: card and history rendering over static markup. */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MonitorCard, MonitorHistory } from "./MonitorHistory";
import type { MonitorCheckView, MonitorRecordView } from "./monitor-model";

function monitor(overrides: Partial<MonitorRecordView> = {}): MonitorRecordView {
  return {
    id: "mon-1",
    botId: "bot-1",
    version: 2,
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

function check(overrides: Partial<MonitorCheckView> = {}): MonitorCheckView {
  return {
    id: "chk-1",
    monitorId: "mon-1",
    monitorVersion: 2,
    outcome: "no_change",
    eventId: null,
    cursor: "v1:abc",
    errorKind: null,
    message: null,
    observedAtMs: 10,
    delivery: "not_applicable",
    ...overrides,
  };
}

function renderCard(
  props: Partial<Parameters<typeof MonitorCard>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(MonitorCard, {
      monitor: monitor(),
      checks: [],
      busy: false,
      onToggleEnabled: () => {},
      onRunCheck: () => {},
      onDelete: () => {},
      ...props,
    }),
  );
}

describe("MonitorHistory", () => {
  it("renders the empty state without rows", () => {
    const markup = renderToStaticMarkup(createElement(MonitorHistory, { checks: [] }));
    expect(markup).toContain("No checks yet.");
  });

  it("renders changed rows with their delivery state", () => {
    const markup = renderToStaticMarkup(
      createElement(MonitorHistory, {
        checks: [
          check({
            id: "c1",
            outcome: "changed",
            eventId: "mev_abc",
            delivery: "pending",
            observedAtMs: 3,
          }),
        ],
      }),
    );
    expect(markup).toContain("monitor-check-c1");
    expect(markup).toContain("delivery pending");
  });

  it("renders the card with run/enable/delete controls and history", () => {
    const markup = renderCard({
      monitor: monitor({ lastError: "missing file" }),
      checks: [check({ id: "c9" })],
    });
    expect(markup).toContain("monitor-mon-1");
    expect(markup).toContain("notes/status.md");
    expect(markup).toContain("monitor-run-mon-1");
    expect(markup).toContain("monitor-toggle-mon-1");
    expect(markup).toContain("monitor-delete-mon-1");
    expect(markup).toContain("Last error: missing file");
    expect(markup).toContain("monitor-check-c9");
  });

  it("marks disabled monitors without hiding their history", () => {
    const markup = renderCard({
      monitor: monitor({ enabled: false }),
      checks: [check({ id: "c2" })],
    });
    expect(markup).toContain("Disabled");
    expect(markup).toContain("Enable");
    expect(markup).toContain("monitor-check-c2");
  });
});
