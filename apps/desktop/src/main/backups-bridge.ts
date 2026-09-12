// MIT Copyright (c) 2026 Lovecast Inc.
// Install-resilience P6 (granted additive main-process seam): the executor
// behind the downgrade-refusal overlay's restore control. The overlay renders
// exactly when the daemon has EXITED (spawned-then-refused), so no daemon RPC
// can list backups or restore one, and the sandboxed renderer/preload cannot
// touch the filesystem. This bridge is the one honest path: it validates the
// renderer's request, then delegates to the BUNDLED `drogon-cli backups`
// (crates/drogon-cli/src/backups.rs) — the single source of truth for
// manifest validation, restorability classification, the reversible
// pre-restore snapshot and the data-dir-lock refusal. The bridge never
// touches database files itself and never accepts a path from the renderer:
// restore takes a backup ID, resolved by the CLI under `<dataDir>/backups`.
import { app, ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { dataDirectory } from "./native-client";
import type {
  BackupsListResult,
  BackupsRestoreResult,
} from "../shared/backups-contract";

const backupsRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("list") }),
  z.object({
    op: z.literal("restore"),
    backupId: z
      .string()
      .regex(/^pre-migration-\d+$/, "backup id must be a pre-migration-<stamp> id"),
  }),
  z.object({ op: z.literal("relaunchApp") }),
]);

// The envelope `drogon-cli backups list/restore --json` prints.
const backupEntrySchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().nullable(),
  originalDataDir: z.string().nullable(),
  writerBuildVersion: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  pendingMigrations: z.array(
    z.object({
      component: z.string(),
      recordedVersion: z.number(),
      migratingTo: z.number(),
    }),
  ),
  restorable: z.boolean(),
  invalidReason: z.string().nullable(),
  notRestorableReason: z.string().nullable(),
});

const backupsListSchema = z.object({
  dataDir: z.string().min(1),
  backups: z.array(backupEntrySchema),
  preRestoreSnapshots: z.array(backupEntrySchema),
});

const backupsRestoreSchema = z.object({
  restoredBackupId: z.string().min(1),
  preRestoreSnapshotId: z.string().nullable(),
  databaseFile: z.string().min(1),
  sizeBytes: z.number(),
});

export type BackupsBridgeResult =
  | { ok: true; list: BackupsListResult }
  | { ok: true; restore: BackupsRestoreResult }
  | { ok: true; relaunchApp: true }
  | { ok: false; error: string };

export type BackupsBridgeDeps = {
  /** Where `drogond`/`drogon-cli` live in a packaged bundle. */
  resourcesPath: string;
  isPackaged: boolean;
  /** The real data directory (env/dev overrides applied). */
  dataDir: () => string;
  /** Dev seam, mirroring the daemon restart's DROGON_DAEMON_BIN rationale. */
  devCliBinary: string | null;
  run(
    binaryPath: string,
    args: string[],
  ): Promise<{ code: number | null; stdout: string; stderr: string }>;
};

/** Where the bundled CLI lives, or null when this install carries none. */
export function cliPathFor(
  deps: Pick<BackupsBridgeDeps, "resourcesPath" | "isPackaged" | "devCliBinary">,
): string | null {
  if (!deps.isPackaged) {
    const seam = deps.devCliBinary;
    return seam && !seam.includes("\0") ? seam : null;
  }
  if (typeof deps.resourcesPath !== "string" || deps.resourcesPath.length === 0) {
    return null;
  }
  const binaryName = process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli";
  const binaryPath = path.join(deps.resourcesPath, "bin", binaryName);
  return existsSync(binaryPath) ? binaryPath : null;
}

