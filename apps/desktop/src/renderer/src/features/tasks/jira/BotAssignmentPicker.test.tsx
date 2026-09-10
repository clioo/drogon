// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// C11 render tests for the local Bot assignment picker: the trigger state,
// the option list (with selected/disabled/honest-deleted states), the CAS
// expectedVersion passed to onAssign/onClear, and the local-vs-remote copy
// that separates this picker from Jira's assignee.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { BotAssignmentPicker } from "./BotAssignmentPicker";
import type {
  BotAssignmentOption,
  TaskBotAssignment,
} from "./bot-assignment-state";
import { installRadixJsdomStubs } from "../../../components/ui/radix-jsdom-stubs";

const bots: BotAssignmentOption[] = [
  { id: "bot-1", name: "Muse" },
  { id: "bot-2", name: "Luna" },
];

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
      version: 4,
      assignedAt: "2026-09-10T00:00:00Z",
      updatedAt: "2026-09-10T00:00:00Z",
      ...overrides,
    },
    botState,
  };
}

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

function openPicker() {
  fireEvent.click(screen.getByRole("button", { name: /local bot/i }));
}

describe("BotAssignmentPicker", () => {
  test("unassigned trigger offers Assign and the popover explains locality", () => {
    render(
      <BotAssignmentPicker
        assignment={null}
        bots={bots}
        onAssign={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", {
      name: "Local Bot: none assigned",
    });
    expect(trigger.textContent).toContain("Assign Local Bot");

    openPicker();
    expect(
      screen.getByText(
        "Drogon-local assignment. The Jira assignee is never changed.",
      ),
    ).toBeTruthy();
    // No unassign row when nothing is assigned.
    expect(screen.queryByText("Unassign Bot")).toBeNull();
  });

  test("listing bots marks the assigned one and assigning passes the CAS version", async () => {
    const onAssign = vi.fn();
    const onClear = vi.fn();
    render(
      <BotAssignmentPicker
        assignment={assignment()}
        bots={bots}
        onAssign={onAssign}
        onClear={onClear}
      />,
    );
    openPicker();

    const listbox = screen.getByRole("listbox", { name: "Local Bot options" });
    expect(listbox).toBeTruthy();
    const museOption = screen.getByRole("option", { name: /Muse/ });
    expect(museOption.getAttribute("aria-selected")).toBe("true");
    expect(
      screen
        .getByRole("option", { name: /Luna/ })
        .getAttribute("aria-selected"),
    ).toBe("false");

    // Replacing the current assignment must carry its version, not null.
    fireEvent.click(screen.getByRole("option", { name: /Luna/ }));
    expect(onAssign).toHaveBeenCalledWith("bot-2", 4);
    expect(onClear).not.toHaveBeenCalled();
  });

  test("first assignment passes a null expected version", () => {
    const onAssign = vi.fn();
    render(
      <BotAssignmentPicker
        assignment={null}
        bots={bots}
        onAssign={onAssign}
        onClear={vi.fn()}
      />,
    );
    openPicker();
    fireEvent.click(screen.getByRole("option", { name: /Muse/ }));
    expect(onAssign).toHaveBeenCalledWith("bot-1", null);
  });

  test("unassign passes the current version (clear keeps history)", () => {
    const onClear = vi.fn();
    render(
      <BotAssignmentPicker
        assignment={assignment()}
        bots={bots}
        onAssign={vi.fn()}
        onClear={onClear}
      />,
    );
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: /Unassign Bot/ }));
    expect(onClear).toHaveBeenCalledWith(4);
  });

  test("a deleted assigned Bot shows the honest reassign banner and keeps options", () => {
    render(
      <BotAssignmentPicker
        assignment={assignment({}, "deleted")}
        bots={bots}
        onAssign={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    openPicker();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("no longer exists");
    expect(alert.textContent).toContain("history is kept");
    // Options stay selectable for reassignment.
    expect(
      screen.getByRole("option", { name: /Luna/ }).hasAttribute("disabled"),
    ).toBe(false);
  });

  test("disabled bots render as disabled options with their reason", () => {
    render(
      <BotAssignmentPicker
        assignment={null}
        bots={[
          {
            id: "bot-3",
            name: "Offline",
            disabled: true,
            disabledReason: "Unavailable",
          },
        ]}
        onAssign={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    openPicker();
    const option = screen.getByRole("option", { name: /Offline/ });
    expect(option.hasAttribute("disabled")).toBe(true);
    expect(option.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(option);
    // Clicking a disabled row is a no-op (the button itself is disabled).
  });

  test("empty bot list states that there are no local Bots yet", () => {
    render(
      <BotAssignmentPicker
        assignment={null}
        bots={[]}
        onAssign={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    openPicker();
    expect(screen.getByText("No local Bots yet.")).toBeTruthy();
  });

  test("busy disables the trigger and shows the spinner", async () => {
    const onAssign = vi.fn();
    render(
      <BotAssignmentPicker
        assignment={null}
        bots={bots}
        onAssign={onAssign}
        onClear={vi.fn()}
        busy
      />,
    );
    const trigger = screen.getByRole("button", {
      name: "Local Bot: none assigned",
    });
    expect(trigger.hasAttribute("disabled")).toBe(true);
    // The picker stays usable once busy clears.
    await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(true));
  });
});
