import { z } from "zod";
import { MAX_DIRECTORY_ENTRIES, MAX_FILE_BYTES } from "./file-contract";

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
};
