import { z } from "zod";
import { fileBridgeSchemas } from "./file-validation";
import { botSnapshotInputSchema } from "./bot-validation";

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\x00-\x1f\x7f]+$/);
const identity = z.object({ sessionId: id, incarnation: id });
// Model/provider/effort/prompt are opaque, service-defined values (never a
// renderer-invented catalog); only control characters are excluded so a
// caller cannot smuggle a NUL or newline into an argv-bound field.
const opaque = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[^\x00-\x1f\x7f]+$/)
    .optional();
const harnessLaunch = z.object({
  workspaceId: id,
  harnessId: z.enum(["claude", "pi", "opencode", "antigravity"]),
  model: opaque(4096),
  provider: opaque(256),
  effort: opaque(256),
  prompt: opaque(65536),
  permissionMode: z.enum(["inherit", "unattended"]),
  // Caller-chosen so a genuine same-params retry after an ambiguous
  // transport failure can reuse it and let the service's idempotency
  // ledger dedupe, instead of always minting a fresh identity that could
  // double a real launch. See native-client.ts's `callNative`.
  requestId: id,
});
export const bridgeSchemas = {
  botSnapshot: botSnapshotInputSchema,
  ...fileBridgeSchemas,
  // Explorer mutations (R10-D): the channel gate only admits an object here;
  // main/file-bridge.ts re-validates each shape strictly before the native
  // call, so the two never drift apart.
  fileCreate: z.object({}).passthrough(),
  fileRename: z.object({}).passthrough(),
  fileDelete: z.object({}).passthrough(),
  status: z.undefined(),
  workspaces: z.undefined(),
  chooseFolder: z.undefined(),
  addWorkspace: z
    .string()
    .min(1)
    .max(32768)
    .refine((value) => !value.includes("\0")),
  sessions: id,
  start: id,
  read: identity.extend({
    cursor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
  write: identity.extend({ text: z.string().max(65536) }),
  resize: identity.extend({
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
  }),
  stop: identity,
  harnesses: z.undefined(),
  startHarness: harnessLaunch,
  buildInfo: z.undefined(),
} as const;
