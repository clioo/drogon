// C06: renderer resume storage — in-memory link hints, the conservative
// liveness classification (loss of contact is never "exited"), and the
// fork-faithful localStorage list resume state.
import { describe, expect, it, vi } from "vitest";
import {
  classifyJiraSessionState,
  clearJiraResume,
  peekJiraResume,
  readJiraTaskResumeState,
  rememberJiraResume,
  writeJiraTaskResumeState,
} from "./jira-task-resume-storage";

describe("classifyJiraSessionState", () => {
  it("maps daemon verdicts distinctly", () => {
    expect(classifyJiraSessionState("live")).toBe("live");
    expect(classifyJiraSessionState("exited")).toBe("exited");
    expect(classifyJiraSessionState("unverifiable")).toBe("unverifiable");
    expect(classifyJiraSessionState(null)).toBe("no-session");
  });

  it("never proves exit from loss of contact", () => {
    expect(classifyJiraSessionState(undefined)).toBe("no-session");
    expect(classifyJiraSessionState("some-future-verdict")).toBe("unverifiable");
    expect(classifyJiraSessionState("")).toBe("unverifiable");
  });
});

describe("resume hints", () => {
  it("round-trips within the renderer session only", () => {
    clearJiraResume("k1");
    expect(peekJiraResume("k1")).toBeNull();
    const hint = rememberJiraResume({
      linkKey: "k1",
      sessionId: "s-1",
      workspaceId: "ws-1",
    });
    expect(peekJiraResume("k1")).toEqual(hint);
    expect(hint.decidedAt).toBeTruthy();
    clearJiraResume("k1");
    expect(peekJiraResume("k1")).toBeNull();
  });
});

describe("list resume state (fork-faithful localStorage)", () => {
  function memoryStorage(): Storage {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
    } as Storage;
  }

  it("round-trips the preset and query", () => {
    const storage = memoryStorage();
    expect(readJiraTaskResumeState(storage)).toBeNull();
    writeJiraTaskResumeState(
      { jiraPreset: "assigned", jiraQuery: "assignee = currentUser()" },
      storage,
    );
    expect(readJiraTaskResumeState(storage)).toEqual({
      jiraPreset: "assigned",
      jiraQuery: "assignee = currentUser()",
    });
  });

  it("reads absent, corrupt and empty payloads as null", () => {
    const storage = memoryStorage();
    storage.setItem("drogon:tasks-jira-resume-state", "{not json");
    expect(readJiraTaskResumeState(storage)).toBeNull();
    storage.setItem("drogon:tasks-jira-resume-state", JSON.stringify({ other: 1 }));
    expect(readJiraTaskResumeState(storage)).toBeNull();
    storage.setItem("drogon:tasks-jira-resume-state", JSON.stringify(7));
    expect(readJiraTaskResumeState(storage)).toBeNull();
  });

  it("drops non-string fields and never writes an empty payload", () => {
    const storage = memoryStorage();
    storage.setItem(
      "drogon:tasks-jira-resume-state",
      JSON.stringify({ jiraPreset: 42, jiraQuery: "keep" }),
    );
    expect(readJiraTaskResumeState(storage)).toEqual({ jiraQuery: "keep" });
    const setItem = vi.spyOn(storage, "setItem");
    writeJiraTaskResumeState({}, storage);
    expect(setItem).not.toHaveBeenCalled();
  });
});
