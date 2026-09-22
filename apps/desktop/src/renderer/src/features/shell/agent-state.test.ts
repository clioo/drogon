import { describe, expect, test } from "vitest";
import {
  agentIconKind,
  agentStateLabel,
  agentStateOf,
  sessionAgentState,
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

describe("shell-aware agent activity (owner's report, F1)", () => {
  const shell = (overrides: Partial<Session> = {}): Session => ({
    ...base,
    harnessId: null,
    observedHarnessId: null,
    ...overrides,
  });
  const launched = (overrides: Partial<Session> = {}): Session =>
    shell({ harnessId: "pi", ...overrides });
  const observed = (overrides: Partial<Session> = {}): Session =>
    shell({ observedHarnessId: "pi", ...overrides });

  test("unproven shell working reads unknown, never working nor idle", () => {
    // Old-daemon wire: echo/redraw bytes inside the activity window derive
    // `working` for a harness-less shell. Coordinator guardrail:
    // recognition is not turn evidence, and a manufactured Idle is no more
    // honest than the Working claim — the turn is simply unknown.
    expect(sessionAgentState(shell({ agentState: "working" }))).toBe(
      "unknown",
    );
    expect(
      agentIconKind(sessionAgentState(shell({ agentState: "working" }))),
    ).toBe("unknown");
  });

  test("an observed harness repaints the same unknown turn", () => {
    // An idle composer hosted in a shell repaints with no hooks firing;
    // identity (row title, glyph) is kept, but the turn stays unknown.
    expect(sessionAgentState(observed({ agentState: "working" }))).toBe(
      "unknown",
    );
  });

  test("a harness.start launch keeps its working", () => {
    // Current daemons only emit launch `working` for a hook-reported turn,
    // so the wire state is authoritative there. Old-daemon limitation: a
    // launched idle repaint is indistinguishable on the wire (no
    // turn-authority field), so old launched `working` still passes through.
    expect(sessionAgentState(launched({ agentState: "working" }))).toBe(
      "working",
    );
  });

  test("every other shell state passes through untouched", () => {
    expect(sessionAgentState(shell({ agentState: "idle" }))).toBe("idle");
    expect(sessionAgentState(shell({ agentState: "needs_input" }))).toBe(
      "needs_input",
    );
    expect(sessionAgentState(shell({ agentState: "exited" }))).toBe("exited");
    expect(sessionAgentState(shell())).toBe("unknown");
    expect(sessionAgentState(shell({ agentState: "unknown" }))).toBe(
      "unknown",
    );
  });

  test("the unverifiable rule still applies before the shell rule", () => {
    expect(
      sessionAgentState(
        shell({ verdict: "unverifiable", agentState: "working" }),
      ),
    ).toBe("unknown");
    expect(
      sessionAgentState(
        launched({ verdict: "unverifiable", agentState: "working" }),
      ),
    ).toBe("unknown");
  });
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
