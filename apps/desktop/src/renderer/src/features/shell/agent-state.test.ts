import { expect, test } from "vitest";
import {
  agentIconKind,
  agentStateLabel,
  agentStateOf,
  sessionDotState,
} from "./agent-state";
import type { Session } from "../../../../shared/session-contract";

const base: Session = {
  id: "s1",
  workspaceId: "w1",
  hostId: "h",
  incarnation: "i1",
  command: "sh",
  args: [],
  cols: 80,
  rows: 24,
  verdict: "live",
  exitCode: null,
  createdAt: "2026-09-05T00:00:00Z",
};

test("every contract state maps to a distinct icon kind", () => {
  expect(agentIconKind("working")).toBe("working");
  expect(agentIconKind("idle")).toBe("idle");
  expect(agentIconKind("needs_input")).toBe("needs-input");
  expect(agentIconKind("exited")).toBe("exited");
  expect(agentIconKind("unknown")).toBe("unknown");
});

test("labels stay human-readable for tabs and card dots", () => {
  expect(agentStateLabel("working")).toBe("Working");
  expect(agentStateLabel("idle")).toBe("Idle");
  expect(agentStateLabel("needs_input")).toBe("Waiting for input");
  expect(agentStateLabel("exited")).toBe("Exited");
  expect(agentStateLabel("unknown")).toBe("No recent update");
});

test("missing agentState renders unknown, never a guess", () => {
  expect(agentStateOf(base)).toBe("unknown");
  expect(agentStateOf({ ...base, agentState: "working" })).toBe("working");
  expect(agentStateOf({ ...base, agentState: "idle" })).toBe("idle");
  expect(agentStateOf({ ...base, agentState: "needs_input" })).toBe(
    "needs_input",
  );
  expect(agentStateOf({ ...base, agentState: "exited" })).toBe("exited");
  expect(agentStateOf({ ...base, agentState: "unknown" })).toBe("unknown");
});

test("idle and unknown never render as working", () => {
  expect(agentIconKind(agentStateOf({ ...base, agentState: "idle" }))).toBe(
    "idle",
  );
  expect(agentIconKind(agentStateOf(base))).toBe("unknown");
});

test("an unverifiable session never claims a running agent", () => {
  // Regression (task_c31304f08555): the daemon holds no child for an
  // `unverifiable` id (a held child is always `live`), so `working`/`idle`
  // are history. Rendering them put the sidebar's emerald "done" check and
  // the working spinner on a dead tab.
  expect(
    sessionDotState({ ...base, verdict: "unverifiable", agentState: "idle" }),
  ).toBe("unknown");
  expect(
    sessionDotState({
      ...base,
      verdict: "unverifiable",
      agentState: "working",
    }),
  ).toBe("unknown");
  // The durable wait signal and a positive exit keep their own meaning.
  expect(
    sessionDotState({
      ...base,
      verdict: "unverifiable",
      agentState: "needs_input",
    }),
  ).toBe("needs_input");
  expect(
    sessionDotState({ ...base, verdict: "exited", agentState: "exited" }),
  ).toBe("exited");
  // A live session still reports exactly what the daemon derived.
  expect(sessionDotState({ ...base, agentState: "working" })).toBe("working");
});
