// C05 Bot conversation + delivery view state (pure, no React, no DOM).
// Mirrors `crates/drogon-core/src/bots/conversation.rs` and
// `delivery.rs` ID/state rules so the renderer and native agree exactly.
// Reply bytes are never stored here: callers read them through the
// existing `session.read` path and pass decoded text in as `replies`.

export type ConversationScope = {
  botId: string;
  projectId: string;
  hostId: string;
};

export type NativeLiveness = "live" | "unverifiable" | "exited";

export type ConversationView = ConversationScope & {
  id: string;
  botName?: string | null;
  effectiveHarness: string;
  effectiveProvider?: string | null;
  effectiveModel?: string | null;
  originatingRunId: string;
  contextVersion: number;
  contextHash: string;
  identityVersion: number;
  nativeSessionId?: string | null;
  nativeIncarnation?: string | null;
  /** Fresh observation for the native link, when the caller has one. */
  liveness?: NativeLiveness | null;
};

export type ConversationMessageView = {
  id: string;
  prompt: string;
  requestId: string;
  sessionId: string | null;
  incarnation: string | null;
  hostObservation: NativeLiveness | null;
  error: string | null;
  startedAt: number;
  endedAt: number | null;
};

export type DeliveryViewState = "pending" | "uncertain" | "delivered" | "failed";

export type DeliveryView = {
  id: string;
  conversationId: string;
  runId: string;
  state: DeliveryViewState;
  attempts: number;
  lastError?: string | null;
  updatedAt: number;
};

/** Deterministic logical-conversation id, mirroring native
 *  `conversation::conversation_id`: `${botId}:${projectId}`. Bot and
 *  project ids in this tree are UUIDs without `:`, so the concatenation is
 *  injective in practice. */
export function resolveConversationId(scope: ConversationScope): string {
  const botId = scope.botId.trim();
  const projectId = scope.projectId.trim();
  if (!botId) throw new Error("bot id must be non-empty");
  if (!projectId) throw new Error("project id must be non-empty");
  if (!scope.hostId.trim()) throw new Error("host id must be non-empty");
  return `${botId}:${projectId}`;
}

export function isSameConversation(
  a: ConversationScope,
  b: ConversationScope,
): boolean {
  return (
    a.botId.trim() === b.botId.trim() &&
    a.projectId.trim() === b.projectId.trim() &&
    a.hostId.trim() === b.hostId.trim()
  );
}

/** Rejects any target outside the conversation's own triple. Returns
 *  `null` on match, else a human-readable mismatch reason. */
export function validateConversationTarget(
  conversation: ConversationScope,
  target: ConversationScope,
): string | null {
  if (target.botId.trim() !== conversation.botId.trim()) {
    return `conversation belongs to bot ${conversation.botId} but target names ${target.botId}`;
  }
  if (target.projectId.trim() !== conversation.projectId.trim()) {
    return `conversation belongs to project ${conversation.projectId} but target names ${target.projectId}`;
  }
  if (target.hostId.trim() !== conversation.hostId.trim()) {
    return `conversation belongs to host ${conversation.hostId} but target names ${target.hostId}`;
  }
  return null;
}

/** Honest liveness label: only the exact `"live"` string is live, only
 *  `"exited"` is exited, everything else is unverifiable. `null` (no
 *  observation) with a native link is unverifiable; with no link there is
 *  no claim at all (`null`). */
export function describeNativeLiveness(input: {
  sessionId?: string | null;
  observedVerdict?: string | null;
}): NativeLiveness | null {
  if (!input.sessionId) return null;
  if (input.observedVerdict === "live") return "live";
  if (input.observedVerdict === "exited") return "exited";
  return "unverifiable";
}

export function deliveryStatusLabel(state: DeliveryViewState): string {
  switch (state) {
    case "pending":
      return "Pending";
    case "uncertain":
      return "Uncertain — needs reconciliation";
    case "delivered":
      return "Delivered";
    case "failed":
      return "Failed";
  }
}

/** Uncertain deliveries must reconcile (explicit target query or user
 *  decision) — never blind-retry, never displayed as delivered. */
export function deliveryNeedsReconciliation(delivery: DeliveryView): boolean {
  return delivery.state === "uncertain";
}

/** Only failed deliveries offer an explicit user-approved retry, and only
 *  pending ones may send. Uncertain never resends automatically. */
export function deliveryCanRetry(delivery: DeliveryView): boolean {
  return delivery.state === "failed";
}

export function deliveryCanSend(delivery: DeliveryView): boolean {
  return delivery.state === "pending";
}

/** FIFO check for queued prompts: `after` must be `before` followed by
 *  `appended` in order. Documents that queue/steer never reorder. */
export function isFifoAppend(
  before: string[],
  after: string[],
  appended: string[],
): boolean {
  if (after.length !== before.length + appended.length) return false;
  for (let i = 0; i < before.length; i += 1) {
    if (after[i] !== before[i]) return false;
  }
  for (let i = 0; i < appended.length; i += 1) {
    if (after[before.length + i] !== appended[i]) return false;
  }
  return true;
}

/** Human-readable context label recording which identity/memory version
 *  produced a result, e.g. `identity v3 · context v5 · a1b2c3d4`. */
export function formatContextLabel(view: {
  identityVersion: number;
  contextVersion: number;
  contextHash: string;
}): string {
  const short = view.contextHash.slice(0, 8);
  return `identity v${view.identityVersion} · context v${view.contextVersion} · ${short}`;
}

/** Effective runtime label, e.g. `pi · dgx-spark/qwen…` or `codex`. */
export function formatRuntimeLabel(view: {
  effectiveHarness: string;
  effectiveProvider?: string | null;
  effectiveModel?: string | null;
}): string {
  const parts = [view.effectiveHarness];
  if (view.effectiveProvider) parts.push(view.effectiveProvider);
  if (view.effectiveModel) parts.push(view.effectiveModel);
  return parts.join(" · ");
}
