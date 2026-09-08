import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Tooltip } from "radix-ui";
import { ProjectList } from "./ProjectList";
import { EMPTY_TAB_STRIP_STATE } from "./tab-order";

function render(sidebarWidth = 280): string {
  return renderToString(
    createElement(
      Tooltip.Provider,
      null,
      createElement(ProjectList, {
        groups: [],
        workspaces: [],
        sessions: [],
        selectedWorkspaceId: "",
        activeSessionId: "",
        tabStrip: EMPTY_TAB_STRIP_STATE,
        onSelectSession: () => {},
        disabled: false,
        addDisabled: false,
        sidebarWidth,
        worktreesAvailable: true,
        action: null,
        onSelectWorkspace: () => {},
        onAddProject: () => {},
        onCreateWorkspace: () => {},
        onOpenAction: () => {},
        onCloseAction: () => {},
        onBrowse: async () => null,
        onSubmitAdd: async () => null,
        onSubmitRemove: async () => null,
        onSubmitRemoveProject: async () => null,
        onOpenProjectSettings: () => {},
        onSubmitRename: async () => null,
      }),
    ),
  );
}

describe("ProjectList header", () => {
  test("shows the source controls in the source order", () => {
    const html = render();
    const activity = html.indexOf('aria-label="View activity"');
    const options = html.indexOf('aria-label="Workspace options"');
    const create = html.indexOf('aria-label="New workspace"');
    expect(activity).toBeGreaterThan(-1);
    expect(options).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(-1);
    expect(activity).toBeLessThan(options);
    expect(options).toBeLessThan(create);
    expect(html).not.toContain("Add project");
    expect(html).not.toContain("Filter projects");
  });

  test("empty list uses the source copy", () => {
    const html = render();
    expect(html).toContain("No workspaces found");
    expect(html).not.toContain("Open a folder or repository to begin.");
  });

  test("narrow sidebar collapses to the overflow menu", () => {
    const html = render(220);
    expect(html).toContain('aria-label="More workspace actions"');
    expect(html).toContain('aria-label="New workspace"');
    expect(html).not.toContain('aria-label="Workspace options"');
  });
});
