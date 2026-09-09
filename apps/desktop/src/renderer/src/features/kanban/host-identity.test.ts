// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Contract tests for the kanban host-identity boundary (Drogon adaptation of
   Orca's host-qualified-identity at pinned source c9790628). Drogon host ids
   are opaque daemon strings (UUID v4 in practice, no charset guarantee), so
   composition percent-encodes the host part and parsing is strict and
   honest. Coverage per the C02-A repair contract: cross-host identical ids,
   delimiter/Unicode/control characters through a DOM-key round trip,
   unqualified hosts never defaulting to a host, raw/legacy strings never
   becoming destructive-action authority, malformed input failing honestly,
   and the encoded keys staying compatible with grouping, search, selection
   and manual order. */
import { describe, expect, it } from "vitest";
import {
  composeWorktreeHostIdentity,
  getExecutionHostIdFromWorktreeHostIdentity,
  getWorktreeHostIdentity,
  getWorktreeIdFromHostIdentity,
  isWorktreeHostIdentity,
  parseWorktreeHostIdentity,
} from "./host-identity";
import { groupWorkspaceKanbanWorktrees } from "./worktree-groups";
import { buildKanbanWorktrees } from "./kanban-worktree";
import { matchWorkspaceBoardWorktrees } from "./board-search";
import { worktree } from "./test-fixtures";
import type { Project } from "../../../../shared/session-contract";

const projectById = new Map<string, Project>([
  [
    "proj",
    {
      id: "proj",
      hostId: "local",
      path: "/tmp/proj",
      name: "proj",
      kind: "git",
      defaultBaseRef: "main",
    },
  ],
]);

describe("compose: collision-free for opaque hosts", () => {
  it("keeps same workspace ids on different hosts distinct", () => {
    const local = getWorktreeHostIdentity({ id: "shared", hostId: "h1" });
    const other = getWorktreeHostIdentity({ id: "shared", hostId: "h2" });
    expect(local).not.toBe(other);
    expect(getWorktreeIdFromHostIdentity(local)).toBe("shared");
    expect(getWorktreeIdFromHostIdentity(other)).toBe("shared");
  });

  it("encodes delimiter-bearing hosts so they cannot rebind identities", () => {
    // A host literally containing the separator must not produce an identity
    // that parses as a different host plus a different id.
    const identity = getWorktreeHostIdentity({ id: "w1", hostId: "a|b" });
    expect(identity).toBe("a%7Cb|w1");
    expect(getExecutionHostIdFromWorktreeHostIdentity(identity)).toBe("a|b");
    expect(getWorktreeIdFromHostIdentity(identity)).toBe("w1");
    expect(isWorktreeHostIdentity(identity)).toBe(true);

    // And it stays distinct from the two hosts the raw string would spoof.
    expect(identity).not.toBe(
      getWorktreeHostIdentity({ id: "b|w1", hostId: "a" }),
    );
    expect(identity).not.toBe(
      getWorktreeHostIdentity({ id: "w1", hostId: "a" }),
    );
  });

  it("throws on an empty workspace id instead of minting a colliding key", () => {
    expect(() => composeWorktreeHostIdentity("h1", "")).toThrow(TypeError);
    expect(() => composeWorktreeHostIdentity(null, "")).toThrow(TypeError);
  });
});

