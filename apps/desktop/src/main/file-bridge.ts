import { watch } from "node:fs";
import { BrowserWindow } from "electron";
import { z } from "zod";
import {
  fileBridgeSchemas,
  fileResultSchemas,
} from "../shared/file-validation";
import {
  MAX_DELETE_PATHS,
  MAX_DIRECTORY_ENTRIES,
  MAX_FILE_BYTES,
  MAX_FILE_SEARCH_QUERY_BYTES,
  MAX_FILE_SEARCH_RESULTS,
  MAX_IGNORED_PATHS,
} from "../shared/file-contract";
import type { FilesChangedTick } from "../shared/file-contract";
import type { Result } from "../shared/session-contract";
import { callNative } from "./native-client";

type FileMethod = keyof typeof fileBridgeSchemas;

// Local admission shapes for the explorer mutations. They live here — not
// in shared/file-validation (coordinator-owned) — until the daemon wires
// `files.create`/`files.rename`/`files.delete` dispatch and the preload
// exposes the channels; the bounds mirror the protocol's
// `workspace_files.rs` limits exactly.
const opaqueId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\s\x00-\x1f\x7f]+$/u);
const relPath = z
  .string()
  .refine(
    (value) =>
      !value.includes("\0") &&
      new TextEncoder().encode(value).length <= 32_768,
  );
const explorerBridgeSchemas = {
  fileCreate: z.object({
    hostId: opaqueId,
    workspaceId: opaqueId,
    path: relPath,
    kind: z.enum(["file", "directory"]),
  }),
  fileRename: z.object({
    hostId: opaqueId,
    workspaceId: opaqueId,
    from: relPath,
    to: relPath,
  }),
  fileDelete: z.object({
    hostId: opaqueId,
    workspaceId: opaqueId,
    paths: z.array(relPath).min(1).max(MAX_DELETE_PATHS),
  }),
};
const explorerResultSchemas = {
  "files.create": z.object({
    hostId: opaqueId,
    workspaceId: opaqueId,
    path: relPath,
    kind: z.enum(["file", "directory"]),
  }),
  "files.rename": z.object({
    hostId: opaqueId,
    workspaceId: opaqueId,
    from: relPath,
    to: relPath,
  }),
  "files.delete": z.object({
    hostId: opaqueId,
    workspaceId: opaqueId,
    deleted: z.array(z.string()).max(MAX_DELETE_PATHS),
  }),
};

export type ExplorerFileMethod = keyof typeof explorerBridgeSchemas;
type NativeCall = (
  method: string,
  params: object,
  requestId?: string,
) => Promise<Result<unknown>>;

const fileSearchBridgeSchema = z.object({
  hostId: opaqueId,
  workspaceId: opaqueId,
  query: z
    .string()
    .refine(
      (value) =>
        !value.includes("\0") &&
        new TextEncoder().encode(value).length <= MAX_FILE_SEARCH_QUERY_BYTES,
    ),
  limit: z.number().int().min(1).max(MAX_FILE_SEARCH_RESULTS).optional(),
});
const fileSearchResultSchema = z.object({
  hostId: opaqueId,
  workspaceId: opaqueId,
  query: z.string().max(MAX_FILE_SEARCH_QUERY_BYTES),
  files: z.array(z.string().min(1).max(32_768)).max(MAX_FILE_SEARCH_RESULTS),
  truncated: z.boolean(),
});

export type FileSearchMethod = "fileSearch";
export type FileIgnoredMethod = "fileIgnored";

