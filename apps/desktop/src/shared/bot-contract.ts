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
export interface BotBridge {
  botSnapshot(
    input: BotSnapshotInput,
  ): Promise<Result<BotScope & BotsPanelSnapshot>>;
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
};
