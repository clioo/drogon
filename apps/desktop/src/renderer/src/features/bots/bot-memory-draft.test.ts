import { describe, expect, it } from "vitest";
import {
  MAX_MEMORY_CONTENT_CHARS,
  buildMemoryCreateRequest,
  buildMemoryDeleteRequest,
  buildMemoryUpdateRequest,
  isLegacyGlobalMemory,
  memoryContentError,
  memoryScopeLabel,
  memoryVisibilitySummary,
  removeMemoryRecord,
  replaceMemoryRecord,
} from "./bot-memory-draft";
import type { BotMemoryRecord } from "./bot-memory-draft";

function record(overrides: Partial<BotMemoryRecord> = {}): BotMemoryRecord {
  return {
    id: "mem-1",
    botId: "bot-1",
    scope: "global",
    projectId: null,
    content: "Prefers terse replies.",
    version: 3,
    provenance: { origin: "user", requestId: "req-1" },
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe("bot-memory-draft", () => {
  it("validates content like the native rule: non-empty, bounded", () => {
    expect(memoryContentError("   ")).toBe("Memory content must not be empty.");
    expect(memoryContentError("")).toBe("Memory content must not be empty.");
    expect(memoryContentError("a real fact")).toBeNull();
    expect(
      memoryContentError("x".repeat(MAX_MEMORY_CONTENT_CHARS + 1)),
    ).toContain("exceeds");
    expect(memoryContentError("x".repeat(MAX_MEMORY_CONTENT_CHARS))).toBeNull();
  });

  it("builds a create request and only carries projectId for project scope", () => {
    const project = buildMemoryCreateRequest({
      botId: "bot-1",
      scope: "project",
      projectId: "proj-a",
      content: "Guard the realm.",
    });
    expect(project.scope).toBe("project");
    expect(project.projectId).toBe("proj-a");
    expect(project.requestId).toBeTruthy();
    const global = buildMemoryCreateRequest({
      botId: "bot-1",
      scope: "global",
      projectId: "proj-a",
      content: "Guard the realm.",
    });
    expect(global.projectId).toBeNull();
  });

  it("carries the record's version as the update/delete expected version", () => {
    const update = buildMemoryUpdateRequest(
      record({ version: 7 }),
      "Edited fact.",
    );
    expect(update).toMatchObject({
      botId: "bot-1",
      memoryId: "mem-1",
      expectedVersion: 7,
      content: "Edited fact.",
    });
    const remove = buildMemoryDeleteRequest(record({ version: 7 }));
    expect(remove).toMatchObject({
      botId: "bot-1",
      memoryId: "mem-1",
      expectedVersion: 7,
    });
    expect(update.requestId).not.toBe(remove.requestId);
  });

  it("labels scope, legacy origin and visibility", () => {
    const global = record();
    expect(memoryScopeLabel(global)).toBe("Global");
    expect(memoryVisibilitySummary(global)).toBe(
      "Visible to this Bot in every project.",
    );
    const project = record({ scope: "project", projectId: "proj-a" });
    expect(memoryScopeLabel(project)).toBe("Project");
    expect(memoryVisibilitySummary(project)).toBe(
      "Visible to this Bot only in project proj-a.",
    );
    expect(
      isLegacyGlobalMemory(record({ provenance: { origin: "legacy-global" } })),
    ).toBe(true);
    expect(isLegacyGlobalMemory(global)).toBe(false);
  });

  it("replaces and removes records order-preservingly", () => {
    const list = [record(), record({ id: "mem-2", content: "Second." })];
    const updated = replaceMemoryRecord(list, record({ version: 4 }));
    expect(updated.map((entry) => entry.id)).toEqual(["mem-1", "mem-2"]);
    expect(updated[0].version).toBe(4);
    const appended = replaceMemoryRecord(list, record({ id: "mem-3" }));
    expect(appended.map((entry) => entry.id)).toEqual([
      "mem-1",
      "mem-2",
      "mem-3",
    ]);
    expect(removeMemoryRecord(list, "mem-1").map((entry) => entry.id)).toEqual([
      "mem-2",
    ]);
    expect(removeMemoryRecord(list, "missing")).toHaveLength(2);
  });
});
