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
    harnessPolicy: { defaultHarness: string; explicitModel: string | null };
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

/** Fresh harness source for a `bot.run` call, resolved from the bot's own
 *  stored policy at call time (R16-S): `explicitModel` is the single
 *  `provider/model` string the create form collects (the fork's shape),
 *  split into `provider`/`model` overrides where the call is built. */
export type BotRunHarnessSource = {
  harnessId: string;
  explicitModel: string | null;
};

/** A `bot.run` call is one of a responsibility invocation, a chat turn
 *  carrying its own `prompt` (headless one-shot daemon run), or an
 *  open-session dispatch (`interactive: true`, NO `prompt`) -- mutually
 *  exclusive on the wire (native rejects supplying both). `requestId` is
 *  caller-chosen so a genuine same-params retry after an ambiguous
 *  transport failure reuses the same ledger key, same as `startHarness`. */
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
        interactive?: never;
      }
    | {
        prompt: string;
        responsibilityId?: never;
        reason?: never;
        eventIdentity?: never;
        interactive?: never;
      }
    | {
        /** Open-session request (bug-bot-a836b4ebf8be65505, refined by the
         *  Carlos directive on task_e7c183ebc637): native runs the harness's
         *  own interactive entrypoint (no `-p`/`--print`) with NO prompt at
         *  all -- no model turn is dispatched, so the session opens live and
         *  IDLE, ready for the user's first real message. The model is never
         *  asked to confirm liveness or narrate the environment: those are
         *  daemon facts surfaced by the status pill and the Bot session
         *  inspector. A prompt alongside interactive is a native parse
         *  error.
         *
         *  `resume` (Defect 2): reopen the harness's own most recent
         *  conversation in the Bot's home (`--continue`, `codex resume
         *  --last`) instead of starting blank. Native only accepts it on
         *  this dispatch, and a harness that cannot resume is reported
         *  honestly by the caller rather than faked. */
        interactive: true;
        resume?: boolean;
        prompt?: never;
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
  // R7-E: scheduled-responsibility create/delete. `requestId` is
  // caller-chosen so a same-params retry after an ambiguous transport
  // failure reuses the same ledger key, same as `botCreate`/`botRun`.
  // Results are lean ids; callers re-read the full Bot via `botSnapshot`.
  botResponsibilityCreate?(
    input: BotResponsibilityCreateInput,
  ): Promise<Result<BotResponsibilityCreateResult>>;
  botResponsibilityDelete?(
    input: BotResponsibilityDeleteInput,
  ): Promise<Result<BotResponsibilityDeleteResult>>;
  botDelete?(input: BotDeleteInput): Promise<Result<BotDeleteResult>>;
  /** Bots-page monitor read (this task): optional like every other
   *  additive method so older callers keep compiling. */
  botMonitorList?(input: BotMonitorListInput): Promise<Result<BotMonitorListResult>>;
}

// R7-E additive types: a scheduled responsibility is an automation owned by
// the bot. `schedule` is the 5-field UTC cron the daemon scheduler fires;
// `prompt` becomes both the automation prompt and the responsibility
// instructions. Transport shapes only; native owns validation.
export type BotResponsibilityCreateInput = BotScope & {
  requestId: string;
  botId: string;
  name: string;
  schedule: string;
  prompt: string;
  /** Carried for scope-triple uniformity with botSnapshot/botRun; the
   *  bridge strips it before the native call (native has no use for it). */
  locale?: string | null;
};

export type BotResponsibilityCreateResult = BotScope & {
  botId: string;
  responsibilityId: string;
  automationId: string;
};

export type BotResponsibilityDeleteInput = BotScope & {
  requestId: string;
  botId: string;
  responsibilityId: string;
  /** Carried for scope-triple uniformity with botSnapshot/botRun; the
   *  bridge strips it before the native call (native has no use for it). */
  locale?: string | null;
};

export type BotResponsibilityDeleteResult = BotScope & {
  botId: string;
  responsibilityId: string;
  removed: boolean;
  automationId: string | null;
};

// R9-C additive types: bot-level delete removes the bot, its
// responsibilities and their still-Bot-owned automations atomically;
// responsibility-run and chat-message rows stay as orphaned evidence.
// Transport shapes only; native owns validation. Results are lean ids;
// callers re-read the full list via `botSnapshot`.
export type BotDeleteInput = BotScope & {
  requestId: string;
  botId: string;
  /** Carried for scope-triple uniformity with botSnapshot/botRun; the
   *  bridge strips it before the native call (native has no use for it). */
  locale?: string | null;
};

