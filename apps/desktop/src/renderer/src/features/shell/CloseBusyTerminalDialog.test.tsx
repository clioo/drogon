// @vitest-environment jsdom
// Issue #333: the busy-tab confirm renders the right copy per session kind,
// reports Don't-ask-again, and autofocuses the destructive confirm.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CloseBusyTerminalDialog } from "./CloseBusyTerminalDialog";

afterEach(cleanup);

describe("CloseBusyTerminalDialog", () => {
  it("renders the agent copy and confirms without don't-ask-again", async () => {
    const onConfirm = vi.fn();
    render(
      <CloseBusyTerminalDialog
        agent
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    await screen.findByText("Stop this agent?");
    fireEvent.click(screen.getByRole("button", { name: "Stop agent" }));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it("renders the command copy and reports don't-ask-again when checked", async () => {
    const onConfirm = vi.fn();
    render(
      <CloseBusyTerminalDialog
        agent={false}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    await screen.findByText("Stop running command?");
    fireEvent.click(screen.getByRole("checkbox", { name: /don't ask again/i }));
    fireEvent.click(screen.getByRole("button", { name: "Stop command" }));
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it("cancels without confirming", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <CloseBusyTerminalDialog
        agent={false}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("autofocuses the destructive confirm so Enter confirms", async () => {
    render(
      <CloseBusyTerminalDialog
        agent={false}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const confirm = await screen.findByRole("button", {
      name: "Stop command",
    });
    expect(document.activeElement).toBe(confirm);
  });
});
