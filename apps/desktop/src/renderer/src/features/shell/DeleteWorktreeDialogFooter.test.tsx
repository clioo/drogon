// @vitest-environment jsdom
// The footer of a destructive confirm, inside a <form>. A bare <button>
// defaults to type="submit" there, which made every Delete click run its own
// onClick *and* the form's onSubmit — two `worktree.remove` calls — and made
// Cancel submit the delete it exists to decline (issue #621).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DeleteWorktreeDialogFooter } from "./DeleteWorktreeDialogFooter";

afterEach(cleanup);

function renderFooter(overrides?: {
  onCancel?: () => void;
  onDelete?: () => void;
  isDeleting?: boolean;
}) {
  const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const onCancel = overrides?.onCancel ?? vi.fn();
  const onDelete = overrides?.onDelete ?? vi.fn();
  render(
    <form onSubmit={onSubmit}>
      <DeleteWorktreeDialogFooter
        isDeleting={overrides?.isDeleting ?? false}
        onCancel={onCancel}
        onDelete={onDelete}
        confirmButtonRef={null}
      />
    </form>,
  );
  return { onSubmit, onCancel, onDelete };
}

describe("DeleteWorktreeDialogFooter", () => {
  it("confirms once per click instead of submitting the form as well", () => {
    const { onSubmit, onDelete } = renderFooter();
    fireEvent.click(screen.getByRole("button", { name: "Delete Workspace" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("cancels without submitting the delete", () => {
    const { onSubmit, onCancel, onDelete } = renderFooter();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("locks both rows while a delete is in flight", () => {
    renderFooter({ isDeleting: true });
    expect(
      (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Deleting...",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