export async function dispatchFileRequest(
  method: FileMethod | ExplorerFileMethod | FileSearchMethod | FileIgnoredMethod,
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<unknown>> {
  if (method === "fileIgnored") {
    return dispatchFileIgnoredRequest(input, call);
  }
  if (method === "fileSearch") {
    const parsed = fileSearchBridgeSchema.safeParse(input);
    if (!parsed.success)
      return {
        ok: false,
        error: {
          code: "invalid_argument",
          message: "Invalid file search request.",
          retryable: false,
        },
      };
    const asked = parsed.data;
    const result = await call("files.search", {
      hostId: asked.hostId,
      workspaceId: asked.workspaceId,
      query: asked.query,
      ...(asked.limit !== undefined ? { limit: asked.limit } : {}),
    });
    if (!result.ok) return result;
    const checked = fileSearchResultSchema.safeParse(result.result);
    const invalid = (): Result<never> => ({
      ok: false,
      error: {
        code: "internal_error",
        message:
          "The file search response does not match the requested identity.",
        retryable: false,
      },
    });
    if (!checked.success) return invalid();
    const output = checked.data;
    if (
      output.hostId !== asked.hostId ||
      output.workspaceId !== asked.workspaceId ||
      output.query !== asked.query.trim() ||
      output.files.length > (asked.limit ?? MAX_FILE_SEARCH_RESULTS)
    )
      return invalid();
    return { ok: true, result: output };
  }
  const explorerParsed =
    method in explorerBridgeSchemas
      ? explorerBridgeSchemas[method as ExplorerFileMethod].safeParse(input)
      : null;
  if (method in explorerBridgeSchemas) {
    if (!explorerParsed?.success)
      return {
        ok: false,
        error: {
          code: "invalid_argument",
          message: "Invalid file request.",
          retryable: false,
        },
      };
    return dispatchExplorerRequest(
      method as ExplorerFileMethod,
      explorerParsed.data as Record<string, unknown>,
      call,
    );
  }
  const parsed =
    fileBridgeSchemas[method as FileMethod].safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: {
        code: "invalid_argument",
        message: "Invalid file request.",
        retryable: false,
      },
    };
  const value = parsed.data;
  const { hostId, workspaceId, path } = value;
  const scope = { hostId, workspaceId, path };
  let nativeMethod: keyof typeof fileResultSchemas;
  let params: object;
  let requestId: string | undefined;
  if (method === "fileWrite") {
    const write = fileBridgeSchemas.fileWrite.parse(value);
    nativeMethod = "files.write";
    requestId = write.requestId;
    params = {
      ...scope,
      contentBase64: Buffer.from(write.content, "utf8").toString("base64"),
    };
  } else if (method === "fileRead") {
    nativeMethod = "files.read";
    params = fileBridgeSchemas.fileRead.parse(value);
  } else {
    nativeMethod = "files.list";
    // includeHidden rides the base schema (file-validation.ts); zod strips
    // unknown keys, so a schema that lacks it would swallow the flag at the
    // generic drogon:* IPC gate before this dispatcher ever ran.
    const listInput = fileBridgeSchemas.fileList.parse(input);
    params = {
      ...fileBridgeSchemas.fileList.parse(value),
      ...(typeof listInput.includeHidden === "boolean"
        ? { includeHidden: listInput.includeHidden }
        : {}),
    };
  }
  const result = await call(nativeMethod, params, requestId);
  if (!result.ok) return result;
  const checked = fileResultSchemas[nativeMethod].safeParse(result.result);
  const invalid = (): Result<never> => ({
    ok: false,
    error: {
      code: "internal_error",
      message:
        "The file response does not match the requested identity or byte count.",
      retryable: false,
    },
  });
  if (!checked.success) return invalid();
  const output = checked.data;
  if (
    output.hostId !== hostId ||
    output.workspaceId !== workspaceId ||
    output.path !== path
  )
    return invalid();
  if (method === "fileRead") {
    const read = fileResultSchemas["files.read"].parse(output);
    if (
      Buffer.byteLength(read.content, "utf8") !== read.size ||
      read.size >
        (fileBridgeSchemas.fileRead.parse(value).maxBytes ?? MAX_FILE_BYTES)
    )
      return invalid();
  }
  if (
    method === "fileList" &&
    "entries" in output &&
    output.entries.length >
      (fileBridgeSchemas.fileList.parse(value).limitEntries ??
        MAX_DIRECTORY_ENTRIES)
  )
    return invalid();
  if (method === "fileList") {
    // A listed workspace earns a filesystem watcher for live external
    // ticks (R16-L #157). Fire-and-forget: watching never blocks or
    // fails the listing it follows.
    void ensureWorkspaceWatch(hostId, workspaceId, call).catch(() => undefined);
  }
  if (
    method === "fileWrite" &&
    "size" in output &&
    output.size !==
      Buffer.byteLength(
        fileBridgeSchemas.fileWrite.parse(value).content,
        "utf8",
      )
  )
    return invalid();
  return { ok: true, result: output };
}

