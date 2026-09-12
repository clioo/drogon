import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\x00-\x1f\x7f]+$/u);
const scope = z.object({ hostId: id, workspaceId: id });
// #348/R17-E follow-up: reads are app-global and mutations ride the same
// live scope, so inputs admit the "" host-global sentinel structurally
// (same shape as botSnapshotInputSchema's override below); native resolves
// the bot's owning folder for existing-bot calls and echoes it back — the
// main echo-gates verify that resolution. Transport validation only, as
// everywhere in this file: native owns folder/scope authority.
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
const botHome = z.object({
  // Provisioned-home projection (Bots page "Bot workspace" strip): the
  // real path, handle and home workspace id claimed in the bot_homes
  // component. Null when the Bot was never provisioned.
  handle: z.string(),
  path: z.string().min(1),
  homeWorkspaceId: z.string(),
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
  home: botHome.nullable().optional(),
  currentSession: z
    .object({
      sessionId: z.string(),
      harness: z.string(),
      model: z.string().nullable(),
      startedAt: timestamp,
      rotatedAt: timestamp.nullable(),
      // Live pid projection (bug-bot-a836b4ebf8be65505's Bot session
      // inspector): absent on an older daemon build, null once the
      // session is no longer live/tracked by this service instance.
      processId: z.number().int().nullable().optional(),
      // Daemon-owned liveness facts (Defect 1/2): the recorded link's own
      // workspace/incarnation/verdict, so the renderer can decide
      // focus/reopen/open without searching the selected workspace's
      // session list. Optional so an older daemon build still validates.
      workspaceId: z.string().optional(),
      incarnation: z.string().optional(),
      verdict: z.enum(["live", "unverifiable", "exited"]).optional(),
      // Session resume by identity (owner directive): the provider-native
      // conversation the harness reported, latched onto the Bot record so a
      // reopen names it even after the Drogon session row is gone. Listed
      // here or the snapshot gate's own parse would strip it — the whole
      // point of the gate is that it never invents or drops identity.
      agentSessionId: z.string().max(512).nullable().optional(),
      agentSessionTranscriptPath: z.string().max(4096).nullable().optional(),
      // Finding 6: the daemon positively resolved the recorded link to
      // NOTHING (no live child, no durable row). Listed here or the
      // snapshot gate would strip it, and the renderer could never tell a
      // phantom link (a fresh open is safe and honest) apart from an
      // unresolved liveness (the conservative refusal).
      recordedSessionMissing: z.boolean().optional(),
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
    // Mirrors `ResponsibilityRunInvocation` in
    // crates/drogon-core/src/bots/records.rs. The delegation drain stamps
    // `reactive` when a monitor fires; omitting it here made a single such
    // history row fail the whole `bot.snapshot` parse and blank the Bots page.
    invocation: z.enum(["scheduled", "manual", "reactive"]).nullable(),
  }),
  responsibilityName: z.string().nullable(),
  automationName: z.string().nullable(),
  automationRunNumber: z.number().finite().nullable(),
  // The linked run's status verdict (snake_case) projected for the fork's
  // `status · runRef` evidence line; null for joins predating it.
  automationRunStatus: z.string().nullable(),
});
export const botSnapshotInputSchema = scope
  // #348: workspaceId "" is the app-global scope — the zero-workspace Bots
  // page loads the host-wide snapshot through it (the fork's controller
  // lists app-globally). Every other bot method stays workspace-scoped.
  .extend({
    workspaceId: z
      .string()
      .max(128)
      .regex(/^[^\x00-\x1f\x7f]*$/u),
    locale: z.string().min(1).max(128),
  })
  .strict();
export const botSnapshotResultSchema = scope
  .extend({
    // Echoes the request's scope: "" back for the app-global read.
    workspaceId: z
      .string()
      .max(128)
      .regex(/^[^\x00-\x1f\x7f]*$/u),
  })
  .extend({
    bots: z.array(bot),
    history: z.array(history),
  });

const globalWorkspaceId = z
  .string()
  .max(128)
  .regex(/^[^\x00-\x1f\x7f]*$/u);
const globalScope = z.object({ hostId: id, workspaceId: globalWorkspaceId });

// Structural transport validation only; native owns preset, harness and text policy.
export const botCreateInputSchema = globalScope
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

const responsibilityTurn = globalScope
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

const chatTurn = globalScope
  .extend({
    requestId: id,
    botId: id,
    prompt: z.string().min(1).max(20_000),
    harness: harnessOverrides.nullable().optional(),
    locale: z.string().nullable().optional(),
  })
  .strict();

// Open-session request (bug-bot-a836b4ebf8be65505, refined by the Carlos
// directive on task_e7c183ebc637): `interactive: true` with NO prompt --
// native starts the harness's interactive entrypoint with nothing to
// consume, so no model turn is ever burned on opening a session. See
// BotRunTurnInput's doc in bot-contract.ts.
const openSessionTurn = globalScope
  .extend({
    requestId: id,
    botId: id,
    interactive: z.literal(true),
    // Defect 2: reopen the harness's own prior conversation. Only valid on
    // this dispatch, and native enforces the same rule.
    resume: z.boolean().optional(),
    harness: harnessOverrides.nullable().optional(),
    locale: z.string().nullable().optional(),
  })
  .strict();

