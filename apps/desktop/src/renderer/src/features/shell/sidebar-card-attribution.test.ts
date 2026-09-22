/* Which worktree card shows each session: own card, then the parent's card,
   then the innermost card whose directory holds the session's checkout. */
import { describe, expect, test } from "vitest";
import type { Session, Workspace } from "../../../../shared/session-contract";
import {
  attributeSessionsToCards,
  isSessionOnCard,
} from "./sidebar-card-attribution";

function session(
  id: string,
  workspaceId: string,
  overrides: Partial<Session> = {},
): Session {
  return {
    id,
    workspaceId,
    hostId: "host-1",
    incarnation: "1",
    command: "/bin/zsh",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-21T20:00:00.000Z",
    agentState: "working",
    agentStateAt: "2026-09-21T20:40:00.000Z",
    harnessId: null,
    parentSessionId: null,
    ...overrides,
  };
}

function workspace(id: string, path: string, hostId = "host-1"): Workspace {
  return { id, path, name: id, kind: "git", hostId };
}

const ROOT = "/Users/owner/Drogon/workspaces/Drogon";
// The owner's run_4573e2eb shape: a coordinator in the `collapsable-widgets`
// worktree dispatching into clones under its own `.preflight/`.
const workspaces: Workspace[] = [
  workspace("ws-coord", `${ROOT}/collapsable-widgets`),
  workspace("ws-other", `${ROOT}/bug-bot`),
  workspace(
    "ws-clone",
    `${ROOT}/collapsable-widgets/.preflight/sidebar-recovery/workspaces/sidebar-agent-truth`,
  ),
  workspace("ws-elsewhere", "/srv/drogon-worker-clone"),
];
const cards = ["ws-coord", "ws-other"];

describe("sidebar card attribution", () => {
  test("a session in a workspace with a card stays on that card", () => {
    const attribution = attributeSessionsToCards({
      sessions: [session("coord", "ws-coord"), session("other", "ws-other")],
      cardWorkspaceIds: cards,
      workspaces,
    });
    expect(attribution.get("coord")).toBe("ws-coord");
    expect(attribution.get("other")).toBe("ws-other");
  });

  test("a worker in a card-less checkout lands on its parent's card", () => {
    // The clone lives nowhere near the coordinator's card on disk, so only
    // the recorded parent can place it.
    const attribution = attributeSessionsToCards({
      sessions: [
        session("coord", "ws-coord"),
        session("worker", "ws-elsewhere", {
          harnessId: "pi",
          parentSessionId: "coord",
        }),
      ],
      cardWorkspaceIds: cards,
      workspaces,
    });
    expect(attribution.get("worker")).toBe("ws-coord");
  });

  test("the parent chain is followed to any depth", () => {
    const attribution = attributeSessionsToCards({
      sessions: [
        session("grandchild", "ws-elsewhere", { parentSessionId: "worker" }),
        session("worker", "ws-elsewhere", { parentSessionId: "coord" }),
        session("coord", "ws-other"),
      ],
      cardWorkspaceIds: cards,
      workspaces,
    });
    expect(attribution.get("worker")).toBe("ws-other");
    expect(attribution.get("grandchild")).toBe("ws-other");
  });

  test("the recorded parent wins over the directory the checkout sits in", () => {
    const attribution = attributeSessionsToCards({
      sessions: [
        session("coord", "ws-other"),
        session("worker", "ws-clone", { parentSessionId: "coord" }),
      ],
      cardWorkspaceIds: cards,
      workspaces,
    });
    expect(attribution.get("worker")).toBe("ws-other");
  });

  test("without a recorded parent, the card whose directory holds the checkout shows it", () => {
    // What a daemon predating worker lineage (#622) produces: the worker
    // records no parent, but its clone sits inside the coordinator's tree.
    const attribution = attributeSessionsToCards({
      sessions: [
        session("coord", "ws-coord"),
        session("worker", "ws-clone", { harnessId: "pi" }),
      ],
      cardWorkspaceIds: cards,
      workspaces,
    });
    expect(attribution.get("worker")).toBe("ws-coord");
  });

  test("the innermost containing card wins, and a sibling prefix is not containment", () => {
    const nested = [
      workspace("ws-repo", "/repo"),
      workspace("ws-repo-wt", "/repo/worktrees/feature/"),
      workspace("ws-deep", "/repo/worktrees/feature/.preflight/clone"),
      workspace("ws-sibling", "/repo/worktrees/feature-two/clone"),
    ];
    const attribution = attributeSessionsToCards({
      sessions: [session("deep", "ws-deep"), session("sibling", "ws-sibling")],
      cardWorkspaceIds: ["ws-repo", "ws-repo-wt"],
      workspaces: nested,
    });
    expect(attribution.get("deep")).toBe("ws-repo-wt");
    // `/repo/worktrees/feature-two` is not inside `/repo/worktrees/feature`.
    expect(attribution.get("sibling")).toBe("ws-repo");
  });

  test("a directory on another host is never containment", () => {
    const attribution = attributeSessionsToCards({
      sessions: [session("remote", "ws-remote-clone", { hostId: "host-2" })],
      cardWorkspaceIds: cards,
      workspaces: [
        ...workspaces,
        workspace(
          "ws-remote-clone",
          `${ROOT}/collapsable-widgets/.preflight/clone`,
          "host-2",
        ),
      ],
    });
    expect(attribution.has("remote")).toBe(false);
  });

  test("a session with no card, no carded parent and no containing card is on no card", () => {
    const attribution = attributeSessionsToCards({
      sessions: [
        session("orphan", "ws-elsewhere"),
        session("dangling", "ws-elsewhere", { parentSessionId: "gone" }),
      ],
      cardWorkspaceIds: cards,
      workspaces,
    });
    expect(attribution.has("orphan")).toBe(false);
    expect(attribution.has("dangling")).toBe(false);
  });

  test("a session another section draws (a Bot chat) is never adopted", () => {
    const attribution = attributeSessionsToCards({
      sessions: [
        session("coord", "ws-coord"),
        session("bot", "ws-clone", { parentSessionId: "coord" }),
      ],
      cardWorkspaceIds: cards,
      workspaces,
      shownElsewhere: new Set(["bot"]),
    });
    expect(attribution.has("bot")).toBe(false);
  });

  test("a parent cycle terminates and falls back to the directory rule", () => {
    const attribution = attributeSessionsToCards({
      sessions: [
        session("a", "ws-clone", { parentSessionId: "b" }),
        session("b", "ws-clone", { parentSessionId: "a" }),
        session("self", "ws-elsewhere", { parentSessionId: "self" }),
      ],
      cardWorkspaceIds: cards,
      workspaces,
    });
    expect(attribution.get("a")).toBe("ws-coord");
    expect(attribution.get("b")).toBe("ws-coord");
    expect(attribution.has("self")).toBe(false);
  });

  test("isSessionOnCard falls back to the session's own workspace without an attribution", () => {
    const worker = session("worker", "ws-clone", { parentSessionId: "coord" });
    expect(isSessionOnCard(worker, "ws-clone")).toBe(true);
    expect(isSessionOnCard(worker, "ws-coord")).toBe(false);
    const attribution = new Map([["worker", "ws-coord"]]);
    expect(isSessionOnCard(worker, "ws-coord", attribution)).toBe(true);
    expect(isSessionOnCard(worker, "ws-clone", attribution)).toBe(false);
  });
});
