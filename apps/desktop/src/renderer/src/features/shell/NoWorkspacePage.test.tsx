// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NoWorkspacePage } from "./NoWorkspacePage";

afterEach(cleanup);
const base = { title: "Automations", description: "Schedule repeatable work for your workspaces.", onAddProject: vi.fn() };

describe("project-aware empty state", () => {
  it("offers project registration only when no projects exist", () => {
    render(<NoWorkspacePage {...base} projects={[]} onCreateWorkspace={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Add Project" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create workspace" })).toBeNull();
  });
  it("acknowledges the existing project and preselects it for creation", () => {
    const create = vi.fn();
    render(<NoWorkspacePage {...base} projects={[{ id: "p1", name: "Drogon" }]} onCreateWorkspace={create} />);
    expect(screen.getByText("Create a workspace in Drogon to get started.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add Project" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    expect(create).toHaveBeenCalledWith("p1");
  });
  it("does not silently pick a project when several exist", () => {
    const create = vi.fn();
    render(<NoWorkspacePage {...base} projects={[{ id: "p1", name: "One" }, { id: "p2", name: "Two" }]} onCreateWorkspace={create} />);
    expect(screen.getByText("Create a workspace in one of your projects to get started.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    expect(create).toHaveBeenCalledWith(null);
  });
  it("updates after a project is registered without remounting the page", () => {
    const props = { ...base, onCreateWorkspace: vi.fn() };
    const view = render(<NoWorkspacePage {...props} projects={[]} />);
    view.rerender(<NoWorkspacePage {...props} projects={[{ id: "p1", name: "Drogon" }]} />);
    expect(screen.queryByRole("button", { name: "Add Project" })).toBeNull();
    expect(screen.getByRole("button", { name: "Create workspace" })).toBeTruthy();
  });
});
