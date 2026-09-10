import { z } from "zod";
import { fileBridgeSchemas } from "./file-validation";
import { botSnapshotInputSchema } from "./bot-validation";
import {
  workspacePortsInputSchema,
  workspacePortKillInputSchema,
} from "./usage-contract";

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
  harnessId: z.enum(["claude", "pi", "opencode", "antigravity", "codex"]),
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
  // Bounded quick-open search (R12-B): the channel gate only admits an
  // object here; main/file-bridge.ts re-validates the shape strictly
  // before the native call, so the two never drift apart.
  fileSearch: z.object({}).passthrough(),
  // Git-ignored visible-row query (R16-AM, coordinator-owned one-liner):
  // same passthrough posture; main/file-bridge.ts re-validates strictly.
  fileIgnored: z.object({}).passthrough(),
  status: z.undefined(),
  workspaces: z.undefined(),
  chooseFolder: z.undefined(),
  addWorkspace: z
    .string()
    .min(1)
    .max(32768)
    .refine((value) => !value.includes("\0")),
  sessions: id,
  // Additive (R12-E restart reuse): `start` also admits an object carrying
  // the prior session's recorded argv; the bare workspaceId string remains
  // valid for an ordinary new terminal.
  start: z.union([
    id,
    z.object({
      workspaceId: id,
      command: z
        .string()
        .min(1)
        .max(32768)
        .refine((value) => !value.includes("\0"))
        .optional(),
      args: z
        .array(
          z
            .string()
            .max(4096)
            .refine((value) => !value.includes("\0")),
        )
        .max(256)
        .optional(),
      // Additive (R16-BC, #275): explicit spawn directory; the daemon
      // validates containment in the workspace root.
      cwd: z
        .string()
        .min(1)
        .max(32768)
        .refine((value) => !value.includes("\0"))
        .optional(),
    }),
  ]),
  read: identity.extend({
    cursor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
  write: identity.extend({ text: z.string().max(65536) }),
  resize: identity.extend({
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
  }),
  stop: identity,
  // R16-AL2 (issue #228): user-initiated close paths. `close` stops a
  // live PTY and forgets the record; `forget` removes a record with no
  // live handle (the daemon refuses to forget a live one).
  close: identity,
  forget: identity,
  harnesses: z.undefined(),
  harnessModels: z.object({
    harnessId: z.enum(["claude", "pi", "opencode", "antigravity", "codex"]),
  }),
  startHarness: harnessLaunch,
  buildInfo: z.undefined(),
  // R13-B Ports panel (additive): { workspaceId }; main/usage's
  // listWorkspacePorts re-checks the id before scanning.
  workspacePorts: workspacePortsInputSchema,
  // R16-BC Ports "Stop Process" (additive): { workspaceId, pid, port };
  // the daemon re-proves ownership before signalling anything.
  workspacePortsKill: workspacePortKillInputSchema,
} as const;
