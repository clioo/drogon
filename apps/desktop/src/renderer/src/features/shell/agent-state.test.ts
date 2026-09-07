import { expect, test } from "vitest";
import {
  agentIconKind,
  agentStateLabel,
  agentStateOf,
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
  expect(agentStateLabel("unknown")).toBe("No agent update");
});

test("missing agentState renders unknown, never a guess", () => {
  expect(agentStateOf(base)).toBe("unknown");
  expect(agentStateOf({ ...base, agentState: "working" })).toBe("working");
});
