// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Integration tests for the ported LocalWorkspacePortsPanel over a fake
// WorkspacePortsBridge: the visible-only poll, the three source sections,
// the "No workspace selected" state, the refresh-failure toast, and the
// open action's in-app/system split.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from "sonner";
import type {
  WorkspacePortsBridge,
  WorkspacePortsSnapshot,
} from "../../../../shared/usage-contract";
import type { Workspace } from "../../../../shared/session-contract";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { LocalWorkspacePortsPanel } from "./local-workspace-ports-panel";

beforeEach(() => {
  installRadixJsdomStubs();
  vi.mocked(toast.error).mockClear();
});
afterEach(cleanup);

const WORKSPACE: Workspace = {
  id: "ws-1",
  path: "/repo/worktrees/feat",
  name: "feat",
  kind: "git",
  hostId: "local",
};

function snapshot(): WorkspacePortsSnapshot {
  return {
    platform: "darwin",
    scannedAt: 1_000,
    unavailableReason: null,
    ports: [
      {
        id: "127.0.0.1:3000:11",
        bindHost: "127.0.0.1",
        connectHost: "127.0.0.1",
        port: 3000,
        pid: 11,
        processName: "python3",
        protocol: "http",
        kind: "workspace",
        owner: { workspaceId: "ws-1", displayName: "feat", confidence: "cwd" },
      },
      {
        id: "127.0.0.1:4000:22",
        bindHost: "127.0.0.1",
        connectHost: "127.0.0.1",
        port: 4000,
        pid: 22,
        processName: "node",
        protocol: "http",
        kind: "workspace",
        owner: { workspaceId: "ws-2", displayName: "main", confidence: "command" },
      },
      {
        id: "127.0.0.1:17500:33",
        bindHost: "127.0.0.1",
        connectHost: "127.0.0.1",
        port: 17500,
        pid: 33,
        processName: "Dropbox",
        protocol: "unknown",
        kind: "external",
        owner: null,
      },
    ],
  };
}

function fakeBridge(over: Partial<WorkspacePortsBridge> = {}): WorkspacePortsBridge {
  return {
    list: vi.fn().mockResolvedValue({ ok: true, result: snapshot() }),
    kill: vi.fn().mockResolvedValue({ ok: true, result: { ok: true } }),
    ...over,
  };
}

describe("LocalWorkspacePortsPanel", () => {
  it("polls immediately when visible and splits the source sections", async () => {
    const bridge = fakeBridge();
    render(
      <LocalWorkspacePortsPanel
        isVisible
        workspace={WORKSPACE}
        onOpenInBrowserTab={() => {}}
        bridge={bridge}
      />,
    );
    await vi.waitFor(() => expect(bridge.list).toHaveBeenCalledWith({ workspaceId: "ws-1" }));
    expect(screen.getByText("Active Workspace")).toBeTruthy();
    await vi.waitFor(() => expect(screen.getByLabelText("Port 3000 menu")).toBeTruthy());
    // Other Workspaces and External start collapsed (source defaults).
    expect(screen.queryByLabelText("Port 4000 menu")).toBeNull();
    expect(screen.queryByLabelText("Port 17500 menu")).toBeNull();
  });

  it("does not poll while hidden", async () => {
    const bridge = fakeBridge();
    render(
      <LocalWorkspacePortsPanel
        isVisible={false}
        workspace={WORKSPACE}
        onOpenInBrowserTab={() => {}}
        bridge={bridge}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bridge.list).not.toHaveBeenCalled();
  });

  it("shows the source's no-workspace state without a workspace", () => {
    const bridge = fakeBridge();
    render(
      <LocalWorkspacePortsPanel
        isVisible
        workspace={null}
        onOpenInBrowserTab={() => {}}
        bridge={bridge}
      />,
    );
    expect(screen.getByText("No workspace selected")).toBeTruthy();
    expect(bridge.list).not.toHaveBeenCalled();
  });

  it("Open in Browser routes the port URL to the tab creator", async () => {
    const bridge = fakeBridge();
    const onOpenInBrowserTab = vi.fn();
    render(
      <LocalWorkspacePortsPanel
        isVisible
        workspace={WORKSPACE}
        onOpenInBrowserTab={onOpenInBrowserTab}
        bridge={bridge}
      />,
    );
    await vi.waitFor(() => expect(screen.getByLabelText("Open in Browser")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Open in Browser"));
    await vi.waitFor(() =>
      expect(onOpenInBrowserTab).toHaveBeenCalledWith("http://127.0.0.1:3000"),
    );
  });

  it("Stop Process kills through the bridge and toasts the source copy", async () => {
    const bridge = fakeBridge();
    render(
      <LocalWorkspacePortsPanel
        isVisible
        workspace={WORKSPACE}
        onOpenInBrowserTab={() => {}}
        bridge={bridge}
      />,
    );
    await vi.waitFor(() => expect(screen.getByLabelText("Stop Process")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Stop Process"));
    await vi.waitFor(() =>
      expect(bridge.kill).toHaveBeenCalledWith({ workspaceId: "ws-1", pid: 11, port: 3000 }),
    );
    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Stopped process on :3000"),
    );
  });

  it("Stop Process toasts the daemon's refusal reason and does not rescan", async () => {
    const bridge = fakeBridge({
      kill: vi.fn().mockResolvedValue({
        ok: true,
        result: { ok: false, reason: "Only workspace-owned local processes can be stopped here." },
      }),
    });
    render(
      <LocalWorkspacePortsPanel
        isVisible
        workspace={WORKSPACE}
        onOpenInBrowserTab={() => {}}
        bridge={bridge}
      />,
    );
    await vi.waitFor(() => expect(screen.getByLabelText("Stop Process")).toBeTruthy());
    const listsAfterInitial = vi.mocked(bridge.list).mock.calls.length;
    fireEvent.click(screen.getByLabelText("Stop Process"));
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Only workspace-owned local processes can be stopped here.",
      ),
    );
    expect(vi.mocked(bridge.list).mock.calls.length).toBe(listsAfterInitial);
  });

  it("renders the unavailable notice when the scan reports one", async () => {
    const bridge = fakeBridge({
      list: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          platform: "win32",
          scannedAt: 1_000,
          ports: [],
          unavailableReason: "Port scan needs macOS or Linux.",
        },
      }),
    });
    render(
      <LocalWorkspacePortsPanel
        isVisible
        workspace={WORKSPACE}
        onOpenInBrowserTab={() => {}}
        bridge={bridge}
      />,
    );
    await vi.waitFor(() =>
      expect(
        screen.getByText("Port scan unavailable on win32: Port scan needs macOS or Linux."),
      ).toBeTruthy(),
    );
  });

  it("toasts the refresh failure when the bridge rejects", async () => {
    const bridge = fakeBridge({
      list: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: "internal_error", message: "scan failed", retryable: false },
      }),
    });
    render(
      <LocalWorkspacePortsPanel
        isVisible
        workspace={WORKSPACE}
        onOpenInBrowserTab={() => {}}
        bridge={bridge}
      />,
    );
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Failed to refresh ports", {
        description: "scan failed",
      }),
    );
  });
});