/**
 * Read-only `files.ignored` fan-out (R16-AM): validates the visible-row
 * batch locally, asks the daemon which rows git ignores, and echoes only
 * queried rows back — a surprising daemon answer decorates nothing.
 * An older host without the method reports method-not-found verbatim
 * (fail-closed, like the explorer mutations above).
 */
const fileIgnoredBridgeSchema = z.object({
  hostId: opaqueId,
  workspaceId: opaqueId,
  paths: z.array(relPath).max(MAX_IGNORED_PATHS),
});
const fileIgnoredResultSchema = z.object({
  hostId: opaqueId,
  workspaceId: opaqueId,
  ignored: z.array(z.string()),
});

async function dispatchFileIgnoredRequest(
  input: unknown,
  call: NativeCall,
): Promise<Result<unknown>> {
  const parsed = fileIgnoredBridgeSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: {
        code: "invalid_argument",
        message: "Invalid ignored-paths request.",
        retryable: false,
      },
    };
  const asked = parsed.data;
  const result = await call("files.ignored", {
    hostId: asked.hostId,
    workspaceId: asked.workspaceId,
    paths: asked.paths,
  });
  if (!result.ok) return result;
  const checked = fileIgnoredResultSchema.safeParse(result.result);
  if (!checked.success)
    return {
      ok: false,
      error: {
        code: "internal_error",
        message:
          "The ignored-paths response does not match the requested identity.",
        retryable: false,
      },
    };
  const output = checked.data;
  if (
    output.hostId !== asked.hostId ||
    output.workspaceId !== asked.workspaceId
  )
    return {
      ok: false,
      error: {
        code: "internal_error",
        message:
          "The ignored-paths response does not match the requested identity.",
        retryable: false,
      },
    };
  const queried = new Set(asked.paths);
  return {
    ok: true,
    result: {
      ...output,
      ignored: output.ignored.filter((entry) => queried.has(entry)),
    },
  };
}

async function dispatchExplorerRequest(
  method: ExplorerFileMethod,
  value: Record<string, unknown>,
  call: NativeCall,
): Promise<Result<unknown>> {
  const invalid = (): Result<never> => ({
    ok: false,
    error: {
      code: "internal_error",
      message:
        "The file response does not match the requested identity or byte count.",
      retryable: false,
    },
  });
  const nativeMethod =
    method === "fileCreate"
      ? "files.create"
      : method === "fileRename"
        ? "files.rename"
        : "files.delete";
  // The parsed shapes above guarantee these casts.
  const params =
    method === "fileCreate"
      ? explorerBridgeSchemas.fileCreate.parse(value)
      : method === "fileRename"
        ? explorerBridgeSchemas.fileRename.parse(value)
        : explorerBridgeSchemas.fileDelete.parse(value);
  const result = await call(nativeMethod, params);
  // An older host without the method reports method-not-found: surface it
  // verbatim (fail-closed, never a local fallback or synthesized result).
  if (!result.ok) return result;
  const checked = explorerResultSchemas[nativeMethod].safeParse(result.result);
  if (!checked.success) return invalid();
  const output = checked.data;
  if (
    output.hostId !== (params as { hostId: string }).hostId ||
    output.workspaceId !== (params as { workspaceId: string }).workspaceId
  )
    return invalid();
  if (method === "fileCreate") {
    const create = explorerResultSchemas["files.create"].parse(output);
    const asked = explorerBridgeSchemas.fileCreate.parse(value);
    if (create.path !== asked.path || create.kind !== asked.kind)
      return invalid();
  }
  if (method === "fileRename") {
    const rename = explorerResultSchemas["files.rename"].parse(output);
    const asked = explorerBridgeSchemas.fileRename.parse(value);
    if (rename.from !== asked.from || rename.to !== asked.to)
      return invalid();
  }
  if (method === "fileDelete") {
    const deleted = explorerResultSchemas["files.delete"].parse(output);
    const asked = explorerBridgeSchemas.fileDelete.parse(value);
    // Every reported deletion must have been requested; the daemon is
    // all-or-error, so a success always echoes the full batch.
    if (
      deleted.deleted.length !== asked.paths.length ||
      !deleted.deleted.every((entry, index) => entry === asked.paths[index])
    )
      return invalid();
  }
  return { ok: true, result: output };
}

