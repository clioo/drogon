import { z } from "zod";

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
});
const cursor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const resultSchemas: Record<string, z.ZodType> = {
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
};
