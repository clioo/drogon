import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Landing } from "./Landing";

const actions = { onAddProject: () => {}, onCreateWorkspace: () => {} };
describe("landing registration state", () => {
  it("asks for a project only before registration", () => {
    expect(renderToString(<Landing {...actions} hasProjects={false} hasWorkspaces={false} />)).toContain("Add a project to get started.");
  });
  it("asks for workspace creation when only a project exists", () => {
    const html = renderToString(<Landing {...actions} hasProjects hasWorkspaces={false} />);
    expect(html).toContain("Create a workspace in one of your projects to get started.");
    expect(html).not.toContain("Select a workspace from the sidebar");
    expect(html).not.toContain("Add a project to get started.");
  });
  it("asks for selection when workspaces exist", () => {
    expect(renderToString(<Landing {...actions} hasProjects hasWorkspaces />)).toContain("Select a workspace from the sidebar to begin.");
  });
});
