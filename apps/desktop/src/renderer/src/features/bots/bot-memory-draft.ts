/* C04 additive draft model for the Bots memory editors: wire shapes,
 * request builders and version/conflict helpers for versioned,
 * project-scoped Bot memories. The shapes mirror the serde camelCase
 * projections of `crates/drogon-core/src/bots/memory.rs` (the Rust module
 * is the only authority on validation/storage semantics); these are the
 * feature-local transport types the excluded `shared/bot-contract.ts` and
 * the BotsPanel mount will adopt through the reviewed bridge grant
 * (checkpoint msg_068595e02641). Pure data layer: no bridge calls, no
 * localStorage persistence -- every mutation goes through the caller's
 * bridge-backed callbacks with an explicit expected version. */

export type MemoryScope = "global" | "project";
export type MemoryOrigin = "user" | "legacy-global";

export type MemoryProvenance = {
  origin: MemoryOrigin;
  requestId?: string | null;
};

/** One versioned memory record, as returned by the future
 *  `bot.memory_list`/`bot.memory_create`/`bot.memory_update` calls. */
export type BotMemoryRecord = {
  id: string;
  botId: string;
  scope: MemoryScope;
  projectId: string | null;
  content: string;
  /** Monotonic per-record version; every mutation request must carry the
   *  version it read as `expectedVersion` or the backend conflicts. */
  version: number;
  provenance: MemoryProvenance;
  createdAt: number;
  updatedAt: number;
};

/** Structured expected-version conflict, identical in shape for memory
 *  records and identity edits; rendered by both editors and never folded
 *  into a generic error string. */
export type VersionConflict = {
  expectedVersion: number;
  currentVersion: number;
};

export const MAX_MEMORY_CONTENT_CHARS = 262_144;

/** Client-side mirror of the native content rule (non-empty after trim,
 *  bounded length); native remains the authority and re-validates. */
export function memoryContentError(content: string): string | null {
  if (!content.trim()) {
    return "Memory content must not be empty.";
  }
  if ([...content].length > MAX_MEMORY_CONTENT_CHARS) {
    return `Memory content exceeds ${MAX_MEMORY_CONTENT_CHARS} characters.`;
  }
  return null;
}

export type MemoryCreateRequest = {
  requestId: string;
  botId: string;
  scope: MemoryScope;
  projectId: string | null;
  content: string;
};

export type MemoryUpdateRequest = {
  requestId: string;
  botId: string;
  memoryId: string;
  expectedVersion: number;
  content: string;
};

export type MemoryDeleteRequest = {
  requestId: string;
  botId: string;
  memoryId: string;
  expectedVersion: number;
};

export function mintMemoryRequestId(prefix: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}`;
}

export function buildMemoryCreateRequest(input: {
  botId: string;
  scope: MemoryScope;
  projectId: string | null;
  content: string;
}): MemoryCreateRequest {
  return {
    requestId: mintMemoryRequestId("bot-memory-create"),
    botId: input.botId,
    scope: input.scope,
    projectId: input.scope === "project" ? input.projectId : null,
    content: input.content,
  };
}

export function buildMemoryUpdateRequest(
  record: Pick<BotMemoryRecord, "id" | "botId" | "version">,
  content: string,
): MemoryUpdateRequest {
  return {
    requestId: mintMemoryRequestId("bot-memory-update"),
    botId: record.botId,
    memoryId: record.id,
    expectedVersion: record.version,
    content,
  };
}

export function buildMemoryDeleteRequest(
  record: Pick<BotMemoryRecord, "id" | "botId" | "version">,
): MemoryDeleteRequest {
  return {
    requestId: mintMemoryRequestId("bot-memory-delete"),
    botId: record.botId,
    memoryId: record.id,
    expectedVersion: record.version,
  };
}

export function isLegacyGlobalMemory(record: BotMemoryRecord): boolean {
  return record.provenance.origin === "legacy-global";
}

/** Badge label for the record's explicit scope; every row renders one so
 *  global vs project scope is recognizable at a glance. */
export function memoryScopeLabel(record: BotMemoryRecord): string {
  return record.scope === "global" ? "Global" : "Project";
}

/** One-line explanation of where the memory is visible (scope made
 *  explicit in the UI, per the C04 migration/visibility rule). */
export function memoryVisibilitySummary(record: BotMemoryRecord): string {
  if (record.scope === "global") {
    return "Visible to this Bot in every project.";
  }
  return `Visible to this Bot only in project ${record.projectId ?? ""}.`;
}

/** Order-preserving update of one record (post-save refresh helper). */
export function replaceMemoryRecord(
  records: BotMemoryRecord[],
  updated: BotMemoryRecord,
): BotMemoryRecord[] {
  const index = records.findIndex((record) => record.id === updated.id);
  if (index === -1) {
    return [...records, updated];
  }
  const next = records.slice();
  next[index] = updated;
  return next;
}

export function removeMemoryRecord(
  records: BotMemoryRecord[],
  id: string,
): BotMemoryRecord[] {
  return records.filter((record) => record.id !== id);
}