export type BotDeleteResult = BotScope & {
  botId: string;
  removed: boolean;
  automationIds: string[];
};

// Bots-page monitor read (`bot.monitor_list`): the REAL durable state
// behind the MONITORS column — daemon-computed health, the durable check
// evidence (last check time/outcome, incident count) and the real failure
// threshold constant. One wire view per monitor; rule-kind summary fields
// (resource/maxBytes/scriptPath/…) are flattened in by native and stay
// open-ended here so an unknown kind stays visible instead of hidden.
export type BotMonitorHealth =
  | "healthy"
  | "degraded"
  | "failing"
  | "needs_approval"
  | "disabled";

export type BotMonitorView = {
  monitorId: string;
  version: number;
  ruleKind: string;
  projectId: string;
  enabled: boolean;
  approved: boolean;
  responsibilityId: string | null;
  cursor: string | null;
  lastEventId: string | null;
  health: BotMonitorHealth;
  trigger: { kind: "manual" } | { kind: "scheduled"; cron: string };
  consecutiveErrors: number;
  lastError: string | null;
  failureThreshold: number;
  lastCheckAtMs: number | null;
  lastCheckOutcome: "no_change" | "changed" | "error" | null;
  incidentCount: number;
  delegationsToday: { used: number; max: number };
  /** The monitor's own firing history: what its last change event did
   *  through the delegation chain (null = never released an action). */
  firing: BotMonitorFiringView | null;
  /** Rule-kind summary fields (resource, maxBytes, scriptPath, …) —
   *  display-only, keyed by what native's `summary_json` flattened in. */
  [summaryField: string]: unknown;
};

/** One settled delegation verdict for a monitor: dispatched = the bound
 *  responsibility ran (runId names the run row, also visible in the
 *  bot's history as a "Monitor event"); the other outcomes are honest
 *  refusals with their reason. Metadata only, never watched bytes. */
export type BotMonitorFiringView = {
  lastEventId: string;
  lastOutcome:
    | "dispatched"
    | "joined_existing"
    | "refused"
    | "orphaned"
    | "cap_exceeded"
    | "stale_skipped";
  lastRunId: string | null;
  lastDetail: string | null;
  lastAtMs: number;
  countToday: number;
};

export type BotMonitorListInput = BotScope & { botId: string };

export type BotMonitorListResult = {
  hostId: string;
  /** The RESOLVED owning workspace id — an app-global "" request is
   *  resolved daemon-side, so this is never the "" sentinel. */
  workspaceId: string;
  botId: string;
  monitors: BotMonitorView[];
};

export type BotsPanelHostObservation = "live" | "unverifiable" | "exited";

/** A Bot's recorded session that the HOST has confirmed live right now.
 *  Returned by `BotsPanelProps.resolveBotSession`: the daemon verdict —
 *  never a hook-derived guess — already said the session is not exited, so
 *  "Open session" must FOCUS this real session instead of spawning a
 *  second one. `harnessId` is the session's own admitted harness (the
 *  live `Session` projection), which can differ from the Bot's current
 *  stored policy if the policy changed after the session opened. */
export type BotLiveSession = {
  sessionId: string;
  incarnation: string;
  workspaceId: string;
  hostId: string;
  harnessId: string | null;
};

/** What the host knows about a Bot's recorded session at the moment the user
 *  clicks Open (Defect 1). The old `null`-means-"open fresh" contract
 *  conflated "no recorded session" with "recorded but its liveness is not
 *  known yet", so the first click after launch silently opened a SECOND
 *  session. This union keeps the three cases apart:
 *
 *  - `focus`: the recorded session is live (or unverifiable-but-present);
 *    focus it and dispatch NOTHING.
 *  - `reopen`: the recorded session is known to have exited; open a new
 *    session with the harness's resume mechanism so the conversation
 *    continues.
 *  - `open`: there is no recorded session at all; a fresh session is the
 *    correct, honest behavior.
 *  - `unknown`: a recorded session exists but its liveness cannot be
 *    established (daemon build without the projection, or the snapshot has
 *    not loaded). NEVER dispatch a new session here -- that is the
 *    duplicate-creating bug; the caller refuses honestly instead. */
