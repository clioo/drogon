// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BotDeliveryStatus } from "./BotDeliveryStatus";
import type { DeliveryView } from "./bot-conversation-state";

afterEach(cleanup);

function delivery(overrides: Partial<DeliveryView> = {}): DeliveryView {
  return {
    id: "del-1",
    conversationId: "bot-1:proj-a",
    runId: "req-1",
    state: "pending",
    attempts: 0,
    updatedAt: 1,
    ...overrides,
  };
}

describe("BotDeliveryStatus", () => {
  it("renders pending without recovery controls", () => {
    render(<BotDeliveryStatus delivery={delivery()} />);
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getByText(/Waiting to send/)).toBeTruthy();
    expect(
      screen.queryByTestId("delivery-retry-del-1"),
    ).toBeNull();
  });

  it("renders uncertain with reconciliation controls and no blind retry", () => {
    const onReconcile = vi.fn();
    render(
      <BotDeliveryStatus
        delivery={delivery({ state: "uncertain", attempts: 1 })}
        onReconcile={onReconcile}
      />,
    );
    expect(screen.getByText(/Uncertain/)).toBeTruthy();
    expect(screen.getByText(/not resent/)).toBeTruthy();
    const accepted = screen.getByTestId("delivery-reconcile-accepted-del-1");
    fireEvent.click(accepted);
    expect(onReconcile).toHaveBeenCalledWith("del-1", true);
    const refused = screen.getByTestId("delivery-reconcile-refused-del-1");
    fireEvent.click(refused);
    expect(onReconcile).toHaveBeenCalledWith("del-1", false);
    expect(screen.queryByTestId("delivery-retry-del-1")).toBeNull();
  });

  it("renders delivered as terminal", () => {
    render(<BotDeliveryStatus delivery={delivery({ state: "delivered" })} />);
    expect(screen.getByText("Delivered")).toBeTruthy();
    expect(screen.getByText(/acknowledged/)).toBeTruthy();
  });

  it("renders failed with an explicit approved retry", () => {
    const onRetry = vi.fn();
    render(
      <BotDeliveryStatus
        delivery={delivery({ state: "failed", lastError: "refused" })}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByText("refused")).toBeTruthy();
    const retry = screen.getByTestId("delivery-retry-del-1");
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledWith("del-1");
  });
});
