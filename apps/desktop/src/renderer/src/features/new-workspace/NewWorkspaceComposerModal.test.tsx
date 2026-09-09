// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/NewWorkspaceComposerModal.tsx effect (#355):
   the modal can mount before the project view answers — the stale
   initializer would keep the combobox empty even though the entry point
   passed a preselect (Landing → Create workspace on a fresh boot). The
   fork adopts the initial project once its group lands; so must this. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createRef, type ReactElement } from "react";
import type {
  Harness,
  Project,
  Worktree,
  Workspace,
} from "../../../../shared/session-contract";
import type { ProjectGroup } from "../shell/project-adapter";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { TooltipProvider } from "../../components/ui/tooltip";
import { NewWorkspaceComposerModal } from "./NewWorkspaceComposerModal";

installRadixJsdomStubs();
afterEach(cleanup);

function gitGroup(): ProjectGroup {
  return {
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
}

function modalElement(
  overrides: Partial<Parameters<typeof NewWorkspaceComposerModal>[0]> = {},
): ReactElement {
  const {
    groups = [gitGroup()],
    workspaces = [] as Workspace[],
    initialProjectId = null,
    harnesses = [] as Harness[],
    ...rest
  } = overrides;
  return (
    <TooltipProvider>
      <NewWorkspaceComposerModal
        groups={groups}
        workspaces={workspaces}
        initialProjectId={initialProjectId}
        disabled={false}
        harnesses={harnesses}
        defaultHarnessId=""
        harnessDefaults={{}}
        onSubmitWorktree={async () => null}
        onLaunchAgent={async () => null}
        onSelectWorkspace={() => {}}
        onAddProject={() => {}}
        onOpenAgentSettings={() => {}}
        onSetDefaultAgent={() => {}}
        onClose={() => {}}
        {...rest}
      />
    </TooltipProvider>
  );
}

function projectComboboxRoot(): HTMLElement {
  const el = document.querySelector('[data-project-combobox-root="true"]');
  if (!el) throw new Error("project combobox not rendered");
  return el as HTMLElement;
}

describe("NewWorkspaceComposerModal initial project (#355)", () => {
  test("a preselect whose group lands late is adopted without a user click", () => {
    const view = render(
      modalElement({ groups: [], initialProjectId: "git:1" }),
    );
    // The project view has not answered: nothing to select yet.
    expect(projectComboboxRoot().textContent ?? "").not.toContain("repo");
    view.rerender(modalElement({ groups: [gitGroup()], initialProjectId: "git:1" }));
    expect(projectComboboxRoot().textContent ?? "").toContain("repo");
  });

  test("opening without a preselect does not auto-pick a lone late group", () => {
    const view = render(modalElement({ groups: [] }));
    view.rerender(modalElement({ groups: [gitGroup()] }));
    // Fork parity: only an explicit preselect is adopted; the composer's
    // own empty-state default stays untouched.
    expect(projectComboboxRoot().textContent ?? "").not.toContain("repo");
  });

  test("a preselect that never matches a group leaves the combobox empty", () => {
    const other = gitGroup();
    other.project = { ...other.project, id: "git:2", name: "other" };
    const view = render(
      modalElement({ groups: [], initialProjectId: "git:1" }),
    );
    view.rerender(modalElement({ groups: [other], initialProjectId: "git:1" }));
    expect(projectComboboxRoot().textContent ?? "").not.toContain("repo");
    expect(projectComboboxRoot().textContent ?? "").not.toContain("other");
  });
});
