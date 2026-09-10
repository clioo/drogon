// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "../../components/ui/tooltip";
import { WorktreeCard } from "./WorktreeCard";
import { clearWorktreeAgentExpansionStateForTests } from "./worktree-card-agents-expansion-state";
import type { Session, Worktree } from "../../../../shared/session-contract";
import type { CardProperty } from "./workspace-options-state";
import { worktreeIssueLinkSchema, type WorktreeIssueLink } from "../../../../shared/worktree-issue-contract";

afterEach(() => {
  cleanup();
  clearWorktreeAgentExpansionStateForTests();
});
const worktree: Worktree = { id: "wt", projectId: "p", workspaceId: "ws", path: "/tmp/card", branch: "feature", head: "", baseRef: null, createdAt: "2026-09-01T00:00:00Z", note: "A real saved note" };
const session: Session = { id: "s", workspaceId: "ws", hostId: "h", incarnation: "1", command: "sh", args: [], cols: 80, rows: 24, verdict: "live", exitCode: null, createdAt: "2026-09-01T00:00:00Z", harnessId: null };
function card(properties: Partial<Record<CardProperty, boolean>>, overrides: Partial<Worktree> = {}, options: { sessions?: Session[]; agentActivityDisplayMode?: "compact" | "full"; issueLinks?: WorktreeIssueLink[]; onSelect?: (id: string) => void; onSelectSession?: (id: string) => void } = {}) {
  window.drogon ??= {} as typeof window.drogon;
  return render(<TooltipProvider><WorktreeCard worktree={{ ...worktree, ...overrides }}
    workspaces={[{ id: "ws", path: "/tmp/card", name: "Card", kind: "folder", hostId: "h" }]}
    sessions={options.sessions ?? [session]} agentActivityDisplayMode={options.agentActivityDisplayMode} selected disabled={false} projectKind="folder" implicitFolderWorktree
    onSelect={options.onSelect ?? (() => {})} onRemove={null} onRename={null} issueLinks={options.issueLinks} onSelectSession={options.onSelectSession}
    {...{ showProperties: properties }} />
  </TooltipProvider>);
}
test("the Notes property hides the actual persisted note without changing it", () => {
  const view = card({ comment: false, "inline-agents": true });
  expect(screen.queryByText("A real saved note")).toBeNull();
  expect(worktree.note).toBe("A real saved note");
  view.unmount();
  card({ comment: true, "inline-agents": true });
  expect(screen.getByText("A real saved note")).toBeTruthy();
});
test("Agent activity hides and restores the real session rows", () => {
  const view = card({ comment: true, "inline-agents": false });
  expect(view.container.querySelector('[data-worktree-agent-row="s"]')).toBeNull();
  view.unmount();
  const shown = card({ comment: true, "inline-agents": true });
  expect(shown.container.querySelector('[data-worktree-agent-row="s"]')).not.toBeNull();
});
test.each([["cli", "Drogon CLI"], ["automation", "Automation"]] as const)("%s provenance property renders persisted metadata only when checked", (creator, label) => {
  const view = card({ [creator]: true }, { creator });
  expect(screen.getByText(label)).toBeTruthy();
  view.unmount();
  card({ [creator]: false }, { creator });
  expect(screen.queryByText(label)).toBeNull();
});
test("issue actions are independent controls, not nested inside the workspace select button", () => {
  const openExternal = vi.fn().mockResolvedValue({ ok: true, result: { opened: true } });
  window.drogon = { shell: { openExternal } } as unknown as typeof window.drogon;
  const onSelect = vi.fn();
  const link = worktreeIssueLinkSchema.parse({ worktreeId: "wt", provider: "linear", identifier: "ENG-123", title: "Linked issue", url: "https://linear.app/team/issue/ENG-123" });
  card({}, {}, { issueLinks: [link], onSelect });
  const action = screen.getByRole("button", { name: "Open Linear ENG-123" });
  expect(action.parentElement?.closest("button")).toBeNull();
  fireEvent.click(action);
  expect(openExternal).toHaveBeenCalledWith(link.url);
  expect(onSelect).not.toHaveBeenCalled();
});
test("Compact activity counts roots, preserves child lineage and selects the child's actual session", () => {
  const child = { ...session, id: "child", parentSessionId: session.id };
  const first = card({}, {}, { agentActivityDisplayMode: "compact", sessions: [session, child, { ...session, id: "foreign", workspaceId: "elsewhere" }] });
  expect(screen.queryByRole("button", { name: /^Expand 2 agents/ })).toBeNull();
  expect(first.container.querySelector('.worktree-agent-lineage-children [data-worktree-agent-row="child"]')).not.toBeNull();
  expect(first.container.querySelector('[data-worktree-agent-row="foreign"]')).toBeNull();
  first.unmount();
  const selected: string[] = [];
  const view = card({}, {}, { agentActivityDisplayMode: "compact", sessions: [session, child, { ...session, id: "s2" }],
    onSelect: (id) => selected.push(`workspace:${id}`), onSelectSession: (id) => selected.push(`session:${id}`) });
  expect(view.container.querySelector('[data-worktree-agent-row="child"]')).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Expand 2 agents/ }));
  expect(view.container.querySelectorAll('[data-worktree-agent-row]')).toHaveLength(3);
  const childRow = view.container.querySelector('.worktree-agent-lineage-children [data-worktree-agent-row="child"]')!;
  fireEvent.click(childRow);
  expect(selected).toEqual(["workspace:ws", "session:child"]);
});
test("Compact activity summarizes multiple roots and expands the actual selectable rows", () => {
  const view = card({}, {}, { agentActivityDisplayMode: "compact", sessions: [session, { ...session, id: "s2" }] });
  expect(view.container.querySelector('[data-worktree-agent-row="s"]')).toBeNull();
  const toggle = screen.getByRole("button", { name: /^Expand 2 agents/ });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  expect(view.container.querySelectorAll('[data-worktree-agent-row]')).toHaveLength(2);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
});
