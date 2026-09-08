import { describe, expect, it } from "vitest";
import type { ProjectGroup } from "./project-adapter";
import type {
  Project,
  Worktree,
} from "../../../../shared/session-contract";
import {
  applyOrderInsertAt,
  applyStoredSidebarOrder,
  loadSidebarProjectOrder,
  loadSidebarWorktreeOrder,
  mapVisibleDropIndexToInsertAt,
  orderedProjectIds,
  orderProjectGroups,
  orderWorktreesInGroup,
  reconcileSidebarOrder,
  saveSidebarProjectOrder,
  saveSidebarWorktreeOrder,
} from "./sidebar-order";

function project(id: string): Project {
  return {
    id,
    hostId: "host",
    path: `/tmp/${id}`,
    name: id,
    kind: "git",
    defaultBaseRef: null,
  };
}

function worktree(id: string, projectId: string): Worktree {
  return {
    id,
    projectId,
    workspaceId: `ws-${id}`,
    path: `/tmp/${id}`,
    branch: "main",
    head: "",
    baseRef: null,
    createdAt: "",
  };
}

function group(id: string, cards: string[]): ProjectGroup {
  return {
    project: project(id),
    worktrees: cards.map((card) => worktree(card, id)),
  };
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
}

describe("reconcileSidebarOrder", () => {
  it("keeps stored positions and appends new ids at the end", () => {
    expect(reconcileSidebarOrder(["b", "a"], ["a", "b", "c"])).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("drops stored ids that no longer exist and dedupes stale doubles", () => {
    expect(reconcileSidebarOrder(["a", "gone", "a", "b"], ["a", "b"])).toEqual([
      "a",
      "b",
    ]);
  });

  it("starts from natural order without stored state", () => {
    expect(reconcileSidebarOrder(undefined, ["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("orderProjectGroups", () => {
  it("orders groups by the stored order", () => {
    const groups = [group("a", []), group("b", []), group("c", [])];
    expect(
      orderProjectGroups(groups, ["c", "a"]).map((item) => item.project.id),
    ).toEqual(["c", "a", "b"]);
  });

  it("is stable for ids missing from the stored order", () => {
    const groups = [group("a", []), group("b", [])];
    expect(orderProjectGroups(groups, []).map((item) => item.project.id)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("orderWorktreesInGroup", () => {
  it("orders cards by the stored per-project order", () => {
    const cards = [
      worktree("w1", "p"),
      worktree("w2", "p"),
      worktree("w3", "p"),
    ];
    expect(
      orderWorktreesInGroup(cards, ["w3", "w1"]).map((item) => item.id),
    ).toEqual(["w3", "w1", "w2"]);
  });
});

describe("applyStoredSidebarOrder", () => {
  it("applies project and card orders together", () => {
    const groups = [group("a", ["w1", "w2"]), group("b", ["w3"])];
    const next = applyStoredSidebarOrder(groups, ["b", "a"], { a: ["w2", "w1"] });
    expect(next.map((item) => item.project.id)).toEqual(["b", "a"]);
    expect(next[1]!.worktrees.map((item) => item.id)).toEqual(["w2", "w1"]);
  });
});

describe("orderedProjectIds", () => {
  it("reads ids in group order", () => {
    expect(orderedProjectIds([group("a", []), group("b", [])])).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("mapVisibleDropIndexToInsertAt", () => {
  const all = ["a", "b", "c", "d"];
  const visible = ["b", "c"];

  it("anchors the top edge to the first visible id", () => {
    expect(mapVisibleDropIndexToInsertAt(0, visible, all)).toBe(1);
  });

  it("anchors the bottom edge past the last visible id", () => {
    expect(mapVisibleDropIndexToInsertAt(2, visible, all)).toBe(3);
  });

  it("maps an interior slot to the id below it", () => {
    expect(mapVisibleDropIndexToInsertAt(1, visible, all)).toBe(2);
  });

  it("returns 0 for an empty visible list", () => {
    expect(mapVisibleDropIndexToInsertAt(0, [], all)).toBe(0);
  });
});

describe("applyOrderInsertAt", () => {
  it("moves an id forward and backward", () => {
    expect(applyOrderInsertAt(["a", "b", "c"], "a", 3)).toEqual(["b", "c", "a"]);
    expect(applyOrderInsertAt(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
  });

  it("returns null for an unchanged or invalid move", () => {
    expect(applyOrderInsertAt(["a", "b"], "a", 0)).toBeNull();
    expect(applyOrderInsertAt(["a", "b"], "a", 1)).toBeNull();
    expect(applyOrderInsertAt(["a", "b"], "gone", 0)).toBeNull();
    expect(applyOrderInsertAt(["a", "b"], "a", 9)).toBeNull();
  });
});

describe("sidebar order persistence", () => {
  it("round-trips the project order", () => {
    const storage = memoryStorage();
    saveSidebarProjectOrder(storage, ["b", "a"]);
    expect(loadSidebarProjectOrder(storage)).toEqual(["b", "a"]);
  });

  it("round-trips the per-project worktree order", () => {
    const storage = memoryStorage();
    saveSidebarWorktreeOrder(storage, { a: ["w2", "w1"] });
    expect(loadSidebarWorktreeOrder(storage)).toEqual({ a: ["w2", "w1"] });
  });

  it("ignores malformed envelopes and throwing storage", () => {
    const storage = memoryStorage();
    storage.setItem("drogon:shell:sidebar-project-order", "not json");
    expect(loadSidebarProjectOrder(storage)).toEqual([]);
    const broken: Pick<Storage, "getItem"> = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadSidebarProjectOrder(broken)).toEqual([]);
    expect(loadSidebarWorktreeOrder(broken)).toEqual({});
  });
});
