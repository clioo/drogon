// @vitest-environment jsdom
// #270 regression: the Tasks page's Close button and Escape must invoke the
// host's onClose on the workspace-scoped mount too. The page used to receive
// `onClose: undefined` through the registered route descriptor, so both
// affordances were inert whenever a workspace was selected (the no-workspace
// direct mount passed the handler and worked).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Tooltip } from "radix-ui";
import type { TasksBridge } from "../../../../shared/tasks-contract";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { createTasksPanelDescriptor, TasksPage } from "./TasksPage";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

/** Fail-closed stub: every RPC answers unsupported, like a gated bridge. */
const refusedBridge = (code = "unsupported_capability"): TasksBridge =>
  ({
    tasksList: () => refused(code),
    tasksShow: () => refused(code),
    tasksStart: () => refused(code),
    tasksLinks: () => refused(code),
    tasksRemotes: () => refused(code),
    tasksProjects: () => refused(code),
    tasksWorktrees: () => refused(code),
  }) as unknown as TasksBridge;

function refused(code: string) {
  return Promise.resolve({
    ok: false as const,
    error: { code, message: code, retryable: true },
  });
}

function renderPage(onClose: () => void) {
  return render(
    <Tooltip.Provider>
      <div data-testid="tasks-page-host">
        <TasksPage
          bridge={refusedBridge()}
          loadGroups={() => []}
          onOpenTerminal={() => {}}
          onClose={onClose}
        />
      </div>
    </Tooltip.Provider>,
  );
}

describe("TasksPage close wiring (#270)", () => {
  it("the Close tasks button invokes the host onClose", async () => {
    const onClose = vi.fn();
    renderPage(onClose);
    const button = await screen.findByRole("button", { name: "Close tasks" });
    fireEvent.click(button);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape closes the page with focus outside it (window capture)", async () => {
    const onClose = vi.fn();
    renderPage(onClose);
    await screen.findByRole("button", { name: "Close tasks" });
    // The fork's global effect: after opening the page from the sidebar,
    // focus sits on the nav button — Escape must still close the page.
    // (Real keydowns target the focused element; body mirrors that.)
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape with focus on an input blurs first instead of closing", async () => {
    const onClose = vi.fn();
    renderPage(onClose);
    await screen.findByRole("button", { name: "Close tasks" });
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    input.remove();
  });

  it("Escape is ignored while the keep-alive host is hidden", async () => {
    const onClose = vi.fn();
    renderPage(onClose);
    await screen.findByRole("button", { name: "Close tasks" });
    // App keeps the page mounted (display:none) behind other routes; the
    // Chromium visibility check must then leave Escape to the active page.
    const host = document.querySelector('[data-testid="tasks-page-host"]');
    assert(host instanceof HTMLElement);
    host.checkVisibility = () => false;
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    host.checkVisibility = () => true;
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the registered route descriptor forwards the host onClose", async () => {
    // The workspace-scoped mount renders descriptor.component via
    // MountedPanel; the closed-over host is the only onClose source there.
    const onClose = vi.fn();
    const descriptor = createTasksPanelDescriptor({
      bridge: refusedBridge(),
      loadGroups: () => [],
      onOpenTerminal: () => {},
      onClose,
    });
    render(
      <Tooltip.Provider>
        <div data-testid="tasks-page-host">
          {descriptor.component({
            routeId: descriptor.id,
            session: null,
            workspace: { id: "ws", path: "/tmp/ws", name: "ws" },
            status: { hostId: "host" },
            focusTarget: null,
          })}
        </div>
      </Tooltip.Provider>,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Close tasks" }),
      ).not.toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close tasks" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