describe("unqualified hosts: unknown stays unknown", () => {
  it("composes the canonical unqualified form and never defaults to a host", () => {
    expect(composeWorktreeHostIdentity(undefined, "w1")).toBe("|w1");
    expect(composeWorktreeHostIdentity(null, "w1")).toBe("|w1");
    expect(composeWorktreeHostIdentity("", "w1")).toBe("|w1");
    expect(getExecutionHostIdFromWorktreeHostIdentity("|w1")).toBeUndefined();
    const parsed = parseWorktreeHostIdentity("|w1");
    expect(parsed).toEqual({ host: null, worktreeId: "w1", qualified: false });
    expect(isWorktreeHostIdentity("|w1")).toBe(true);
  });

  it("never mentions local: there is no local default in this contract", () => {
    // The adapter row's raw host field flows through unchanged; nothing in
    // the identity layer substitutes a local constant for an unknown host.
    const rows = buildKanbanWorktrees({
      worktrees: [
        {
          id: "w1",
          projectId: "proj",
          workspaceId: "ws",
          path: "/tmp/w1",
          branch: "w1",
          head: "head",
          baseRef: null,
          createdAt: "2026-09-09T00:00:00Z",
        },
      ],
      projectById: new Map(),
      workspaceById: new Map(),
    });
    expect(rows[0]?.hostId).toBe("");
    expect(rows[0] && getWorktreeHostIdentity(rows[0])).toBe("|w1");
    expect(
      getExecutionHostIdFromWorktreeHostIdentity(
        getWorktreeHostIdentity(rows[0]!),
      ),
    ).toBeUndefined();
  });
});

describe("authority: raw strings never become destructive-action authority", () => {
  it("keeps the raw daemon host on the record and uses identity strings only as keys", () => {
    const hostWithPipe = "daemon|suffix";
    const rows = buildKanbanWorktrees({
      worktrees: [
        {
          id: "w1",
          projectId: "proj",
          workspaceId: "ws",
          path: "/tmp/w1",
          branch: "w1",
          head: "head",
          baseRef: null,
          createdAt: "2026-09-09T00:00:00Z",
        },
      ],
      projectById: new Map([
        ["proj", { ...projectById.get("proj")!, hostId: hostWithPipe }],
      ]),
      workspaceById: new Map(),
    });
    // Provenance: the raw field is preserved verbatim for any future
    // destructive-action routing; the identity is only the key form.
    expect(rows[0]?.hostId).toBe(hostWithPipe);
    const identity = getWorktreeHostIdentity(rows[0]!);
    expect(identity).not.toContain(hostWithPipe);
    expect(getExecutionHostIdFromWorktreeHostIdentity(identity)).toBe(
      hostWithPipe,
    );
  });

  it("returns undefined for unqualified and malformed strings instead of a guessed host", () => {
    expect(getExecutionHostIdFromWorktreeHostIdentity("w1")).toBeUndefined();
    expect(getExecutionHostIdFromWorktreeHostIdentity("|w1")).toBeUndefined();
    expect(getExecutionHostIdFromWorktreeHostIdentity("")).toBeUndefined();
    expect(
      getExecutionHostIdFromWorktreeHostIdentity("%zz|w1"),
    ).toBeUndefined();
    expect(getExecutionHostIdFromWorktreeHostIdentity("w1|")).toBeUndefined();
  });

  it("classifies canonical composed forms and rejects non-canonical encodings", () => {
    expect(isWorktreeHostIdentity("h1|w1")).toBe(true);
    expect(isWorktreeHostIdentity("|w1")).toBe(true);
    // Raw spaces would have been composed as %20: a raw space is non-canonical.
    expect(isWorktreeHostIdentity("a b|w1")).toBe(false);
    // Malformed escapes fail the canonical check.
    expect(isWorktreeHostIdentity("%zz|w1")).toBe(false);
    // No separator or empty workspace id is never an identity.
    expect(isWorktreeHostIdentity("plainly-a-workspace-id")).toBe(false);
    expect(isWorktreeHostIdentity("h1|")).toBe(false);
    // parse mirrors the same honesty.
    expect(parseWorktreeHostIdentity("a b|w1")).toBeNull();
    expect(parseWorktreeHostIdentity("%zz|w1")).toBeNull();
    expect(parseWorktreeHostIdentity("plainly-a-workspace-id")).toBeNull();
  });
});

