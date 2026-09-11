/* Session details: the delegation attribution row. A session a monitor
   event released says so (the event id the monitor's firing history names);
   every other session shows no such row, never a fabricated one. */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { SessionDetailsPanel } from "./SessionDetailsPanel";
import type { Session } from "../../../../shared/session-contract";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-1",
    workspaceId: "ws-1",
    hostId: "host-1",
    incarnation: "inc-1",
    command: "/bin/sh",
    args: [],
    harnessId: "codex",
    parentSessionId: null,
    causedByEventId: null,
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-11T00:00:00Z",
    ...overrides,
  };
}

describe("SessionDetailsPanel", () => {
  it("names the monitor event that caused a delegated session", () => {
    const html = renderToStaticMarkup(
      createElement(SessionDetailsPanel, {
        terminal: session({ causedByEventId: "mev_00112233445566778899aabbccddeeff" }),
      }),
    );
    expect(html).toContain("<dt>Caused by</dt>");
    expect(html).toContain("Monitor event mev_00112233445566778899aabbccddeeff");
  });

  it("shows no attribution row for a session nobody delegated", () => {
    const html = renderToStaticMarkup(
      createElement(SessionDetailsPanel, { terminal: session() }),
    );
    expect(html).not.toContain("Caused by");
  });

  it("still shows the empty state with no terminal", () => {
    const html = renderToStaticMarkup(
      createElement(SessionDetailsPanel, { terminal: null }),
    );
    expect(html).toContain("Select a terminal to see its execution details.");
  });
});
