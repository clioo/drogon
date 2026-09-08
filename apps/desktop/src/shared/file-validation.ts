import { z } from "zod";
import {
  MAX_DELETE_PATHS,
  MAX_DIRECTORY_ENTRIES,
  MAX_FILE_BYTES,
  MAX_FILE_SEARCH_QUERY_BYTES,
  MAX_FILE_SEARCH_RESULTS,
} from "./file-contract";

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\s\x00-\x1f\x7f]+$/u);
const scope = z.object({
  hostId: id,
  workspaceId: id,
  path: z
    .string()
    .refine(
      (value) =>
        !value.includes("\0") &&
        new TextEncoder().encode(value).length <= 32_768,
    ),
});
const text = z
  .string()
  .max(MAX_FILE_BYTES)
  .refine((value) => new TextEncoder().encode(value).length <= MAX_FILE_BYTES);
const size = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const fileBridgeSchemas = {
  fileList: scope.extend({
    limitEntries: z.number().int().min(1).max(MAX_DIRECTORY_ENTRIES).optional(),
    // Dotfile filter (explorer Show Dotfiles): the wire flag is camelCase
    // (protocol FileListParams serde); omitted means show-everything.
    includeHidden: z.boolean().optional(),
  }),
  fileRead: scope.extend({
    maxBytes: z.number().int().min(1).max(MAX_FILE_BYTES).optional(),
  }),
  fileWrite: scope.extend({ content: text, requestId: id }),
};
export const fileResultSchemas = {
  "files.list": scope.extend({
    entries: z
      .array(
        z.object({
          name: z.string().min(1).max(32_768),
          kind: z.enum(["file", "directory", "symlink"]),
          size,
          mtime: z.string().max(128),
        }),
      )
      .max(MAX_DIRECTORY_ENTRIES),
    truncated: z.boolean(),
  }),
  "files.read": scope.extend({
    content: text,
    size: size.max(MAX_FILE_BYTES),
    mtime: z.string().max(128),
  }),
  "files.write": scope.extend({
    size: size.max(MAX_FILE_BYTES),
    mtime: z.string().max(128),
  }),
  // Explorer mutations (R16-L #156/#157): the daemon echoes the request
  // identity back (create: scope+kind, rename: from/to, delete: the deleted
  // paths in order). `callNative` parses EVERY daemon reply through this
  // table, so a missing entry turns a successful on-disk mutation into a
  // malformed-contract error and the tree never refreshes. Shapes mirror
  // the daemon's `workspace_file_rpc` echoes exactly.
  "files.create": scope.extend({
    kind: z.enum(["file", "directory"]),
  }),
  "files.rename": z.object({
    hostId: id,
    workspaceId: id,
    from: z
      .string()
      .refine(
        (value) =>
          !value.includes("\0") &&
          new TextEncoder().encode(value).length <= 32_768,
      ),
    to: z
      .string()
      .refine(
        (value) =>
          !value.includes("\0") &&
          new TextEncoder().encode(value).length <= 32_768,
      ),
  }),
  "files.delete": z.object({
    hostId: id,
    workspaceId: id,
    deleted: z
      .array(
        z
          .string()
          .refine(
            (value) =>
              !value.includes("\0") &&
              new TextEncoder().encode(value).length <= 32_768,
          ),
      )
      .max(MAX_DELETE_PATHS),
  }),
  // Bounded quick-open search (R12-B): the daemon echoes the trimmed
  // query with at most `limit` paths; the main bridge re-checks identity
  // and bounds before the renderer ever sees the result.
  "files.search": z.object({
    hostId: id,
    workspaceId: id,
    query: z.string().max(MAX_FILE_SEARCH_QUERY_BYTES),
    files: z.array(z.string().min(1).max(32_768)).max(MAX_FILE_SEARCH_RESULTS),
    truncated: z.boolean(),
  }),
  // Git-ignored visible-row query (R16-AM, coordinator-owned one-liner):
  // the daemon echoes the request identity with the ignored subset.
  "files.ignored": z.object({
    hostId: id,
    workspaceId: id,
    ignored: z.array(z.string()),
  }),
};
