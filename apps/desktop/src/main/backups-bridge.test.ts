import { beforeEach, describe, expect, test, vi } from "vitest";
const { handlers, runCli, relaunch, exit } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input?: unknown) => Promise<unknown>>(),
  runCli: vi.fn(),
  relaunch: vi.fn(),
  exit: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { isPackaged: true, relaunch: relaunch, exit: exit },
  ipcMain: {
    handle: (
      name: string,
      handler: (event: unknown, input?: unknown) => Promise<unknown>,
    ) => handlers.set(name, handler),
  },
}));
vi.mock("./native-client", () => ({ dataDirectory: () => "/tmp/Drogon" }));
import { handleBackupsRequest, registerBackupsBridge } from "./backups-bridge";

const webContents = { fake: true };

const deps = (overrides: Record<string, unknown> = {}) => ({
  resourcesPath: "/bundle/Resources",
  isPackaged: false,
  dataDir: () => "/tmp/Drogon",
  devCliBinary: "/bundle/cli/drogon-cli" as string | null,
  run: runCli,
  ...overrides,
});

const okListEnvelope = {
  ok: true,
  result: {
    dataDir: "/tmp/Drogon",
    backups: [
      {
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
      },
    ],
    preRestoreSnapshots: [],
  },
};

const okRestoreEnvelope = {
  ok: true,
  result: {
    restoredBackupId: "pre-migration-1727000000000",
    preRestoreSnapshotId: "pre-restore-1727000001000",
    databaseFile: "/tmp/Drogon/drogon.sqlite3",
    sizeBytes: 36864,
  },
};

describe("backups bridge", () => {
  beforeEach(() => {
    runCli.mockReset();
    relaunch.mockReset();
    exit.mockReset();
    runCli.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
  });

  test("list runs the bundled CLI with the resolved data dir and validates the envelope", async () => {
    runCli.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify(okListEnvelope),
      stderr: "",
    });
    const result = await handleBackupsRequest({ op: "list" }, deps());
    expect(result).toEqual({ ok: true, list: okListEnvelope.result });
    expect(runCli).toHaveBeenCalledWith("/bundle/cli/drogon-cli", [
      "backups",
      "list",
      "--data-dir",
      "/tmp/Drogon",
      "--json",
    ]);
  });

  test("restore takes only a backup id and never a path", async () => {
    runCli.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify(okRestoreEnvelope),
      stderr: "",
    });
    const result = await handleBackupsRequest(
      { op: "restore", backupId: "pre-migration-1727000000000" },
      deps(),
    );
    expect(result).toEqual({ ok: true, restore: okRestoreEnvelope.result });
    expect(runCli).toHaveBeenCalledWith("/bundle/cli/drogon-cli", [
      "backups",
      "restore",
      "pre-migration-1727000000000",
      "--data-dir",
      "/tmp/Drogon",
      "--json",
    ]);
    const refused = await handleBackupsRequest(
      { op: "restore", backupId: "../../etc" },
      deps(),
    );
    expect(refused.ok).toBe(false);
    // The id is refused at validation, before any CLI runs.
    expect(runCli).toHaveBeenCalledTimes(1);
  });

  test("the CLI's own refusal message is surfaced verbatim", async () => {
    runCli.mockResolvedValue({
      code: 1,
      stdout: JSON.stringify({
        ok: false,
        error: {
          code: "runtime_busy",
          message: "restore refused: a running daemon holds this data directory",
        },
      }),
      stderr: "",
    });
    const result = await handleBackupsRequest(
      { op: "restore", backupId: "pre-migration-1727000000000" },
      deps(),
    );
    expect(result).toEqual({
      ok: false,
      error: "restore refused: a running daemon holds this data directory",
    });
  });

  test("a CLI that answers nothing readable is an honest error, never a crash", async () => {
    runCli.mockResolvedValue({ code: 101, stdout: "not json", stderr: "boom" });
    const result = await handleBackupsRequest({ op: "list" }, deps());
    expect(result).toEqual({ ok: false, error: "boom" });
    runCli.mockResolvedValue({ code: 101, stdout: "not json", stderr: "" });
    const noStderr = await handleBackupsRequest({ op: "list" }, deps());
    expect(noStderr.ok).toBe(false);
  });

  test("a dev build without the CLI seam reports the missing binary", async () => {
    const result = await handleBackupsRequest(
      { op: "list" },
      deps({ isPackaged: false, devCliBinary: null }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("missing from this install");
  });

  test("relaunchApp relaunches only on explicit request", async () => {
    const result = await handleBackupsRequest({ op: "relaunchApp" }, deps());
    expect(result).toEqual({ ok: true, relaunchApp: true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  test("the registered channel gates on the trusted renderer frame", async () => {
    const frame = { fake: true };
    const webContents = { mainFrame: frame };
    registerBackupsBridge(() => ({ webContents } as never));
    const handler = handlers.get("drogon:backups");
    expect(handler).toBeDefined();
    const trusted = { sender: webContents, senderFrame: frame };
    const untrusted = await handler!({ sender: {}, senderFrame: {} }, { op: "list" });
    // The untrusted frame is refused at the gate, before any work happens.
    expect(untrusted).toEqual({
      ok: false,
      error: "Invalid desktop backups request.",
    });
    // A trusted frame gets past the gate (the packaged CLI is absent in this
    // test host, which is the honest next error — not the gate's).
    const good = (await handler!(trusted, { op: "list" })) as {
      ok: boolean;
      error?: string;
    };
    expect(good).not.toEqual({
      ok: false,
      error: "Invalid desktop backups request.",
    });
    if (!good.ok) expect(good.error).toContain("missing from this install");
  });
});
