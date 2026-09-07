import { z } from "zod";
import { automationResultSchemas } from "./automation-contract";
import { fileResultSchemas } from "./file-validation";

const id = z.string().min(1).max(128);
const workspace = z.object({
  id,
  path: z.string(),
  name: z.string(),
  kind: z.enum(["folder", "git"]),
  hostId: id,
});
const session = z.object({
  id,
  workspaceId: id,
  hostId: id,
  incarnation: id,
  command: z.string(),
  args: z.array(z.string()),
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(1000),
  verdict: z.enum(["live", "unverifiable", "exited"]),
  exitCode: z.number().int().nullable(),
  createdAt: z.string(),
  // R3-C: the daemon always reports these (session-contract.ts), but they
  // stay optional so a response from an older service without them still
  // validates; absent reads as `unknown` at the call sites.
  agentState: z.enum(["working", "idle", "needs_input", "exited", "unknown"]).optional(),
  agentStateAt: z.string().nullable().optional(),
});
const cursor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const harness = z
  .object({
    harnessId: id,
    displayName: z.string().min(1).max(128),
    availability: z.enum(["available", "missing", "unsupported_launcher"]),
    executable: z
      .string()
      .min(1)
      .max(32768)
      .refine((value) => !value.includes("\0"))
      .nullable(),
  })
  .refine((value) =>
    value.availability === "missing"
      ? value.executable === null
      : value.executable !== null &&
        (/^\//.test(value.executable) ||
          /^[a-z]:[\\/]/i.test(value.executable) ||
          /^\\\\[^\\]/.test(value.executable)),
  );
const supportedHarnessIds = new Set([
  "claude",
  "pi",
  "opencode",
  "antigravity",
]);
export const resultSchemas: Record<string, z.ZodType> = {
  ...automationResultSchemas,
  ...fileResultSchemas,
  status: z.object({
    hostId: id,
    serviceInstanceId: id,
    protocol: z.literal(1),
    capabilities: z.array(z.string()),
    version: z.string(),
  }),
  "workspace.register": workspace,
  "workspace.list": z.object({ workspaces: z.array(workspace) }),
  "session.start": session,
  "session.list": z.object({ sessions: z.array(session) }),
  "session.read": z
    .object({
      session,
      dataBase64: z
        .string()
        .max(87384)
        .regex(
          /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
        ),
      startCursor: cursor,
      nextCursor: cursor,
      truncated: z.boolean(),
    })
    .refine((value) => value.nextCursor >= value.startCursor),
  "session.write": z.object({ acceptedBytes: z.number().int().nonnegative() }),
  "session.resize": session,
  "session.stop": session,
  "harness.list": z
    .object({ hostId: id, harnesses: z.array(harness) })
    .transform((value) => ({
      ...value,
      // A future host adapter must not disable known adapters in an older client.
      harnesses: value.harnesses.filter((item) =>
        supportedHarnessIds.has(item.harnessId),
      ),
    })),
  "harness.start": session,
};
