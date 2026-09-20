// @vitest-environment jsdom
// Issue #621: the daemon refuses to delete a Workspace whose terminals it
// has not settled. This is the dialog's half of that contract — the refusal
// has to reach the user as the unstopped-pty toast, and its Force Delete
// button has to re-submit the removal with force, not re-send the same
// unforced call the daemon just declined.
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { toast } from "sonner";
import type { Workspace, Worktree } from "../../../../shared/session-contract";

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));

// Worker-reuse hermeticity (docs/reference/desktop-test-isolation.md): the
// desktop suite shares one module registry per worker, so a statically
// imported dialog would stay bound to whichever file's `sonner` won the
// import race — the real one (DaemonUpdateBanner renders a live <Toaster/>)
// or a sibling's warning-only mock, both of which leave this file's
// `info`/`error` mocks at zero calls (observed as four 15s toast waits on
// windows-compilation). Rebinding after a registry reset keeps the recovery
// assertions below deterministic under any file order.
let DeleteWorktreeDialog: typeof import("./DeleteWorktreeDialog").DeleteWorktreeDialog;
let info = vi.mocked(toast.info);
let error = vi.mocked(toast.error);

beforeAll(async () => {
  vi.resetModules();
  ({ DeleteWorktreeDialog } = await import("./DeleteWorktreeDialog"));
  const fresh = await import("sonner");
  info = vi.mocked(fresh.toast.info);
  error = vi.mocked(fresh.toast.error);
});

afterAll(() => {
  vi.resetModules();
});

/** The full suite runs these renders well past the 1s default. */
const WAIT = { timeout: 15_000 } as const;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** The literals `workspace_session_settle.rs` builds. */
const DAEMON_PROVEN_LIVE =
  "This workspace still has running terminals, so nothing was deleted — still live: ses_1. Delete with force to stop them first.";
const DAEMON_UNVERIFIABLE =
  "Drogon could not confirm every terminal in this workspace has exited, so nothing was deleted: ses_ghost. Force cannot settle a terminal Drogon has lost contact with — close those terminals, then delete again.";

const worktree: Worktree = {
  id: "wt1",
  projectId: "p1",
  workspaceId: "ws1",
  path: "/tmp/folder-project",
  branch: "",
  head: "",
  baseRef: null,
  createdAt: new Date(0).toISOString(),
};
// Folder workspaces skip the git-status bridge, so no window.drogon mock
// is needed to render this variant.
const workspaces = [{ id: "ws1", name: "folder-proj" } as Workspace];

function renderDialog(onSubmit: (force: boolean) => Promise<string | null>) {
  render(
    <DeleteWorktreeDialog
      worktree={worktree}
      workspaces={workspaces}
      disabled={false}
      isFolderWorkspaceDelete
      onSubmit={onSubmit}
      onClose={vi.fn()}
    />,
  );
}

async function clickDelete(): Promise<void> {
  // `findBy*` defaults to a 1s budget, which the full suite can exceed on a
  // loaded machine long before anything is actually wrong.
  const confirm = await screen.findByRole(
    "button",
    { name: "Delete Workspace" },
    WAIT,
  );
  await act(async () => {
    fireEvent.click(confirm);
  });
}

/**
 * The toast body is a React element handed to sonner, so the assertions
 * render it themselves and query inside that container only — never
 * `screen`, which would still see an earlier toast's buttons.
 */
function lastToastBody(mock: typeof info): HTMLElement {
  const options = mock.mock.calls.at(-1)?.[1] as
    | { description?: React.ReactNode }
    | undefined;
  return render(<>{options?.description}</>).container;
}

describe("the force option", () => {
  it("says it also removes workspaces with running terminals", () => {
    // A git workspace, so the option renders: since #621 force is what
    // stops the terminals, and the row has to say so before it is ticked.
    render(
      <DeleteWorktreeDialog
        worktree={worktree}
        workspaces={workspaces}
        disabled={false}
        isFolderWorkspaceDelete={false}
        onSubmit={async () => null}
        onClose={vi.fn()}
      />,
    );
    const label = screen.getByLabelText(/Force:/);
    expect(label.closest("label")?.textContent).toContain("running");
    expect(label.closest("label")?.textContent).toContain("terminals");
  });
});

