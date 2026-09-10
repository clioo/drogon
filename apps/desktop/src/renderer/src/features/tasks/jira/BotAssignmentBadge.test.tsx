// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// C11 render tests for the local Bot assignment badge: nothing renders when
// unassigned, an active assignment shows the Bot name with explicit
// "local, Jira assignee unchanged" wording, and a deleted Bot shows the
// honest reassign state instead of pretending the Bot is live.
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { BotAssignmentBadge } from "./BotAssignmentBadge";
import type { TaskBotAssignment } from "./bot-assignment-state";

function assignment(
  overrides: Partial<TaskBotAssignment["record"]> = {},
  botState: TaskBotAssignment["botState"] = "active",
): TaskBotAssignment {
  return {
    record: {
      scope: {
        hostId: "host-a",
        projectId: "proj-1",
        provider: "jira",
        instance: "site-x",
        taskId: "10001",
      },
      botId: "bot-1",
      botFolder: "ws-1",
      botName: "Muse",
      version: 2,
      assignedAt: "2026-09-10T00:00:00Z",
      updatedAt: "2026-09-10T00:00:00Z",
      ...overrides,
    },
    botState,
  };
}

afterEach(cleanup);

describe("BotAssignmentBadge", () => {
  test("renders nothing when the task is unassigned", () => {
    const { container } = render(<BotAssignmentBadge assignment={null} />);
    expect(container.children.length).toBe(0);
  });

  test("active assignment shows the Bot name with local-vs-Jira wording", () => {
    const screen = render(<BotAssignmentBadge assignment={assignment()} />);
    expect(screen.getByText("Muse")).toBeTruthy();
    const badge = screen.getByRole("status");
    expect(badge.getAttribute("aria-label")).toContain("Local Bot");
    expect(badge.getAttribute("aria-label")).toContain("not change");
    expect(badge.getAttribute("title")).toContain("Muse");
  });

  test("deleted bot renders the destructive reassign state", () => {
    const screen = render(
      <BotAssignmentBadge assignment={assignment({}, "deleted")} />,
    );
    const badge = screen.getByRole("status");
    expect(badge.getAttribute("aria-label")).toContain("no longer exists");
    expect(badge.getAttribute("aria-label")).toContain("Reassign or unassign");
    expect(badge.className).toContain("destructive");
  });
});