export type BotSessionResolution =
  | { kind: "focus"; session: BotLiveSession }
  | { kind: "reopen"; sessionId: string; harnessId: string | null }
  | { kind: "open" }
  | { kind: "unknown" };

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
  /** Live OS pid of the session's PTY child, projected onto the snapshot
   *  from the daemon's own in-memory session registry (never persisted --
   *  a pid is only ever meaningful for a currently-live process). `null`
   *  when the session is no longer live/tracked by this service instance;
   *  absent on a daemon build that predates this projection. */
  processId?: number | null;
  /** Daemon-owned liveness facts for the recorded link (Defect 1/2): the
   *  workspace the session runs in, the incarnation needed to focus it, and
   *  the host's own verdict. Optional so an older daemon build still
   *  validates; absent means the caller must treat the liveness as UNKNOWN
   *  and must never dispatch a duplicate. */
  workspaceId?: string;
  incarnation?: string;
  verdict?: "live" | "unverifiable" | "exited";
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
  /** Provisioned home (daemon-projected `bot_homes` row): the real
   *  dedicated folder. `null` until first provision; `undefined` on
   *  snapshots from daemon builds predating the projection. */
  home?: { handle: string; path: string; homeWorkspaceId: string } | null;
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
    /** How the run was invoked. `null` for rows written before native
     *  stamped it: every such row came through `bot.run`, so readers
     *  treat `null` as manual. `reactive` marks a run released by a
     *  monitor event through the delegation drain. */
    invocation: "scheduled" | "manual" | "reactive" | null;
  };
  responsibilityName: string | null;
  automationName: string | null;
  automationRunNumber: number | null;
  /** The linked automation run's status verdict (snake_case, e.g.
   *  "completed") — the fork's snapshot carries the full
   *  `automationRun` row and its history row renders `status · id`;
   *  `null` only for rows whose join predates the projection. */
  automationRunStatus: string | null;
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
  /** R7-E: closes the page (the fork's header Back button). Rendered only
   *  when supplied, so callers without a close affordance keep the exact
   *  pre-R7-E header. */
  onClose?: () => void;
  onRunResponsibility?: (input: {
    botId: string;
    responsibilityId: string;
    /** Fresh harness source from the panel's live snapshot (R16-S): the
     *  mount must prefer this over its registration-time snapshot, which
     *  predates in-panel mutations. Optional so older callers keep
     *  compiling; absent means the mount falls back to its own lookup. */
    harness?: BotRunHarnessSource;
  }) => void | Promise<void>;
  /** Host-owned in-app presentation for an opened Bot session
   *  (Carlos directive on task_0436fdf3aa91): the panel calls this after a
   *  dispatched open-session turn with the REAL session native returned,
   *  so the host can open/focus the canonical Bot-linked tab in-app
   *  (in-app focus only, never OS activation). Optional like
   *  onRunResponsibility; absent means the session stays daemon-side
   *  (visible in the session list) with no host presentation. */
  onOpenSession?: (input: {
    botId: string;
    sessionId: string;
    incarnation: string;
    harness: BotRunHarnessSource;
    /** Owning workspace native resolved the turn into (receipt echo): now
     *  the Bot's OWN provisioned home workspace for an interactive open
     *  (bug-bot-a836b4ebf8be65505), never the folder its record happens to
     *  be stored under. The host selects it before focusing the tab. */
    workspaceId: string;
    hostId: string;
    /** Bot identity echoed from the panel's own live snapshot (the same
     *  `live.displayIdentity` the dispatch itself used), so the host can
     *  render bot-scoped chrome (breadcrumb, tab title, the Bot session
     *  inspector) without a second round trip. Never invented: these are
     *  the exact fields the dispatched turn read off the Bot record. */
    displayName: string;
    handle: string | null;
    title: string | null;
  }) => void | Promise<void>;
  /** Host-owned liveness lookup for the DEFAULT "Open session" click (Gap 2):
   *  given the Bot the panel is showing, return its recorded session ONLY
   *  when the host has positively observed it is not exited, else null.
   *  The controller then focuses that session through `onOpenSession`
   *  instead of dispatching a duplicate. Absent/returning null means
   *  "no resumable session", so the click dispatches a fresh one — the
   *  path used when the recorded session genuinely exited or never
   *  existed. */
  resolveBotSession?: (input: { bot: BotsPanelBot }) => BotSessionResolution;
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
