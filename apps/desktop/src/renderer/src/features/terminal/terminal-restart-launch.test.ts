// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/terminal-process-exit-restart.test.ts
// (the restart reuses the launch record), adapted to the Drogon session
// record projection the App restart handler consumes.
import { describe, expect, it } from "vitest";

import {
  projectTerminalRestartLaunch,
  projectTerminalRestartResume,
} from "./terminal-restart-launch";

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

// The overlay's primary action and the launch it performs are one decision:
// the resume input is derived from the SAME projections the pane rendered.
describe("terminal restart resume projection", () => {
  const record = (overrides: Record<string, unknown> = {}) => ({
    id: "sess-1",
    workspaceId: "ws-1",
    verdict: "exited" as const,
    exitCode: 1,
    harnessId: "pi" as const,
    agentSessionId: "01a0c0f6-5b60-72e7-8dc5-a9ed89ce5409",
    agentSessionTranscriptPath: null as string | null,
    args: ["--provider", "zai"],
    ...overrides,
  });

  it("resumes a sleeping session's conversation", () => {
    expect(
      projectTerminalRestartResume(record({ verdict: "unverifiable" })),
    ).toEqual({ resume: true, resumeSessionId: "sess-1" });
  });

  it("resumes an EXITED harness session, exactly like the overlay it rendered", () => {
    expect(projectTerminalRestartResume(record())).toEqual({
      resume: true,
      resumeSessionId: "sess-1",
    });
  });

  it("keeps a plain relaunch for a shell, an unknown harness and a headless turn", () => {
    expect(projectTerminalRestartResume(record({ harnessId: null }))).toEqual({});
    expect(projectTerminalRestartResume(record({ harnessId: "aider" }))).toEqual(
      {},
    );
    // A headless one-shot run is restarted, never resumed interactively.
    expect(
      projectTerminalRestartResume(record({ args: ["-p", "do the thing"] })),
    ).toEqual({});
  });

  it("never asks to resume a session that is still live, or no record at all", () => {
    expect(projectTerminalRestartResume(record({ verdict: "live" }))).toEqual(
      {},
    );
    expect(projectTerminalRestartResume(undefined)).toEqual({});
  });
});
