// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   #221: the composer's Model field maps through the fork's Pi semantics
   before any RPC (flags string and provider/model reach harness.start
   mapped, never raw), an unmappable value blocks with the fork's error,
   and a failed submit retries with the same inputs. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import type {
  Harness,
  Project,
  Workspace,
  Worktree,
} from "../../../../shared/session-contract";
import type { ProjectGroup } from "../shell/project-adapter";
import { PI_MODEL_ERROR, PI_MODEL_EXAMPLE } from "../shell/pi-model-mapping";
import { NewWorkspaceComposer } from "./NewWorkspaceComposer";
import type { ComposerAgentSelection } from "./composer-submit";

afterEach(cleanup);

const project: Project = {
  id: "git:1",
  hostId: "host",
  path: "/tmp/repo",
  name: "repo",
  kind: "git",
  defaultBaseRef: "main",
};

const groups: ProjectGroup[] = [{ project, worktrees: [] as Worktree[] }];
const workspaces: Workspace[] = [];
const harnesses: Harness[] = [
  { harnessId: "pi", displayName: "Pi", availability: "available", executable: "/opt/pi" },
];

function mount({
  onSubmitWorktree = async () => null,
  onLaunchAgent = async () => null,
}: {
  onSubmitWorktree?: (input: {
    projectId: string;
    name: string;
    baseRef?: string;
    agent: ComposerAgentSelection;
  }) => Promise<string | null>;
  onLaunchAgent?: (launch: unknown) => Promise<string | null>;
}) {
  return render(
    <NewWorkspaceComposer
      groups={groups}
      workspaces={workspaces}
      projectId="git:1"
      disabled={false}
      nameInputRef={createRef<HTMLInputElement>()}
      harnesses={harnesses}
      defaultHarnessId="pi"
      onProjectChange={() => {}}
      onSubmitWorktree={onSubmitWorktree}
      onLaunchAgent={onLaunchAgent as never}
      onSelectWorkspace={() => {}}
      onAddProject={() => {}}
      onClose={() => {}}
    />,
  );
}

function fillName(value: string): void {
  fireEvent.change(screen.getByLabelText(/Branch name/), {
    target: { value },
  });
}

function fillModel(value: string): void {
  fireEvent.change(screen.getByLabelText(/Model/), { target: { value } });
}

function submit(): void {
  fireEvent.click(
    screen.getByRole("button", { name: /Create worktree/ }),
  );
}

describe("composer Model field (#221)", () => {
  test("the Pi helper shows the fork's copy with the documented example", () => {
    mount({});
    expect(document.body.textContent).toContain(PI_MODEL_EXAMPLE);
    expect(document.body.textContent).toContain(
      "Use an exact Pi provider/model ID",
    );
  });

  test("a pasted flags string reaches submit mapped, never raw", async () => {
    const onSubmitWorktree = vi.fn(async () => null);
    mount({ onSubmitWorktree });
    fillName("demo-a");
    fillModel("--provider dgx-spark --model qwen3.8-flash-next-nvidia-nvfp4");
    submit();
    await vi.waitFor(() => {
      expect(onSubmitWorktree).toHaveBeenCalledTimes(1);
    });
    expect(onSubmitWorktree).toHaveBeenCalledWith({
      projectId: "git:1",
      name: "demo-a",
      baseRef: "main",
      agent: {
        harnessId: "pi",
        model: "qwen3.8-flash-next-nvidia-nvfp4",
        provider: "dgx-spark",
      },
    });
  });

  test("an unmappable model blocks with the fork's error and no RPC", () => {
    const onSubmitWorktree = vi.fn(async () => null);
    mount({ onSubmitWorktree });
    fillName("demo-a");
    fillModel("has spaces");
    submit();
    expect(onSubmitWorktree).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(PI_MODEL_ERROR);
  });

  test("a failed submit keeps its inputs so retry resubmits identically", async () => {
    const onSubmitWorktree = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce("boom")
      .mockResolvedValueOnce(null);
    mount({ onSubmitWorktree });
    fillName("demo-a");
    fillModel(PI_MODEL_EXAMPLE);
    submit();
    await vi.waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("boom");
    });
    // The typed name and model survive the failure.
    expect(
      (screen.getByLabelText(/Branch name/) as HTMLInputElement).value,
    ).toBe("demo-a");
    submit();
    await vi.waitFor(() => {
      expect(onSubmitWorktree).toHaveBeenCalledTimes(2);
    });
    expect(onSubmitWorktree.mock.calls[0]).toEqual(
      onSubmitWorktree.mock.calls[1],
    );
  });
});