export const botRunInputSchema = z.union([
  chatTurn,
  openSessionTurn,
  responsibilityTurn,
]);

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
  // The recreated-home notice (see BotRunReceipt in bot-contract.ts):
  // additive, always present on current daemons.
  homeNotice: z.string().nullable(),
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

export const botResponsibilityCreateInputSchema = globalScope
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

export const botResponsibilityDeleteInputSchema = globalScope
  .extend({
    requestId: id,
    botId: id,
    responsibilityId: z.string().min(1),
    ...scopeLocale,
  })
  .strict();

// The delete receipts echo the REQUESTED workspace id verbatim (native
// resolves the owning folder for the mutation itself but does not project
// it into these receipts), so an app-global '' request echoes '' back.
// Admitted structurally here; the main echo-gates treat ''-for-'' as
// applied-under-global-scope (native authorized it) while scoped requests
// still demand the exact id.
export const botResponsibilityDeleteResultSchema = globalScope.extend({
  botId: z.string(),
  responsibilityId: z.string(),
  removed: z.boolean(),
  automationId: z.string().nullable(),
});

// R9-C: bot-level delete. Structural transport validation only -- native
// owns scope authority and the atomic Bot/automation removal.
export const botDeleteInputSchema = globalScope
  .extend({
    requestId: id,
    botId: id,
    ...scopeLocale,
  })
  .strict();

export const botDeleteResultSchema = globalScope.extend({
  botId: z.string(),
  removed: z.boolean(),
  automationIds: z.array(z.string()),
});

// Bots-page monitor read (`bot.monitor_list`): the read the redesigned
// page's MONITORS column is built from. `workspaceId` admits the ""
// app-global sentinel — native resolves the bot's owning workspace
// daemon-side and echoes the RESOLVED id (never the "" request) in the
// result, so the dispatcher's echo gate demands a real workspace id.
export const botMonitorListInputSchema = z
  .object({
    hostId: id,
    workspaceId: z
      .string()
      .max(128)
      .regex(/^[^\x00-\x1f\x7f]*$/u),
    botId: id,
  })
  .strict();

export const botMonitorListResultSchema = z.object({
  hostId: id,
  botId: id,
  workspaceId: id,
  monitors: z.array(
    z
      .object({
        monitorId: id,
        version: z.number().int().nonnegative(),
        ruleKind: z.string().min(1),
        projectId: z.string(),
        enabled: z.boolean(),
        approved: z.boolean(),
        responsibilityId: z.string().nullable(),
        cursor: z.string().nullable(),
        lastEventId: z.string().nullable(),
        health: z.enum([
          "healthy",
          "degraded",
          "failing",
          "needs_approval",
          "disabled",
        ]),
        trigger: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("manual") }),
          z.object({ kind: z.literal("scheduled"), cron: z.string() }),
        ]),
        consecutiveErrors: z.number().int().nonnegative(),
        lastError: z.string().nullable(),
        // Informational note about the newest committed check (the
        // baseline seed, for example) — deliberately NOT inside
        // `lastError`, so no consumer paints normal operation red.
        lastNotice: z.string().nullable(),
        // Durable check evidence projected by native (never UI-derived).
        failureThreshold: z.number().int().nonnegative(),
        lastCheckAtMs: timestamp.nullable(),
        lastCheckOutcome: z
          .enum(["no_change", "changed", "error"])
          .nullable(),
        incidentCount: z.number().int().nonnegative(),
        delegationsToday: z.object({
          used: z.number().int().nonnegative(),
          max: z.number().int().nonnegative(),
        }),
        // The monitor's own firing history, projected by native from the
        // delegation drain's durable rows (null = never released an
        // action). Metadata only; native never includes watched bytes.
        firing: z
          .object({
            lastEventId: z.string(),
            lastOutcome: z.enum([
              "dispatched",
              "joined_existing",
              "refused",
              "orphaned",
              "cap_exceeded",
              "stale_skipped",
            ]),
            lastRunId: z.string().nullable(),
            lastDetail: z.string().nullable(),
            // The released case's own resource (`pull/42` for a
            // pull-request watch): WHAT the firing released. Null on
            // pre-version-3 evidence rows.
            lastResource: z.string().nullable(),
            lastAtMs: timestamp,
            countToday: z.number().int().nonnegative(),
          })
          .nullable(),
      })
      // Rule-kind summary fields (resource, maxBytes, scriptPath, …) are
      // flattened into the view by native; they are display-only here and
      // unknown kinds must stay visible, so the summary stays open.
      .passthrough(),
  ),
});

// Parked-watch approval (`bot.monitor_approve`): the product path a
// `bot watch-pr` monitor needs. `workspaceId` admits the "" app-global
// sentinel exactly like the monitor read — native resolves the bot's
// owning workspace and echoes the RESOLVED id, so the dispatcher's echo
// gate demands a real workspace id back. The daemon re-derives the
// approval hash from the monitor's CURRENT stored rule text.
export const botMonitorApproveInputSchema = z
  .object({
    hostId: id,
    workspaceId: z
      .string()
      .max(128)
      .regex(/^[^\x00-\x1f\x7f]*$/u),
    botId: id,
    monitorId: id,
  })
  .strict();

export const botMonitorApproveResultSchema = z.object({
  hostId: id,
  botId: id,
  workspaceId: id,
  monitorId: id,
  approved: z.boolean(),
  approvalHash: z.string(),
});