describe("DOM-key round trip", () => {
  function domRoundTrip(identity: string): string {
    const element = document.createElement("div");
    element.setAttribute("data-workspace-identity", identity);
    return element.getAttribute("data-workspace-identity") ?? "";
  }

  it("round-trips delimiter-bearing hosts and ids through a DOM attribute", () => {
    const identity = getWorktreeHostIdentity({
      id: "repo::/tmp/fea|ture",
      hostId: "ssh|weird",
    });
    const round = domRoundTrip(identity);
    expect(round).toBe(identity);
    expect(getExecutionHostIdFromWorktreeHostIdentity(round)).toBe("ssh|weird");
    expect(getWorktreeIdFromHostIdentity(round)).toBe("repo::/tmp/fea|ture");
  });

  it("round-trips Unicode, spaces and tab control characters", () => {
    const identity = getWorktreeHostIdentity({
      id: "repo::/tmp/üllr 🔍\tfeature",
      hostId: "hōst üllr🔍\n",
    });
    const round = domRoundTrip(identity);
    expect(round).toBe(identity);
    const parsed = parseWorktreeHostIdentity(round);
    expect(parsed?.host).toBe("hōst üllr🔍\n");
    expect(parsed?.worktreeId).toBe("repo::/tmp/üllr 🔍\tfeature");
    expect(parsed?.qualified).toBe(true);
  });

  it("keeps the unqualified form distinct from every host through the DOM", () => {
    const unqualified = domRoundTrip(getWorktreeHostIdentity({ id: "w1" }));
    expect(unqualified).toBe("|w1");
    expect(
      getExecutionHostIdFromWorktreeHostIdentity(unqualified),
    ).toBeUndefined();
    expect(unqualified).not.toBe(
      domRoundTrip(getWorktreeHostIdentity({ id: "w1", hostId: "local" })),
    );
  });
});

describe("data-layer compatibility", () => {
  it("groups, searches, selects and orders correctly with encoded keys", () => {
    const rows = buildKanbanWorktrees({
      worktrees: [
        {
          id: "shared",
          projectId: "proj",
          workspaceId: "ws",
          path: "/tmp/shared",
          branch: "shared",
          head: "head",
          baseRef: null,
          createdAt: "2026-09-09T00:00:00Z",
        },
      ],
      projectById: new Map([
        ["proj", { ...projectById.get("proj")!, hostId: "a|b" }],
      ]),
      workspaceById: new Map(),
    });
    const twin = buildKanbanWorktrees({
      worktrees: [
        {
          id: "shared",
          projectId: "proj",
          workspaceId: "ws",
          path: "/tmp/shared",
          branch: "shared",
          head: "head",
          baseRef: null,
          createdAt: "2026-09-09T00:00:00Z",
        },
      ],
      projectById: new Map([
        ["proj", { ...projectById.get("proj")!, hostId: "ab" }],
      ]),
      workspaceById: new Map(),
    });
    const all = [rows[0]!, twin[0]!];
    expect(getWorktreeHostIdentity(rows[0]!)).not.toBe(
      getWorktreeHostIdentity(twin[0]!),
    );

    const statuses = [{ id: "todo", label: "Todo" }];
    const grouped = groupWorkspaceKanbanWorktrees({
      worktrees: all,
      visibleWorktreeIds: new Set(all.map(getWorktreeHostIdentity)),
      workspaceStatuses: statuses,
      sortBy: "recent",
    });
    expect(grouped.get("todo")).toHaveLength(2);

    const matched = matchWorkspaceBoardWorktrees({
      worktrees: all,
      query: "shared",
      projectById: new Map([
        ["proj", { ...projectById.get("proj")!, name: "proj" }],
      ]),
    });
    expect(matched).not.toBeNull();
    expect([...matched!].sort()).toEqual(
      all.map(getWorktreeHostIdentity).sort(),
    );

    // Manual order keyed by identity stays per-row.
    const ordered = [...all].sort((a, b) =>
      getWorktreeHostIdentity(a).localeCompare(getWorktreeHostIdentity(b)),
    );
    expect(ordered).toHaveLength(2);
  });
});