/** Runs one bundled-CLI backups call and validates its JSON envelope. */
export async function runBackupsCli(
  deps: BackupsBridgeDeps,
  args: string[],
): Promise<{ ok: true; payload: unknown } | { ok: false; error: string }> {
  const binary = cliPathFor(deps);
  if (!binary) {
    return {
      ok: false,
      error:
        "The Drogon CLI is missing from this install, so backups cannot be used from here.",
    };
  }
  let result: { code: number | null; stdout: string; stderr: string };
  try {
    result = await deps.run(binary, args);
  } catch (error) {
    return {
      ok: false,
      error: `Could not run the Drogon CLI: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  // The CLI prints exactly one JSON envelope on stdout under --json; human
  // diagnostics live on stderr. A non-ok envelope IS the refusal reason, so
  // surface it verbatim — the overlay must show the CLI's own words.
  let envelope: unknown;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    return {
      ok: false,
      error:
        result.stderr.trim() ||
        "The Drogon CLI did not answer with a readable backups envelope.",
    };
  }
  const record = envelope as { ok?: unknown; error?: { message?: unknown } };
  if (record.ok !== true) {
    const message = record.error;
    return {
      ok: false,
      error:
        typeof message === "object" &&
        message !== null &&
        typeof (message as { message?: unknown }).message === "string"
          ? (message as { message: string }).message
          : "The Drogon CLI refused the backups request.",
    };
  }
  // `drogon-cli --json` wraps results in `result` (the protocol envelope).
  const payload = (envelope as { result?: unknown }).result ?? envelope;
  return { ok: true, payload };
}

/** The bridge's decision core: validate input, run the CLI, validate output. */
export async function handleBackupsRequest(
  input: unknown,
  deps: BackupsBridgeDeps,
): Promise<BackupsBridgeResult> {
  const parsed = backupsRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid desktop backups request." };
  }
  let dataDir: string;
  try {
    dataDir = deps.dataDir();
  } catch (error) {
    return {
      ok: false,
      error: `The data directory cannot be resolved: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (parsed.data.op === "relaunchApp") {
    // Offered only by the overlay after a successful restore. Reply first so
    // the invoke resolves, then relaunch: the fresh bootstrap starts the
    // daemon against the restored data dir, without the refusal in play.
    // Args are carried over explicitly so operator/packager flags survive
    // the restart exactly as they were.
    const args = process.argv.slice(1);
    setImmediate(() => {
      app.relaunch(args.length > 0 ? { args } : undefined);
      app.exit(0);
    });
    return { ok: true, relaunchApp: true };
  }
  if (parsed.data.op === "list") {
    const outcome = await runBackupsCli(deps, [
      "backups",
      "list",
      "--data-dir",
      dataDir,
      "--json",
    ]);
    if (!outcome.ok) return { ok: false, error: outcome.error };
    const validated = backupsListSchema.safeParse(outcome.payload);
    if (!validated.success) {
      return { ok: false, error: "The Drogon CLI returned an unexpected backups list." };
    }
    return { ok: true, list: validated.data };
  }
  const outcome = await runBackupsCli(deps, [
    "backups",
    "restore",
    parsed.data.backupId,
    "--data-dir",
    dataDir,
    "--json",
  ]);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  const validated = backupsRestoreSchema.safeParse(outcome.payload);
  if (!validated.success) {
    return { ok: false, error: "The Drogon CLI returned an unexpected restore result." };
  }
  return { ok: true, restore: validated.data };
}

/**
 * The real spawn adapter. The bundled CLI is a short-lived local process the
 * user implicitly launches by clicking restore; its lifetime is bounded by
 * this promise (stdout/stderr close, process exits), and failures surface as
 * a plain error result rather than an unhandled event.
 */
export function spawnCli(
  binaryPath: string,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let spawnError: Error | null = null;
    child.on("error", (error) => {
      spawnError = error;
    });
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      if (spawnError) reject(spawnError);
      else resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Registers the one `drogon:backups` channel behind the same
 * trusted-renderer gate every bridge uses (sender must be the main window's
 * own webContents frame).
 */
export function registerBackupsBridge(getWindow: () => BrowserWindow | null): void {
  const deps: BackupsBridgeDeps = {
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
    dataDir: dataDirectory,
    devCliBinary: process.env.DROGON_CLI_BIN ?? null,
    run: spawnCli,
  };
  ipcMain.handle("drogon:backups", async (event, input: unknown) => {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    ) {
      return { ok: false, error: "Invalid desktop backups request." };
    }
    return handleBackupsRequest(input, deps);
  });
}
