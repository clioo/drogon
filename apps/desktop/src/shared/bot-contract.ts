// Props-only contract mirrors of the admitted native Bot storage records for
// the exported-but-unmounted Bots panel. Shapes follow the serde camelCase JSON
// projections of `crates/drogon-core/src/bots/records.rs` and
// `crates/drogon-core/src/automations/records.rs` at the admitted state
// (docs/migration/native-bot-state-contract.md). This is the panel's own
// display contract, not a second authority for storage semantics; history
// joins are nullable because orphaned evidence is retained, never invented.

import type { Result } from "./session-contract";

export type BotScope = { hostId: string; workspaceId: string };
export type BotSnapshotInput = BotScope & { locale: string };

// R2-S additive types: create (persona/harness policy), a chat turn over
// bot.run (prompt in place of a responsibility invocation) and history.
// Native remains the only authority on preset/harness/text policy; these
// are transport shapes, mirroring `crates/drogon-core/src/bot_run_rpc.rs`
// and `crates/drogon-core/src/bot_mutation_rpc.rs`'s admitted wire shapes.

export type BotCreateInput = BotScope & {
  requestId: string;
  botId?: string | null;
  locale?: string | null;
  body: {
    characterPreset: string;
    displayIdentity: {
      displayName: string;
      handle: string | null;
      title: string | null;
    };
    harnessPolicy: { defaultHarness: string; explicitModel: null };
    instructions: string;
    memories: string[];
  };
};

export type BotRunHarnessOverrides = {
  harnessId: string;
  model?: string | null;
  effort?: string | null;
  provider?: string | null;
  permissionMode?: string | null;
};

/** A `bot.run` call is either a responsibility invocation, or a chat turn
 *  carrying its own `prompt` -- mutually exclusive on the wire (native
 *  rejects supplying both). `requestId` is caller-chosen so a genuine
 *  same-params retry after an ambiguous transport failure reuses the same
 *  ledger key, same as `startHarness`. */
export type BotRunTurnInput = BotScope & {
  requestId: string;
  botId: string;
  harness?: BotRunHarnessOverrides | null;
  locale?: string | null;
} & (
    | {
        responsibilityId: string;
        reason: "scheduledDue" | "manual" | "reactiveEvent";
        eventIdentity: string;
        prompt?: never;
      }
    | {
        prompt: string;
        responsibilityId?: never;
        reason?: never;
        eventIdentity?: never;
      }
  );

export type BotRunReceipt = {
  requestId: string;
  hostId: string;
  workspaceId: string;
  automationRunId: string | null;
  responsibilityRunId: string | null;
  messageId: string | null;
  session: { sessionId: string; incarnation: string } | null;
  outcome: "dispatched" | "refused" | "unsupported";
  refusal: unknown;
  reason: unknown;
  error: string | null;
  observedAt: number | null;
  recordedAt: number;
};

export type BotHistoryInput = BotScope & { botId: string; limit?: number };

/** One chat turn, as returned by `bot.history`. `sessionId`/`incarnation`
 *  let a conversation view read the actual reply via the existing
 *  `session.read` path; this never carries the reply text itself. */
export type BotMessage = {
  id: string;
  botId: string;
  requestId: string;
  prompt: string;
  sessionId: string | null;
  incarnation: string | null;
  hostObservation: BotsPanelHostObservation | null;
  error: string | null;
  startedAt: number;
  endedAt: number | null;
};

export type BotHistoryResult = BotScope & {
  botId: string;
  messages: BotMessage[];
};

export interface BotBridge {
  botSnapshot(
    input: BotSnapshotInput,
  ): Promise<Result<BotScope & BotsPanelSnapshot>>;
  // Optional (rather than required, like botSnapshot above): additive so the
  // coordinator-owned preload/index.ts object literal (which this repo's
  // convention keeps satisfying `DesktopBridge` directly, unlike the `git`
  // namespace's separate untyped merge) never needs editing beyond the
  // granted runtime merge in preload/bot.ts.
  botCreate?(input: BotCreateInput): Promise<Result<BotsPanelBot>>;
  botRun?(input: BotRunTurnInput): Promise<Result<BotRunReceipt>>;
  botHistory?(input: BotHistoryInput): Promise<Result<BotHistoryResult>>;
}

