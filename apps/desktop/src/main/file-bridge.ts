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
} from "../shared/file-contract";
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

export async function dispatchFileRequest(
  method: FileMethod | ExplorerFileMethod | FileSearchMethod,
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<unknown>> {
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
    // `includeHidden` is newer than the frozen validation schemas: admit it
    // with a local extension (zod strips unknown keys, so the base schema
    // alone would swallow it) and pass it to the wire as the protocol's
    // `include_hidden` flag; omitted means show-everything, as before.
    const listInput = fileBridgeSchemas.fileList
      .extend({ includeHidden: z.boolean().optional() })
      .parse(input);
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