describe("delete workspace force recovery", () => {
  it("turns the daemon's live-terminal refusal into a Force Delete that forces", async () => {
    const attempts: boolean[] = [];
    const onSubmit = vi.fn(async (force: boolean) => {
      attempts.push(force);
      return force ? null : DAEMON_PROVEN_LIVE;
    });
    renderDialog(onSubmit);
    await clickDelete();

    await waitFor(() => expect(info).toHaveBeenCalledTimes(1), WAIT);
    expect(info.mock.calls[0][0]).toBe("Failed to delete workspace folder-proj");
    const body = lastToastBody(info);
    expect(body.textContent).toContain("still has running terminals");
    const recovery = within(body).getByRole("button", {
      name: "Force Delete",
    });

    await act(async () => {
      fireEvent.click(recovery);
    });

    await waitFor(() => expect(attempts).toEqual([false, true]), WAIT);
    expect(info).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("does not point an already-forced failure back at Force Delete", async () => {
    const onSubmit = vi.fn(async () => DAEMON_PROVEN_LIVE);
    renderDialog(onSubmit);
    await clickDelete();

    await waitFor(() => expect(info).toHaveBeenCalledTimes(1), WAIT);
    // Rendered outside `act`: React 19 only commits when the act scope
    // exits, so a render inside it has no DOM to query yet.
    const recovery = within(lastToastBody(info)).getByRole("button", {
      name: "Force Delete",
    });
    await act(async () => {
      fireEvent.click(recovery);
    });

    // The forced retry failed too: the recovery is spent, so the second
    // toast states the failure instead of sending the user back to a
    // button they already pressed.
    await waitFor(() => expect(error).toHaveBeenCalledTimes(1), WAIT);
    expect(
      within(lastToastBody(error)).queryByRole("button", {
        name: "Force Delete",
      }),
    ).toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenLastCalledWith(true);
  });

  // A bare <button> inside the dialog's <form> defaults to type="submit", so
  // before #621 every confirm click ran onClick *and* the form's onSubmit.
  it("sends exactly one removal per confirm click", async () => {
    const onSubmit = vi.fn(async () => null);
    renderDialog(onSubmit);
    await clickDelete();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), WAIT);
    expect(onSubmit).toHaveBeenCalledWith(false);
    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("cancels without submitting the delete it declines", async () => {
    const onSubmit = vi.fn(async () => null);
    const onClose = vi.fn();
    render(
      <DeleteWorktreeDialog
        worktree={worktree}
        workspaces={workspaces}
        disabled={false}
        isFolderWorkspaceDelete
        onSubmit={onSubmit}
        onClose={onClose}
      />,
    );
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: "Cancel" }, WAIT),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("explains a lost-contact refusal without offering a force that cannot help", async () => {
    const onSubmit = vi.fn(async () => DAEMON_UNVERIFIABLE);
    renderDialog(onSubmit);
    await clickDelete();

    await waitFor(() => expect(info).toHaveBeenCalledTimes(1), WAIT);
    const body = lastToastBody(info);
    expect(body.textContent).toContain("could not confirm every terminal");
    expect(
      within(body).queryByRole("button", { name: "Force Delete" }),
    ).toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("leaves an ordinary failure on the plain destructive toast", async () => {
    const onSubmit = vi.fn(async () => "fatal: could not read the index");
    renderDialog(onSubmit);
    await clickDelete();

    await waitFor(() => expect(error).toHaveBeenCalledTimes(1), WAIT);
    expect(info).not.toHaveBeenCalled();
    expect(
      within(lastToastBody(error)).queryByRole("button", {
        name: "Force Delete",
      }),
    ).toBeNull();
  });
});