export type BotsPanelHostObservation = "live" | "unverifiable" | "exited";

export type BotsPanelTrigger =
  | { kind: "reactive"; event: string | null }
  | { kind: "scheduled"; automationId: string };

export type BotsPanelResponsibilityKind = "reactive" | "scheduled";

export type BotsPanelRecipeLink = {
  recipeRef: string;
  runId: string | null;
  evidencePath: string | null;
};

export type BotsPanelResponsibility = {
  id: string;
  name: string;
  instructions: string;
  kind: BotsPanelResponsibilityKind;
  trigger: BotsPanelTrigger;
  enabled: boolean;
  recipe: BotsPanelRecipeLink | null;
  createdAt: number;
  updatedAt: number;
};

export type BotsPanelSession = {
  sessionId: string;
  harness: string;
  model: string | null;
  startedAt: number;
  rotatedAt: number | null;
};

export type BotsPanelBot = {
  id: string;
  characterPreset: string;
  displayIdentity: {
    displayName: string;
    handle: string | null;
    title: string | null;
  };
  harnessPolicy: { defaultHarness: string; explicitModel: string | null };
  instructions: string;
  memories: string[];
  responsibilities: BotsPanelResponsibility[];
  currentSession: BotsPanelSession | null;
  createdAt: number;
  updatedAt: number;
};

export type BotsPanelHistoryEntry = {
  run: {
    id: string;
    botId: string;
    responsibilityId: string;
    automationId: string | null;
    automationRunId: string | null;
    startedAt: number;
    endedAt: number | null;
    recipe: BotsPanelRecipeLink | null;
    hostObservation: BotsPanelHostObservation | null;
  };
  responsibilityName: string | null;
  automationName: string | null;
  automationRunNumber: number | null;
};

export type BotsPanelSnapshot = {
  bots: BotsPanelBot[];
  history: BotsPanelHistoryEntry[];
};

/** Minimal structural shape of `session.read`'s result the conversation view
 *  needs (verdict + agent state + raw bytes): a subset of
 *  `shared/session-contract.ts`'s `ReadResult`, redeclared here rather than
 *  imported to avoid a circular import (`session-contract.ts` already
 *  imports `BotBridge` from this file). A real `ReadResult` is structurally
 *  assignable to this. */
export type BotSessionReadResult = {
  session: {
    verdict: BotsPanelHostObservation;
    agentState?: string;
  };
  dataBase64: string;
  startCursor: number;
  nextCursor: number;
  truncated: boolean;
};

export type BotSessionReader = (input: {
  sessionId: string;
  incarnation: string;
  cursor: number;
}) => Promise<Result<BotSessionReadResult>>;

export type BotsPanelProps = {
  snapshot: BotsPanelSnapshot;
  onRunResponsibility?: (input: {
    botId: string;
    responsibilityId: string;
  }) => void;
  /** Caller-observed liveness verdicts (live | unverifiable | exited), one per
   *  bot, from a real observation source. The panel renders them verbatim and
   *  never derives a verdict from the persisted record: a stored session is a
   *  link, not proof of a live process. Bots without an entry render no
   *  liveness claim at all. */
  observedLivenessByBotId?: Record<string, BotsPanelHostObservation>;
  /** R2-S additions, all optional so every existing caller/test that never
   *  supplied them keeps compiling and keeps rendering the pre-R2-S
   *  read-only view. */
  /** The gated bridge itself: create/chat/history need their own request
   *  lifecycle (busy/error/local refresh) that a single fire-and-forget
   *  callback cannot express. */
  bridge?: BotBridge;
  /** Scope needed to call bridge methods; `snapshot` itself carries none. */
  scope?: BotScope & { locale: string };
  /** Reads a chat turn's actual reply bytes via the existing `session.read`
   *  path, keyed by the turn's stored `sessionId`/`incarnation`. Never
   *  wrapped by `bridge` (session reads have their own liveness/authorization
   *  model, distinct from the bot.snapshot.v1 capability gate). */
  sessionReader?: BotSessionReader;
};
