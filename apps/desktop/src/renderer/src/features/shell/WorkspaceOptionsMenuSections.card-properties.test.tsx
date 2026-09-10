// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Source map: sidebar/worktree-card-display-property-options.ts (all eight
   properties), WorktreeCardDisplayMenuSection.tsx (activity display), and
   shared/worktree/card-properties.test.ts (quiet Compact preset).
   The unchanged seven pure source assertions also run in the pinned capsule. */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DropdownMenu, DropdownMenuContent } from "../../components/ui/dropdown-menu";
import { WorkspaceOptionsMenuSections } from "./WorkspaceOptionsMenuSections";
import { DEFAULT_WORKSPACE_OPTIONS_STATE } from "./workspace-options-state";

afterEach(cleanup);
function open(state = DEFAULT_WORKSPACE_OPTIONS_STATE) {
  const change = vi.fn();
  render(<DropdownMenu open><DropdownMenuContent>
    <WorkspaceOptionsMenuSections state={state} onChange={change} />
  </DropdownMenuContent></DropdownMenu>);
  return change;
}

test.each(["GitHub ticket", "Linear issue", "Jira issue", "PR/MR link", "Automation", "Notes", "Ports", "Agent activity"])("exposes the source %s property as a real checkbox", (name) => {
  const change = open();
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name }));
  expect(change).toHaveBeenCalledTimes(1);
  expect(change.mock.calls[0][0]).not.toEqual(DEFAULT_WORKSPACE_OPTIONS_STATE);
});

test("Compact applies the source quiet metadata preset, not just CSS density", () => {
  const change = open();
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Compact" }));
  expect(change).toHaveBeenCalledTimes(1);
  expect(change.mock.calls[0][0].showProperties.pr).toBe(false);
  expect(change.mock.calls[0][0].showProperties.branch).toBe(false);
});

test("exposes the source Full list activity mode", () => {
  const change = open({ ...DEFAULT_WORKSPACE_OPTIONS_STATE, agentActivityDisplayMode: "compact" });
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Full list" }));
  expect(change.mock.calls[0][0].agentActivityDisplayMode).toBe("full");
});