/** Push channel the renderer subscribes to through the preload bridge. */
export const FILES_CHANGED_CHANNEL = "drogon:filesChanged";
/** Bound on simultaneously watched workspace roots (LRU-evicted past it). */
export const MAX_WATCHED_WORKSPACES = 8;
// Producer-side batching (the fork's shared/filesystem-watch-batch-window
// role: its producers flush on a trailing window, so the renderer's own
// scheduler adds no extra latency): trailing edge with a max-wait cap so
// a sustained storm still reconciles instead of deferring forever.
const WATCH_TRAILING_MS = 150;
const WATCH_MAX_WAIT_MS = 800;

type FilesWatcherHandle = { close(): void };
export type FilesWatcherDeps = {
  watchRoot?: (
    root: string,
    recursive: boolean,
    onEvent: () => void,
    onError: () => void,
  ) => FilesWatcherHandle;
  broadcast?: (tick: FilesChangedTick) => void;
  platform?: NodeJS.Platform;
};

let watcherDeps: FilesWatcherDeps = {};

/** Test seam (and only test seam): production always uses the defaults. */
export function setFilesWatcherDeps(deps: FilesWatcherDeps | null): void {
  watcherDeps = deps ?? {};
}

type WatchedEntry = {
  workspaceId: string;
  root: string;
  watcher: FilesWatcherHandle;
  timer: ReturnType<typeof setTimeout> | null;
  firstEventAt: number | null;
  lastUsed: number;
};

const watchedWorkspaces = new Map<string, WatchedEntry>();

/** Visible for tests: how many workspace roots are currently watched. */
export function watchedWorkspaceCount(): number {
  return watchedWorkspaces.size;
}

/** Stops every watcher (tests and shutdown); production exits with the app. */
export function stopFilesWatchers(): void {
  for (const entry of watchedWorkspaces.values()) {
    if (entry.timer) clearTimeout(entry.timer);
    try {
      entry.watcher.close();
    } catch {
      // A closing watcher never fails the caller.
    }
  }
  watchedWorkspaces.clear();
}

function broadcastFilesChanged(tick: FilesChangedTick): void {
  const send = watcherDeps.broadcast;
  if (send) {
    send(tick);
    return;
  }
  // No index.ts wiring needed: main already owns every window, so the
  // tick is pushed directly. Absent in unit tests (the electron package
  // exposes no BrowserWindow outside Electron), where it is a no-op.
  if (typeof BrowserWindow === "undefined") return;
  for (const window of BrowserWindow.getAllWindows()) {
    try {
      window.webContents.send(FILES_CHANGED_CHANNEL, tick);
    } catch {
      // One dead window never blocks the rest.
    }
  }
}

function fireWatchTick(key: string): void {
  const entry = watchedWorkspaces.get(key);
  if (!entry) return;
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  entry.firstEventAt = null;
  broadcastFilesChanged({ workspaceId: entry.workspaceId });
}

