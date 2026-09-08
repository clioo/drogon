// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/terminal-process-exit-restart.test.ts
// (the restart reuses the launch record), adapted to the Drogon session
// record projection the App restart handler consumes.
import { describe, expect, it } from "vitest";

import { projectTerminalRestartLaunch } from "./terminal-restart-launch";

describe("terminal restart launch projection", () => {
  it("re-launches a harness session through harness.start with the record's harness id", () => {
    const launch = projectTerminalRestartLaunch(
      {
        workspaceId: "ws-1",
        command: "/Users/x/bin/pi",
        args: ["--provider", "zai"],
        harnessId: "pi",
      },
      "ws-fallback",
    );
    expect(launch).toEqual({
      kind: "harness",
      workspaceId: "ws-1",
      harnessId: "pi",
    });
  });

  it("re-launches a plain shell session with the record's exact argv", () => {
    const launch = projectTerminalRestartLaunch(
      {
        workspaceId: "ws-2",
        command: "/bin/zsh",
        args: ["-l"],
        harnessId: null,
      },
      "ws-fallback",
    );
    expect(launch).toEqual({
      kind: "shell",
      workspaceId: "ws-2",
      command: "/bin/zsh",
      args: ["-l"],
    });
  });

  it("falls back to the daemon default shell when no record is listed", () => {
    expect(projectTerminalRestartLaunch(undefined, "ws-3")).toEqual({
      kind: "default",
      workspaceId: "ws-3",
    });
  });

  it("prefers the record's workspace over the event detail", () => {
    const launch = projectTerminalRestartLaunch(
      {
        workspaceId: "ws-record",
        command: "/bin/sh",
        args: [],
        harnessId: null,
      },
      "ws-detail",
    );
    expect(launch.workspaceId).toBe("ws-record");
  });
});
