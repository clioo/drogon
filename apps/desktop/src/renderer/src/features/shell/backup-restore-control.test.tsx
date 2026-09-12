// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BackupRestoreControl } from "./backup-restore-control";
import type {
  BackupsBridge,
  BackupsListResult,
} from "../../../../shared/backups-contract";

const restorableEntry = {
  id: "pre-migration-1727000000000",
  createdAt: "2026-09-12T00:00:00Z",
  originalDataDir: "/tmp/Drogon",
  writerBuildVersion: "0.1.0",
  sizeBytes: 36864,
  pendingMigrations: [
    { component: "bots", recordedVersion: 1, migratingTo: 3 },
  ],
  restorable: true,
  invalidReason: null,
  notRestorableReason: null,
};

const newerEntry = {
  ...restorableEntry,
  id: "pre-migration-1727000005000",
  restorable: false,
  notRestorableReason:
    "bots schema version 4 is newer than the 3 this build supports; restoring would re-trigger the downgrade refusal",
};

const listResult = (backups: unknown[]): BackupsListResult => ({
  dataDir: "/tmp/Drogon",
  backups: backups as BackupsListResult["backups"],
  preRestoreSnapshots: [],
});

function fakeBridge(
  result: BackupsListResult,
  overrides: Partial<BackupsBridge> = {},
): BackupsBridge & { restore: ReturnType<typeof vi.fn>; relaunchApp: ReturnType<typeof vi.fn> } {
  return {
    list: vi.fn().mockResolvedValue({ ok: true, list: result }),
    restore: vi.fn().mockResolvedValue({
      ok: true,
      restore: {
        restoredBackupId: restorableEntry.id,
        preRestoreSnapshotId: "pre-restore-1727000006000",
        databaseFile: "/tmp/Drogon/drogon.sqlite3",
        sizeBytes: 36864,
      },
    }),
    relaunchApp: vi.fn().mockResolvedValue({ ok: true, relaunchApp: true }),
    ...overrides,
  } as never;
}

describe("BackupRestoreControl", () => {
  beforeEach(() => {
    cleanup();
  });

  it("shows the honest manual path when the bridge predates this build", async () => {
    render(<BackupRestoreControl dataDir="/tmp/Drogon" bridge={null} />);
    expect(screen.getByText(/drogon-cli backups list/)).toBeTruthy();
  });

  it("lists backups with timestamps and marks newer ones honestly", async () => {
    const bridge = fakeBridge(listResult([restorableEntry, newerEntry]));
    render(<BackupRestoreControl dataDir="/tmp/Drogon" bridge={bridge} />);
    await waitFor(() =>
      expect(screen.getAllByText(/Backup from/).length).toBe(2),
    );
    expect(
      screen.getByText(/Newer than this build/, { exact: false }),
    ).toBeTruthy();
    expect(
      screen.getByText(/restoring would re-trigger the downgrade refusal/),
    ).toBeTruthy();
    // Exactly one restorable row: one Restore… button.
    expect(screen.getAllByRole("button", { name: "Restore…" }).length).toBe(1);
  });

  it("confirms with the loss sentence before restoring, and never auto-restores", async () => {
    const bridge = fakeBridge(listResult([restorableEntry]));
    render(<BackupRestoreControl dataDir="/tmp/Drogon" bridge={bridge} />);
    await waitFor(() => screen.getByRole("button", { name: "Restore…" }));
    expect(bridge.restore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Restore…" }));
    // The confirmation names the overwrite, the snapshot, and the loss.
    expect(screen.getByText(/overwrites the current database/)).toBeTruthy();
    expect(screen.getByText(/snapshotted first/)).toBeTruthy();
    expect(
      screen.getByText(/Everything recorded after this backup's timestamp/),
    ).toBeTruthy();
    // Still nothing restored without the explicit confirm click.
    expect(bridge.restore).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: /Restore backup from/ }),
    );
    await waitFor(() => expect(bridge.restore).toHaveBeenCalledWith(restorableEntry.id));
    await waitFor(() => expect(bridge.relaunchApp).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Drogon is relaunching/)).toBeTruthy();
  });

  it("cancel backs out of the confirmation without touching anything", async () => {
    const bridge = fakeBridge(listResult([restorableEntry]));
    render(<BackupRestoreControl dataDir="/tmp/Drogon" bridge={bridge} />);
    fireEvent.click(await screen.findByRole("button", { name: "Restore…" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(bridge.restore).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("surfaces the CLI's own refusal message on failure", async () => {
    const bridge = fakeBridge(listResult([restorableEntry]), {
      restore: vi
        .fn()
        .mockResolvedValue({
          ok: false,
          error: "restore refused: backup refused: manifest kind is \"x\"",
        }),
    });
    render(<BackupRestoreControl dataDir="/tmp/Drogon" bridge={bridge} />);
    fireEvent.click(await screen.findByRole("button", { name: "Restore…" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Restore backup from/ }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeTruthy(),
    );
    expect(screen.getByText(/manifest kind is/)).toBeTruthy();
    expect(bridge.relaunchApp).not.toHaveBeenCalled();
  });
});
