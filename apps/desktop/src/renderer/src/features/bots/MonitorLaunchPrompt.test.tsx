// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import type { Session } from "../../../../shared/session-contract";
import { MonitorLaunchPrompt, monitorLaunchPrompt } from "./MonitorLaunchPrompt";

afterEach(cleanup);
const session = (overrides: Partial<Session> = {}): Session => ({
  id: "coordinator", workspaceId: "project", hostId: "host", incarnation: "inc",
  command: "pi", args: [], cols: 80, rows: 24, verdict: "live", exitCode: null,
  createdAt: "2026-09-14T00:00:00Z", harnessId: "pi", causedByEventId: "event",
  ...overrides,
});

describe("monitor launch prompt", () => {
  test.each([
    ["pi", ["--model", "provider/model", "-p", "Drogon task:\nactual prompt"], "Drogon task:\nactual prompt"],
    ["pi", ["-p", "Drogon task:\nactual prompt", "--extension", "/managed/hook.ts"], "Drogon task:\nactual prompt"],
    ["claude", ["-p", "--", "actual prompt"], "actual prompt"],
    ["claude", ["-p", "--", "actual prompt", "--settings", "/managed/hooks.json"], "actual prompt"],
    ["opencode", ["run", "--model", "provider/model", "actual prompt"], "actual prompt"],
    ["codex", ["exec", "actual prompt"], "actual prompt"],
    ["antigravity", ["-p", "actual prompt"], "actual prompt"],
  ] as const)("reads the exact %s headless argument", (harnessId, args, expected) => {
    expect(monitorLaunchPrompt(session({ harnessId, args: [...args] }))).toBe(expected);
  });
  test("does not mistake an interactive launch or an unrecognized argv for a prompt", () => {
    expect(monitorLaunchPrompt(session({ args: ["--model", "provider/model"] }))).toBeNull();
    expect(monitorLaunchPrompt(session({ causedByEventId: null, args: ["-p", "Drogon task:\nprompt"] }))).toBeNull();
  });
  test("shows the complete recorded prompt as text in a read-only disclosure, including after exit", () => {
    const prompt = `Drogon task:\n<script>not executable</script>\n${"evidence\n".repeat(800)}`;
    render(<MonitorLaunchPrompt session={session({ args: ["-p", prompt], verdict: "exited", exitCode: 0 })} />);
    expect(screen.getByTestId("monitor-launch-prompt").hasAttribute("open")).toBe(false);
    fireEvent.click(screen.getByText("Launch prompt", { exact: true }));
    expect(screen.getByTestId("monitor-launch-prompt-text").textContent).toBe(prompt);
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText(/does not run it again/)).toBeTruthy();
  });
  test("shows separate system instructions when the harness received them", () => {
    render(<MonitorLaunchPrompt session={session({ harnessId: "claude", args: ["--append-system-prompt", "system context", "-p", "--", "task"] })} />);
    expect(screen.getByText("system context")).toBeTruthy();
    expect(screen.getByTestId("monitor-launch-prompt-text").textContent).toBe("task");
  });
});
