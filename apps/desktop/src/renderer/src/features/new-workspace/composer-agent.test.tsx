// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   #316: the composer's Agent combobox is the fork's quick-agent picker over
   the daemon's harness list — the stored default wins when available,
   otherwise the fork's auto-pick order fills in, "Blank Terminal" creates
   without a session, and "Manage agents" routes to agent settings. The
   fork's composer carries no model/provider text fields: model, effort and
   permission mode come from Settings → Agents (composerAgentLaunchInput,
   covered in composer-submit.test.ts), which keeps the #221 guarantee that
   no raw model string can reach the daemon from the composer. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import type { Harness, Project, Worktree } from "../../../../shared/session-contract";
import type { ProjectGroup } from "../shell/project-adapter";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { TooltipProvider } from "../../components/ui/tooltip";
import { NewWorkspaceComposer } from "./NewWorkspaceComposer";

installRadixJsdomStubs();
afterEach(cleanup);

const gitGroup: ProjectGroup = {
  project: {
    id: "git:1",
    hostId: "host",
    path: "/tmp/repo",
    name: "repo",
    kind: "git",
    defaultBaseRef: "main",
  } as Project,
  worktrees: [] as Worktree[],
};

function harness(harnessId: Harness["harnessId"], displayName: string): Harness {
  return {
    harnessId,
    displayName,
    availability: "available",
    executable: `/opt/${harnessId}`,
  };
}

function agentTrigger(): HTMLElement {
  const el = document.querySelector(
    '[data-agent-combobox-root="true"][role="combobox"]',
  );
  if (!el) throw new Error("agent combobox trigger not rendered");
  return el as HTMLElement;
}

function mount({
  harnesses = [harness("pi", "Pi"), harness("claude", "Claude Code")],
  defaultHarnessId = "",
  onOpenAgentSettings = vi.fn(),
}: Partial<{
  harnesses: Harness[];
  defaultHarnessId: string;
  onOpenAgentSettings: () => void;
}> = {}) {
  return render(
    <TooltipProvider>
      <NewWorkspaceComposer
      groups={[gitGroup]}
      workspaces={[]}
      projectId="git:1"
      disabled={false}
      nameInputRef={createRef<HTMLInputElement>()}
      composerRef={createRef<HTMLDivElement>()}
      harnesses={harnesses}
      defaultHarnessId={defaultHarnessId}
      harnessDefaults={{}}
      onProjectChange={() => {}}
      onSubmitWorktree={async () => null}
      onLaunchAgent={async () => null}
      onSelectWorkspace={() => {}}
      onAddProject={() => {}}
      onOpenAgentSettings={onOpenAgentSettings}
      onSetDefaultAgent={() => {}}
      onClose={() => {}}
      />
    </TooltipProvider>,
  );
}

describe("composer Agent combobox (#316 fork picker)", () => {
  test("the stored default is preselected when available", () => {
    mount({ defaultHarnessId: "pi" });
    // Why not by accessible name: role=combobox takes no name from content,
    // so the fork's trigger announces unlabelled, exactly as the reference
    // ARIA snapshot shows ("combobox:" with the agent as inner text).
    expect(agentTrigger().textContent).toBe("Pi");
  });

  test("without a default the fork's auto-pick order fills in (claude first)", () => {
    mount({});
    expect(agentTrigger().textContent).toBe("Claude Code");
  });

  test("an unavailable default falls back to the next available harness", () => {
    mount({
      harnesses: [
        { ...harness("claude", "Claude Code"), availability: "missing" },
        harness("pi", "Pi"),
      ],
      defaultHarnessId: "claude",
    });
    expect(agentTrigger().textContent).toBe("Pi");
  });

  test("the picker lists every available harness plus Blank Terminal", async () => {
    mount({});
    fireEvent.click(agentTrigger());
    expect(
      await screen.findByPlaceholderText("Search agents..."),
    ).toBeTruthy();
    expect(screen.getByText("Blank Terminal")).toBeTruthy();
    expect(screen.getByText("Manage agents")).toBeTruthy();
    // The unavailable harness is filtered out, like the fork's detected set.
    expect(screen.queryByText("Antigravity")).toBeNull();
  });

  test("Manage agents and the gear both route to agent settings", async () => {
    const onOpenAgentSettings = vi.fn();
    mount({ onOpenAgentSettings });
    fireEvent.click(screen.getByRole("button", { name: "Open agent settings" }));
    expect(onOpenAgentSettings).toHaveBeenCalledTimes(1);
    fireEvent.click(agentTrigger());
    fireEvent.click(await screen.findByText("Manage agents"));
    expect(onOpenAgentSettings).toHaveBeenCalledTimes(2);
  });

  test("no listed harnesses: Blank Terminal (no session) is the selection", async () => {
    mount({ harnesses: [] });
    expect(agentTrigger().textContent).toBe("Blank Terminal");
  });
});
