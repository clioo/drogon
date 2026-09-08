// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// General pane behavior: the workspace confirmation switches persist
// through the same preference seams their dialogs already share (so a
// Settings toggle has a real effect on DeleteWorktreeDialog and
// AutomationDeleteDialog today), and the star row opens the repo URL.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GeneralSection } from "./general-section";
import {
  shouldConfirmAutomationDelete,
  setConfirmAutomationDelete,
} from "../automations/AutomationDeleteDialogs";
import {
  readSkipDeleteWorktreeConfirm,
  writeSkipDeleteWorktreeConfirm,
} from "../shell/DeleteWorktreeSkipConfirmOption";
import { DROGON_REPO_URL } from "../landing/github-star";

afterEach(() => {
  cleanup();
  window.localStorage.removeItem("drogon.skipDeleteWorktreeConfirm");
  window.localStorage.removeItem("drogon.automations.deleteConfirm");
  delete (window as { drogon?: unknown }).drogon;
});

describe("general workspace confirmations", () => {
  test("both confirmations default to asking (the fork defaults)", () => {
    render(<GeneralSection />);
    expect(
      screen.getByRole("switch", { name: "Ask Before Deleting Workspaces" }),
    ).toHaveProperty("checked", true);
    expect(
      screen.getByRole("switch", { name: "Ask Before Deleting Automations" }),
    ).toHaveProperty("checked", true);
  });

  test("toggling workspaces persists through the dialog's own seam", () => {
    render(<GeneralSection />);
    const toggle = screen.getByRole("switch", {
      name: "Ask Before Deleting Workspaces",
    });
    fireEvent.click(toggle);
    expect(toggle).toHaveProperty("checked", false);
    // The worktree dialog reads the same key: the toggle has a real effect.
    expect(readSkipDeleteWorktreeConfirm(window.localStorage)).toBe(true);
    fireEvent.click(toggle);
    expect(toggle).toHaveProperty("checked", true);
    expect(readSkipDeleteWorktreeConfirm(window.localStorage)).toBe(false);
  });

  test("toggling automations persists through the dialog's own seam", () => {
    render(<GeneralSection />);
    const toggle = screen.getByRole("switch", {
      name: "Ask Before Deleting Automations",
    });
    fireEvent.click(toggle);
    expect(toggle).toHaveProperty("checked", false);
    expect(shouldConfirmAutomationDelete()).toBe(false);
    expect(window.localStorage.getItem("drogon.automations.deleteConfirm")).toBe(
      "skip",
    );
    fireEvent.click(toggle);
    expect(shouldConfirmAutomationDelete()).toBe(true);
  });

  test("a skip set in the dialog renders unchecked in Settings", () => {
    writeSkipDeleteWorktreeConfirm(true, window.localStorage);
    setConfirmAutomationDelete(false);
    render(<GeneralSection />);
    expect(
      screen.getByRole("switch", { name: "Ask Before Deleting Workspaces" }),
    ).toHaveProperty("checked", false);
    expect(
      screen.getByRole("switch", { name: "Ask Before Deleting Automations" }),
    ).toHaveProperty("checked", false);
  });
});

describe("general support row", () => {
  test("Star opens the repo URL through the shell bridge", () => {
    const openExternal = vi.fn();
    (window as { drogon?: unknown }).drogon = {
      shell: { openExternal },
    };
    render(<GeneralSection />);
    fireEvent.click(screen.getByRole("button", { name: "Star" }));
    expect(openExternal).toHaveBeenCalledWith(DROGON_REPO_URL);
  });
});
