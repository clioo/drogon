// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Sidebar Tasks nav chips (#346):
   the ported SidebarTaskNavButton — row active state/aria, hover-revealed
   provider chips gated on the availability probes, exact aria-labels, and
   click → source request + route. */

import { afterEach, describe, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { TooltipProvider } from "../../components/ui/tooltip";
import { SidebarTaskNavButton } from "./SidebarTaskNavButton";
import {
  consumePendingTaskSource,
  resetTaskSourceNavigation,
} from "../tasks/task-source-navigation";

afterEach(() => {
  cleanup();
  resetTaskSourceNavigation();
});

const probe = (available: boolean) => () => Promise.resolve(available);

function renderButton({
  active = false,
  onOpenTasks = () => {},
  github = true,
  jira = false,
}: {
  active?: boolean;
  onOpenTasks?: () => void;
  github?: boolean;
  jira?: boolean;
} = {}) {
  return render(
    <TooltipProvider>
      <SidebarTaskNavButton
        active={active}
        onOpenTasks={onOpenTasks}
        probeGitHubTasksAvailable={probe(github)}
        probeJiraTasksAvailable={probe(jira)}
      />
    </TooltipProvider>,
  );
}

describe("SidebarTaskNavButton row", () => {
  test("renders the Tasks row with the tour target and routes on click", () => {
    const onOpenTasks = vi.fn();
    renderButton({ onOpenTasks });
    const row = screen.getByRole("button", { name: "Tasks" });
    expect(row.getAttribute("data-contextual-tour-target")).toBe(
      "sidebar-tasks",
    );
    expect(row.getAttribute("aria-current")).toBeNull();
    fireEvent.click(row);
    expect(onOpenTasks).toHaveBeenCalledTimes(1);
  });

  test("marks the row as current when the Tasks route is active", () => {
    renderButton({ active: true });
    expect(
      screen
        .getByRole("button", { name: "Tasks" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });
});

describe("SidebarTaskNavButton provider chips", () => {
  test("renders the GitHub chip once the gh probe resolves available", async () => {
    renderButton({ github: true });
    const chip = await screen.findByRole("button", {
      name: "Open GitHub tasks",
    });
    expect(chip.getAttribute("aria-label")).toBe("Open GitHub tasks");
  });

  test("renders the Jira chip only when a site is connected", async () => {
    renderButton({ github: false, jira: true });
    await screen.findByRole("button", { name: "Open Jira tasks" });
    expect(
      screen.queryByRole("button", { name: "Open GitHub tasks" }),
    ).toBeNull();
  });

  test("renders no chips while no integration is available", async () => {
    renderButton({ github: false, jira: false });
    // Probes resolve on a microtask; let them settle before asserting absence.
    await act(() => Promise.resolve());
    expect(
      screen.queryByRole("button", { name: "Open GitHub tasks" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Open Jira tasks" }),
    ).toBeNull();
    // The row itself is always there.
    expect(screen.getByRole("button", { name: "Tasks" })).not.toBeNull();
  });

  test("keeps chips focus-reachable inside the row group", async () => {
    const { container } = renderButton({ github: true });
    await screen.findByRole("button", { name: "Open GitHub tasks" });
    const group = container.querySelector(".group.relative");
    expect(group).not.toBeNull();
    expect(
      group?.querySelector("[class*='can-hover:opacity-0']"),
    ).not.toBeNull();
    expect(
      group?.querySelector(
        "[class*='can-hover:group-focus-within:opacity-100']",
      ),
    ).not.toBeNull();
  });

  test("chip click parks the source request and routes", async () => {
    const onOpenTasks = vi.fn();
    renderButton({ onOpenTasks, github: true, jira: true });
    fireEvent.click(
      await screen.findByRole("button", { name: "Open GitHub tasks" }),
    );
    expect(onOpenTasks).toHaveBeenCalledTimes(1);
    expect(consumePendingTaskSource()).toBe("github");
    fireEvent.click(screen.getByRole("button", { name: "Open Jira tasks" }));
    expect(onOpenTasks).toHaveBeenCalledTimes(2);
    expect(consumePendingTaskSource()).toBe("jira");
  });

  test("gitlab and linear chips stay dark without an integration", async () => {
    renderButton({
      github: true,
      jira: true,
    });
    await screen.findByRole("button", { name: "Open GitHub tasks" });
    expect(
      screen.queryByRole("button", { name: "Open GitLab tasks" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Open Linear tasks" }),
    ).toBeNull();
  });
});
