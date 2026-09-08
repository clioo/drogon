import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\x00-\x1f\x7f]+$/u);
const scope = z.object({ hostId: id, workspaceId: id });
const timestamp = z.number().finite();
const recipe = z.object({
  recipeRef: z.string(),
  runId: z.string().nullable(),
  evidencePath: z.string().nullable(),
});
const observation = z.enum(["live", "unverifiable", "exited"]);
const responsibility = z.object({
  id: z.string(),
  name: z.string(),
  instructions: z.string(),
  kind: z.enum(["reactive", "scheduled"]),
  trigger: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("reactive"), event: z.string().nullable() }),
    z.object({ kind: z.literal("scheduled"), automationId: z.string() }),
  ]),
  enabled: z.boolean(),
  recipe: recipe.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const bot = z.object({
  id: z.string(),
  characterPreset: z.string(),
  displayIdentity: z.object({
    displayName: z.string(),
    handle: z.string().nullable(),
    title: z.string().nullable(),
  }),
  harnessPolicy: z.object({
    defaultHarness: z.string(),
    explicitModel: z.string().nullable(),
  }),
  instructions: z.string(),
  memories: z.array(z.string()),
  responsibilities: z.array(responsibility),
  currentSession: z
    .object({
      sessionId: z.string(),
      harness: z.string(),
      model: z.string().nullable(),
      startedAt: timestamp,
      rotatedAt: timestamp.nullable(),
    })
    .nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const history = z.object({
  run: z.object({
    id: z.string(),
    botId: z.string(),
    responsibilityId: z.string(),
    automationId: z.string().nullable(),
    automationRunId: z.string().nullable(),
    startedAt: timestamp,
    endedAt: timestamp.nullable(),
    recipe: recipe.nullable(),
    hostObservation: observation.nullable(),
    invocation: z.enum(["scheduled", "manual"]).nullable(),
  }),
  responsibilityName: z.string().nullable(),
  automationName: z.string().nullable(),
  automationRunNumber: z.number().finite().nullable(),
});
export const botSnapshotInputSchema = scope
  .extend({ locale: z.string().min(1).max(128) })
  .strict();
export const botSnapshotResultSchema = scope.extend({
  bots: z.array(bot),
  history: z.array(history),
});

// Structural transport validation only; native owns preset, harness and text policy.
export const botCreateInputSchema = scope
  .extend({
    requestId: id,
    botId: id.nullable().optional(),
    locale: z.string().nullable().optional(),
    body: bot
      .omit({ id: true, createdAt: true, updatedAt: true })
      .extend({
        displayIdentity: bot.shape.displayIdentity.strict(),
        // R16-S (coordinator-approved deviation from the fork's z.null()):
        // the stored `bot` shape above is already string|null and the
        // create form collects a provider/model string for Pi, so the
        // create boundary admits it too (trimmed-empty folds to null in
        // the renderer body builder; native bounds it).
        harnessPolicy: bot.shape.harnessPolicy.strict(),
        responsibilities: z.array(z.never()).max(0).optional(),
        currentSession: z.null().optional(),
      })
      .strict(),
  })
  .strict();

export const botCreateResultSchema = bot.extend({
  id,
  responsibilities: z.array(z.never()).max(0),
  currentSession: z.null(),
});

// R2-S: chat turn (bot.run with a prompt) and history. Structural transport
// validation only, same as botCreateInputSchema above -- native re-derives
// and enforces the actual mutual-exclusivity/harness/text policy.
const harnessOverrides = z
  .object({
    harnessId: z.string().min(1),
    model: z.string().nullable().optional(),
    effort: z.string().nullable().optional(),
    provider: z.string().nullable().optional(),
    permissionMode: z.string().nullable().optional(),
  })
  .strict();

const responsibilityTurn = scope
  .extend({
    requestId: id,
    botId: id,
    responsibilityId: id,
    reason: z.enum(["scheduledDue", "manual", "reactiveEvent"]),
    eventIdentity: z.string().min(1),
    harness: harnessOverrides.nullable().optional(),
    locale: z.string().nullable().optional(),
  })
  .strict();

const chatTurn = scope
  .extend({
    requestId: id,
    botId: id,
    prompt: z.string().min(1).max(20_000),
    harness: harnessOverrides.nullable().optional(),
    locale: z.string().nullable().optional(),
  })
  .strict();

export const botRunInputSchema = z.union([chatTurn, responsibilityTurn]);

export const botRunResultSchema = z.object({
  requestId: z.string(),
  hostId: z.string(),
  workspaceId: z.string(),
  automationRunId: z.string().nullable(),
  responsibilityRunId: z.string().nullable(),
  messageId: z.string().nullable(),
  session: z
    .object({ sessionId: z.string(), incarnation: z.string() })
    .nullable(),
  outcome: z.enum(["dispatched", "refused", "unsupported"]),
  refusal: z.unknown(),
  reason: z.unknown(),
  error: z.string().nullable(),
  observedAt: timestamp.nullable(),
  recordedAt: timestamp,
});

const botMessage = z.object({
  id: z.string(),
  botId: z.string(),
  requestId: z.string(),
  prompt: z.string(),
  sessionId: z.string().nullable(),
  incarnation: z.string().nullable(),
  hostObservation: observation.nullable(),
  error: z.string().nullable(),
  startedAt: timestamp,
  endedAt: timestamp.nullable(),
});

export const botHistoryInputSchema = scope
  .extend({
    botId: id,
    limit: z.number().int().positive().max(200).optional(),
  })
  .strict();

export const botHistoryResultSchema = scope.extend({
  botId: z.string(),
  messages: z.array(botMessage),
});

// R7-E: scheduled-responsibility create/delete. Structural transport
// validation only -- native owns name/prompt/cron policy, and re-derives
// scope authority from its own host identity. `locale` rides the panel's
// scope triple (like botSnapshot/botRun) and is stripped by the dispatcher
// below: native's params deny it.
const scopeLocale = { locale: z.string().nullable().optional() };

export const botResponsibilityCreateInputSchema = scope
  .extend({
    requestId: id,
    botId: id,
    name: z.string().min(1).max(128),
    schedule: z.string().min(1).max(2048),
    prompt: z.string().min(1).max(32768),
    ...scopeLocale,
  })
  .strict();

export const botResponsibilityCreateResultSchema = scope.extend({
  botId: z.string(),
  responsibilityId: z.string(),
  automationId: z.string(),
});

export const botResponsibilityDeleteInputSchema = scope
  .extend({
    requestId: id,
    botId: id,
    responsibilityId: z.string().min(1),
    ...scopeLocale,
  })
  .strict();

export const botResponsibilityDeleteResultSchema = scope.extend({
  botId: z.string(),
  responsibilityId: z.string(),
  removed: z.boolean(),
  automationId: z.string().nullable(),
});

// R9-C: bot-level delete. Structural transport validation only -- native
// owns scope authority and the atomic Bot/automation removal.
export const botDeleteInputSchema = scope
  .extend({
    requestId: id,
    botId: id,
    ...scopeLocale,
  })
  .strict();

export const botDeleteResultSchema = scope.extend({
  botId: z.string(),
  removed: z.boolean(),
  automationIds: z.array(z.string()),
});