function noteWorkspaceEvent(key: string): void {
  const entry = watchedWorkspaces.get(key);
  if (!entry) return;
  const now = Date.now();
  entry.firstEventAt ??= now;
  if (entry.timer) clearTimeout(entry.timer);
  const elapsed = now - (entry.firstEventAt ?? now);
  if (elapsed >= WATCH_MAX_WAIT_MS) {
    fireWatchTick(key);
    return;
  }
  entry.timer = setTimeout(
    () => fireWatchTick(key),
    Math.min(WATCH_TRAILING_MS, WATCH_MAX_WAIT_MS - elapsed),
  );
}

/**
 * Ensures one filesystem watcher for the workspace behind a successful
 * `fileList`, so external edits (terminal, git, another app) refresh the
 * tree without a manual Refresh — the fork's Electron-side watcher
 * feeding its `fs:changed` bus, adapted to this repo's coarse
 * workspace ticks. Fail-closed throughout: an unresolvable root, a
 * watch error, or a deleted root only ever means "no live ticks".
 */
export async function ensureWorkspaceWatch(
  hostId: string,
  workspaceId: string,
  call: NativeCall = callNative,
): Promise<void> {
  const key = `${hostId}${workspaceId}`;
  const existing = watchedWorkspaces.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return;
  }
  let root: string | null = null;
  try {
    const listed = await call("workspace.list", {});
    if (listed.ok) {
      const workspaces = (
        listed.result as {
          workspaces?: Array<{
            id?: unknown;
            path?: unknown;
            hostId?: unknown;
          }>;
        }
      ).workspaces;
      const match = (workspaces ?? []).find(
        (candidate) =>
          candidate.id === workspaceId &&
          (candidate.hostId === undefined || candidate.hostId === hostId),
      );
      if (typeof match?.path === "string" && match.path !== "") {
        root = match.path;
      }
    }
  } catch {
    root = null;
  }
  if (!root) return;
  if (watchedWorkspaces.size >= MAX_WATCHED_WORKSPACES) {
    let oldestKey: string | null = null;
    let oldestUsed = Number.POSITIVE_INFINITY;
    for (const [candidateKey, candidate] of watchedWorkspaces) {
      if (candidate.lastUsed < oldestUsed) {
        oldestUsed = candidate.lastUsed;
        oldestKey = candidateKey;
      }
    }
    if (oldestKey !== null) {
      const evicted = watchedWorkspaces.get(oldestKey);
      watchedWorkspaces.delete(oldestKey);
      if (evicted?.timer) clearTimeout(evicted.timer);
      try {
        evicted?.watcher.close();
      } catch {
        // Eviction never fails the new watch.
      }
    }
  }
  const platform = watcherDeps.platform ?? process.platform;
  // `fs.watch` recursion is macOS/Windows-only; elsewhere the root level
  // still reports the renames/deletes that matter most to the tree.
  const recursive = platform === "darwin" || platform === "win32";
  const watchRoot =
    watcherDeps.watchRoot ??
    ((rootPath: string, wantRecursive: boolean, onEvent: () => void, onError: () => void) => {
      const watcher = watch(rootPath, { recursive: wantRecursive }, () => onEvent());
      watcher.on("error", () => onError());
      return watcher;
    });
  let watcher: FilesWatcherHandle;
  try {
    watcher = watchRoot(root, recursive, () => noteWorkspaceEvent(key), () => {
      const stale = watchedWorkspaces.get(key);
      watchedWorkspaces.delete(key);
      if (stale?.timer) clearTimeout(stale.timer);
      try {
        stale?.watcher.close();
      } catch {
        // A dead root cleans itself up quietly.
      }
    });
  } catch {
    return;
  }
  watchedWorkspaces.set(key, {
    workspaceId,
    root,
    watcher,
    timer: null,
    firstEventAt: null,
    lastUsed: Date.now(),
  });
}
