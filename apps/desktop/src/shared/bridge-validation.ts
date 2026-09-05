import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\x00-\x1f\x7f]+$/);
const identity = z.object({ sessionId: id, incarnation: id });
export const bridgeSchemas = {
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
} as const;
