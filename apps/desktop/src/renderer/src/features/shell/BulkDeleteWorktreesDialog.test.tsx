// @vitest-environment jsdom
// The bulk confirm's Force option. It passes one `force` to every removal in
// the run, and since #621 a forced removal also stops the terminals running
// in each workspace — so the row has to say so before someone ticks it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BulkDeleteWorktreesDialog } from "./BulkDeleteWorktreesDialog";
import type { Worktree } from "../../../../shared/session-contract";

afterEach(cleanup);

function target(id: string) {
  return {
    worktree: { id, projectId: "p1", workspaceId: `ws-${id}` } as Worktree,
    name: id,
    protectedFromDelete: false,
  };
}

describe("BulkDeleteWorktreesDialog force option", () => {
  it("says force also stops running terminals, and sends it with every removal", async () => {
    const onSubmit = vi.fn(
      async (_worktree: Worktree, _force: boolean): Promise<string | null> =>
        null,
    );
    render(
      <BulkDeleteWorktreesDialog
        targets={[target("one"), target("two")]}
        disabled={false}
        onSubmit={onSubmit}
        onDeleted={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const force = screen.getByRole("checkbox");
    expect(force.closest("label")?.textContent).toContain("running terminals");

    fireEvent.click(force);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Delete 2 workspaces/ }));
    });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(
      onSubmit.mock.calls.every(([, forced]) => forced === true),
    ).toBe(true);
  });
});
