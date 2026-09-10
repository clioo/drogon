// @vitest-environment jsdom
/* C04 editor interaction tests over the real component: empty, saving,
 * error and conflict states (acceptance case 6), scope/legacy badges,
 * and every mutation emitted as an explicit expected-version request. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BotMemoryEditor } from "./BotMemoryEditor";
import type { MemoryConflictState } from "./BotMemoryEditor";
import type { BotMemoryRecord } from "./bot-memory-draft";

afterEach(cleanup);

function record(overrides: Partial<BotMemoryRecord> = {}): BotMemoryRecord {
  return {
    id: "mem-1",
    botId: "bot-1",
    scope: "global",
    projectId: null,
    content: "Prefers terse replies.",
    version: 3,
    provenance: { origin: "user", requestId: "req-1" },
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function setup(overrides: Partial<Parameters<typeof BotMemoryEditor>[0]> = {}) {
  const onCreate = vi.fn();
  const onUpdate = vi.fn();
  const onDelete = vi.fn();
  const utils = render(
    <BotMemoryEditor
      botId="bot-1"
      memories={[record()]}
      projectId="proj-a"
      busy={false}
      error={null}
      conflict={null}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDelete={onDelete}
      {...overrides}
    />,
  );
  return { onCreate, onUpdate, onDelete, ...utils };
}

describe("BotMemoryEditor", () => {
  it("renders rows with explicit scope, legacy badge and visibility copy", () => {
    const { getByTestId } = setup({
      memories: [
        record(),
        record({
          id: "mem-2",
          scope: "project",
          projectId: "proj-a",
          provenance: { origin: "legacy-global" },
          content: "Ships on Fridays.",
        }),
      ],
    });
    const rows = screen.getAllByTestId("memory-row");
    expect(rows).toHaveLength(2);
    const globalRow = rows[0];
    const projectRow = rows[1];
    expect(globalRow.textContent).toContain("Global");
    expect(globalRow.textContent).toContain(
      "Visible to this Bot in every project.",
    );
    expect(projectRow.textContent).toContain("Project");
    expect(projectRow.textContent).toContain("Legacy global");
    expect(projectRow.textContent).toContain(
      "Visible to this Bot only in project proj-a.",
    );
    expect(getByTestId("bot-memory-editor")).toBeTruthy();
  });

  it("renders the empty state when the bot has no memories", () => {
    setup({ memories: [] });
    expect(screen.getByTestId("bot-memory-empty").textContent).toContain(
      "No memories yet.",
    );
  });

  it("submits a project-scoped create request with the current project", () => {
    const { onCreate } = setup();
    fireEvent.change(screen.getByTestId("memory-new-content"), {
      target: { value: "Guard the realm." },
    });
    fireEvent.click(screen.getByTestId("memory-add"));
    expect(onCreate).toHaveBeenCalledTimes(1);
    const request = onCreate.mock.calls[0][0];
    expect(request).toMatchObject({
      botId: "bot-1",
      scope: "project",
      projectId: "proj-a",
      content: "Guard the realm.",
    });
    expect(request.requestId).toBeTruthy();
  });

  it("offers global scope and strips projectId when the scope is global", () => {
    const { onCreate } = setup();
    fireEvent.change(screen.getByTestId("memory-new-content"), {
      target: { value: "Always terse." },
    });
    fireEvent.change(screen.getByTestId("memory-scope-select"), {
      target: { value: "global" },
    });
    fireEvent.click(screen.getByTestId("memory-add"));
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      scope: "global",
      projectId: null,
    });
  });

  it("omits the scope select without a project context", () => {
    setup({ projectId: null });
    expect(screen.queryByTestId("memory-scope-select")).toBeNull();
  });

  it("blocks empty submissions instead of firing an invalid request", () => {
    const { onCreate } = setup({ memories: [] });
    const add = screen.getByTestId("memory-add") as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.click(add);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("submits edits with the record's version as expectedVersion", () => {
    const { onUpdate } = setup();
    fireEvent.click(screen.getByLabelText("Edit memory mem-1"));
    fireEvent.change(screen.getByLabelText("Edit memory content"), {
      target: { value: "Edited fact." },
    });
    fireEvent.click(screen.getByTestId("memory-edit-save"));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0]).toMatchObject({
      botId: "bot-1",
      memoryId: "mem-1",
      expectedVersion: 3,
      content: "Edited fact.",
    });
  });

  it("submits deletes with the record's version as expectedVersion", () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByLabelText("Delete memory mem-1"));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0][0]).toMatchObject({
      memoryId: "mem-1",
      expectedVersion: 3,
    });
  });

  it("shows the saving state and disables controls while busy", () => {
    setup({
      busy: true,
      memories: [record()],
    });
    expect(screen.getByText("Adding…")).toBeTruthy();
    expect(
      (screen.getByTestId("memory-new-content") as HTMLTextAreaElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("memory-add") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Edit memory mem-1") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Delete memory mem-1") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("renders the error alert", () => {
    setup({ error: "Memory store unavailable." });
    const alert = screen.getByTestId("bot-memory-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("Memory store unavailable.");
  });

  it("renders the structured conflict with both versions and dismisses it", () => {
    const onDismissConflict = vi.fn();
    const conflict: MemoryConflictState = {
      expectedVersion: 3,
      currentVersion: 5,
      memoryId: "mem-1",
    };
    setup({ conflict, onDismissConflict });
    const banner = screen.getByTestId("bot-memory-conflict");
    expect(banner.getAttribute("role")).toBe("alert");
    expect(banner.textContent).toContain("you expected version 3");
    expect(banner.textContent).toContain("now version 5");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onDismissConflict).toHaveBeenCalledTimes(1);
  });
});
