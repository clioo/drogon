// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Row-action and dialog tests for the ported Ports panel pieces: the copy
// and open actions with their blur handling, the section header toggle,
// and the details dialog's dl fields.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { WorkspacePortRow } from "../../../../shared/usage-contract";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { LocalPortDetailsDialog } from "./local-port-details-dialog";
import { LocalPortRow } from "./local-port-row";
import { LocalPortSection } from "./local-port-section";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

function row(overrides: Partial<WorkspacePortRow> = {}): WorkspacePortRow {
  return {
    id: "127.0.0.1:3000:4101",
    bindHost: "127.0.0.1",
    connectHost: "127.0.0.1",
    port: 3000,
    pid: 4101,
    processName: "python3",
    protocol: "http",
    kind: "workspace",
    owner: { workspaceId: "ws-1", displayName: "feat", confidence: "cwd" },
    ...overrides,
  };
}

describe("LocalPortRow actions", () => {
  it("labels the row like the source and shows process and address", () => {
    render(<LocalPortRow port={row()} onStop={() => {}} onShowDetails={() => {}} onOpenInBrowser={() => {}} />);
    expect(screen.getByLabelText("Port 3000 menu")).toBeTruthy();
    expect(screen.getByText(":3000")).toBeTruthy();
    expect(screen.getByText("python3")).toBeTruthy();
    expect(screen.getByText("127.0.0.1:3000")).toBeTruthy();
    expect(screen.getByText("feat")).toBeTruthy();
    expect(screen.getByText("cwd")).toBeTruthy();
  });

  it("Copy writes the address to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<LocalPortRow port={row()} onStop={() => {}} onShowDetails={() => {}} onOpenInBrowser={() => {}} />);
    fireEvent.click(screen.getByLabelText("Copy 127.0.0.1:3000"));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("127.0.0.1:3000"));
  });

  it("Open in Browser hands the port to the open action", () => {
    const onOpenInBrowser = vi.fn();
    render(<LocalPortRow port={row()} onStop={() => {}} onShowDetails={() => {}} onOpenInBrowser={onOpenInBrowser} />);
    fireEvent.click(screen.getByLabelText("Open in Browser"));
    expect(onOpenInBrowser).toHaveBeenCalledTimes(1);
    expect(onOpenInBrowser.mock.calls[0][0].port).toBe(3000);
  });

  it("workspace rows with a pid offer Stop Process and hand the port to onStop", () => {
    const onStop = vi.fn();
    render(<LocalPortRow port={row()} onStop={onStop} onShowDetails={() => {}} onOpenInBrowser={() => {}} />);
    fireEvent.click(screen.getByLabelText("Stop Process"));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStop.mock.calls[0][0].port).toBe(3000);
  });

  it("no Stop Process affordance for external rows or the app itself", () => {
    const { rerender } = render(
      <LocalPortRow
        port={row({ kind: "external", owner: null })}
        onStop={() => {}}
        onShowDetails={() => {}}
        onOpenInBrowser={() => {}}
      />,
    );
    expect(screen.queryByLabelText("Stop Process")).toBeNull();
    rerender(
      <LocalPortRow
        port={row({ processName: "Electron" })}
        onStop={() => {}}
        onShowDetails={() => {}}
        onOpenInBrowser={() => {}}
      />,
    );
    expect(screen.queryByLabelText("Stop Process")).toBeNull();
  });

  it("external rows show the Unassigned owner without workspace evidence", () => {
    render(
      <LocalPortRow
        port={row({ kind: "external", owner: null, processName: null })}
        onStop={() => {}}
        onShowDetails={() => {}}
        onOpenInBrowser={() => {}}
      />,
    );
    expect(screen.getByText("Unassigned")).toBeTruthy();
    expect(screen.queryByText("cwd")).toBeNull();
    expect(screen.getByText("PID 4101")).toBeTruthy();
  });
});

describe("LocalPortSection", () => {
  it("renders rows while expanded and hides them collapsed", () => {
    const { rerender } = render(
      <LocalPortSection
        id="active"
        title="Active Workspace"
        ports={[row()]}
        collapsed={false}
        onToggle={() => {}}
        onStopPort={() => {}}
        onShowDetails={() => {}}
        onOpenInBrowser={() => {}}
      />,
    );
    expect(screen.getByText("Active Workspace")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByLabelText("Port 3000 menu")).toBeTruthy();

    rerender(
      <LocalPortSection
        id="active"
        title="Active Workspace"
        ports={[row()]}
        collapsed
        onToggle={() => {}}
        onStopPort={() => {}}
        onShowDetails={() => {}}
        onOpenInBrowser={() => {}}
      />,
    );
    expect(screen.queryByLabelText("Port 3000 menu")).toBeNull();
    expect(document.getElementById("local-port-section-active")).toBeNull();
  });

  it("shows the empty text instead of rows when the section is empty", () => {
    render(
      <LocalPortSection
        id="active"
        title="Active Workspace"
        ports={[]}
        emptyText="No ports detected"
        collapsed={false}
        onToggle={() => {}}
        onStopPort={() => {}}
        onShowDetails={() => {}}
        onOpenInBrowser={() => {}}
      />,
    );
    expect(screen.getByText("No ports detected")).toBeTruthy();
  });
});

describe("LocalPortDetailsDialog", () => {
  it("renders the port details grid for a workspace row", () => {
    render(<LocalPortDetailsDialog port={row()} onClose={() => {}} />);
    expect(screen.getByText("Port :3000")).toBeTruthy();
    expect(screen.getByText("python3 · 127.0.0.1:3000")).toBeTruthy();
    expect(screen.getByText("Address")).toBeTruthy();
    // Address and Bind both render the loopback address.
    expect(screen.getAllByText("127.0.0.1:3000")).toHaveLength(2);
    expect(screen.getByText("workspace")).toBeTruthy();
    expect(screen.getByText("http")).toBeTruthy();
    expect(screen.getByText("4101")).toBeTruthy();
    expect(screen.getByText("feat")).toBeTruthy();
    expect(screen.getByText("Evidence")).toBeTruthy();
  });

  it("renders nothing when closed", () => {
    render(<LocalPortDetailsDialog port={null} onClose={() => {}} />);
    expect(screen.queryByText(/Port :/)).toBeNull();
  });
});
