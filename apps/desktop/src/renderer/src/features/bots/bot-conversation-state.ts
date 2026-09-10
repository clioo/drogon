// C05 Bot conversation + delivery view state (pure, no React, no DOM).
// Mirrors `crates/drogon-core/src/bots/conversation.rs` and
// `delivery.rs` state rules so the renderer and native agree exactly.
// The renderer NEVER mints conversation ids: ids arrive from native
// resolve/open receipts (`v1` + percent-encoded Bot/project/host triple)
// and are only parsed/compared here. Reply bytes are never stored here:
// callers read them through the existing `session.read` path and pass
// decoded text in as `replies`.

export type ConversationScope = {
  botId: string;
  projectId: string;
  hostId: string;
};

export type NativeLiveness = "live" | "unverifiable" | "exited";

export type EffectiveSource = "proposedFromPolicy" | "actualDispatch";

export type FrozenMemoryView = {
  id: string;
  version: number;
};

export type ConversationView = ConversationScope & {
  id: string;
  botName?: string | null;
  effectiveHarness: string;
  effectiveProvider?: string | null;
  effectiveModel?: string | null;
  /** Whether the runtime is the Bot's stored-policy proposal or the params
   *  an actual dispatch sent. Recovery trusts only `actualDispatch`. */
  effectiveSource: EffectiveSource;
  originatingRunId: string;
  identityVersion: number;
  frozenAt: number;
  contextHash: string;
  /** Adopted C04 frozen memory refs (id + exact version read). */
  memories: FrozenMemoryView[];
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

/** Inverse of native `conversation::conversation_id`: validates the `v1`
 *  tag, splits the three percent-encoded parts and decodes each with
 *  `decodeURIComponent` (the exact inverse of native's
 *  `encodeURIComponent`-compatible encoder). Anything else throws — the
 *  renderer never guesses scope from an opaque string. */
export function parseConversationId(id: string): ConversationScope {
  const parts = id.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error(`malformed conversation id ${id}`);
  }
  const decode = (part: string): string => {
    if (part.includes(":")) throw new Error(`malformed conversation id ${id}`);
    try {
      const decoded = decodeURIComponent(part);
      if (!decoded) throw new Error("empty");
      return decoded;
    } catch {
      throw new Error(`malformed conversation id ${id}`);
    }
  };
  const scope = {
    botId: decode(parts[1]),
    projectId: decode(parts[2]),
    hostId: decode(parts[3]),
  };
  if (!scope.botId.trim() || !scope.projectId.trim() || !scope.hostId.trim()) {
    throw new Error(`malformed conversation id ${id}`);
  }
  return scope;
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

/** True when `id` parses and names exactly `scope`. The single check
 *  consumers use before rendering a conversation under a target triple. */
export function isConversationIdFor(id: string, scope: ConversationScope): boolean {
  try {
    return isSameConversation(parseConversationId(id), scope);
  } catch {
    return false;
  }
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

/** Human-readable context label recording the adopted C04 frozen context:
 *  identity version, frozen memory count and hash prefix, e.g.
 *  `identity v3 · 2 memories · a1b2c3d4`. */
export function formatContextLabel(view: {
  identityVersion: number;
  memories: FrozenMemoryView[];
  contextHash: string;
}): string {
  const short = view.contextHash.slice(0, 8);
  const count = view.memories.length;
  return `identity v${view.identityVersion} · ${count} ${count === 1 ? "memory" : "memories"} · ${short}`;
}

/** Effective runtime label with its provenance, e.g.
 *  `pi · dgx-spark · qwen` or `codex (proposed)`. A proposed runtime is
 *  the Bot's stored-policy defaults, never dispatched truth. */
export function formatRuntimeLabel(view: {
  effectiveHarness: string;
  effectiveProvider?: string | null;
  effectiveModel?: string | null;
  effectiveSource: EffectiveSource;
}): string {
  const parts = [view.effectiveHarness];
  if (view.effectiveProvider) parts.push(view.effectiveProvider);
  if (view.effectiveModel) parts.push(view.effectiveModel);
  const label = parts.join(" · ");
  return view.effectiveSource === "actualDispatch"
    ? label
    : `${label} (proposed)`;
}
