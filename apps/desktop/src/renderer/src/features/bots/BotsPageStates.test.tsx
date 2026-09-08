// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/bots/BotsPage.test.tsx (adapters: this repo's
   page owns no store and loads its snapshot through the caller, so the
   page-level cases are ported here against the state components directly —
   actionable empty state, recoverable error state — plus the loading
   skeleton the list region shows while a refresh is in flight). */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  BotLoadingState,
  BotsEmptyState,
  BotsErrorState,
} from "./BotsPageStates";

afterEach(cleanup);

describe("BotsPageStates", () => {
  it("renders an actionable empty state", () => {
    const onCreate = vi.fn();
    render(<BotsEmptyState onCreate={onCreate} />);
    expect(screen.getByText("No Bots yet")).toBeTruthy();
    expect(
      screen.getByText(
        "Give a character a purpose. Its identity and memory stay with you across sessions.",
      ),
    ).toBeTruthy();
    const create = screen.getByRole("button", { name: "Create Bot" });
    expect(create).toBeTruthy();
    fireEvent.click(create);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("renders a recoverable error state", () => {
    const onRetry = vi.fn();
    render(
      <BotsErrorState error="profile unavailable" onRetry={onRetry} />,
    );
    expect(screen.getByText("Bots could not be loaded")).toBeTruthy();
    expect(screen.getByText("profile unavailable")).toBeTruthy();
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry).toBeTruthy();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the loading skeleton as a status region", () => {
    render(<BotLoadingState />);
    expect(
      screen.getByRole("status", { name: "Loading Bots" }),
    ).toBeTruthy();
  });
});
