// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Card-level proof for the owner's sidebar design (2026-09-21): the left
   lane carries the workspace STATUS ring (not agent activity), the activity
   is stated in words under the title, the card's own chevron folds the agent
   list and that fold survives a reload, a root row that owns subagents reads
   MAIN, every row states its own condition, and the right-hand review marker
   is one glyph with the review's state. */
import React from "react";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "../../components/ui/tooltip";
import type {
  AgentState,
  Session,
  Workspace,
  Worktree,
} from "../../../../shared/session-contract";
import { WorktreeCard } from "./WorktreeCard";
import {
  formatSidebarProviderLabel,
  resolveRowConciseIdentity,
  resolveRowDisplayPrimary,
} from "./WorktreeAgentRow";
import type { WorktreeAgentRow as WorktreeAgentRowData } from "./worktree-agent-rows";
import { formatRowHarnessLabel } from "./worktree-agent-rows";
import { areWorktreeAgentRowPropsEqual } from "./WorktreeAgentRow";
import type { WorktreeAgentRowProps } from "./WorktreeAgentRow";
import { deriveGeneratedTabTitle } from "../../../../shared/agent-tab-title";
import { EMPTY_TAB_STRIP_STATE } from "./tab-order";
import type { TabStripState } from "./tab-order";
import type { CardProperty } from "./workspace-options-state";
import {
  clearWorktreeAgentExpansionStateForTests,
  resetWorktreeAgentExpansionMemoryForTests,
} from "./worktree-card-agents-expansion-state";
import type { WorktreeCardPrDisplay } from "./worktree-card-pr-display";
import type { WorkspaceStatusDefinition } from "../../../../shared/persistence-contracts/worktree-types";

afterEach(() => {
  cleanup();
  clearWorktreeAgentExpansionStateForTests();
  window.localStorage.removeItem("drogon:agent-generated-titles:v1");
  delete (window as { drogon?: unknown }).drogon;
});

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s-1",
    workspaceId: "ws-1",
    hostId: "host-1",
    incarnation: "1",
    command: "/bin/zsh",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-08T11:00:00.000Z",
    agentState: "working",
    agentStateAt: "2026-09-08T11:59:00.000Z",
    harnessId: null,
    ...overrides,
  };
}

const STATUSES: WorkspaceStatusDefinition[] = [
  { id: "todo", label: "Todo", color: "neutral", icon: "circle" },
  { id: "in-review", label: "In review", color: "conductor-review", icon: "conductor-review" },
  { id: "completed", label: "Done", color: "conductor-done", icon: "conductor-done" },
];

const workspaces: Workspace[] = [
  { id: "ws-1", path: "/tmp/demo", name: "demo", kind: "folder", hostId: "host-1" },
];

function worktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: "wt-1",
    projectId: "folder:/tmp/demo",
    workspaceId: "ws-1",
    path: "/tmp/demo",
    branch: "demo",
    head: "",
    baseRef: null,
    createdAt: "2026-09-08T10:00:00.000Z",
    ...overrides,
  };
}

function renderCard({
  sessions,
  statusId = null,
  pr = null,
  worktreeOverrides = {},
  tabStrip = EMPTY_TAB_STRIP_STATE,
  showProperties = {},
}: {
  sessions: Session[];
  statusId?: string | null;
  pr?: WorktreeCardPrDisplay | null;
  worktreeOverrides?: Partial<Worktree>;
  tabStrip?: TabStripState;
  showProperties?: Partial<Record<CardProperty, boolean>>;
}) {
  (window as unknown as { drogon?: unknown }).drogon ??= {};
  return render(
    <TooltipProvider>
      <WorktreeCard
        worktree={worktree({ workspaceStatus: statusId, ...worktreeOverrides })}
        workspaces={workspaces}
        sessions={sessions}
        selected
        disabled={false}
        projectKind="folder"
        implicitFolderWorktree
        onSelect={() => {}}
        onSelectSession={() => {}}
        activeSessionId=""
        tabStrip={tabStrip}
        statuses={STATUSES}
        pr={pr}
        onRemove={null}
        onRename={null}
        showProperties={showProperties}
      />
    </TooltipProvider>,
  );
}

describe("card activity sentence", () => {
  test.each([
    [[], "NO SESSION"],
    [[session({ agentState: "idle" })], "NO ACTIVE AGENTS"],
    [
      [session({ id: "a", agentState: "working" })],
      "1 AGENT WORKING",
    ],
    [
      [session({ id: "a", agentState: "working" }), session({ id: "b", agentState: "working" })],
      "2 AGENTS WORKING",
    ],
    [
      [session({ id: "a", agentState: "working" }), session({ id: "b", agentState: "needs_input" })],
      "1 AGENT NEEDS INPUT",
    ],
    [
      [session({ id: "a", agentState: undefined, agentStateAt: null })],
      "1 AGENT NOT REPORTING",
    ],
  ] as const)("states %s sessions as %s", (sessions, sentence) => {
    const { container } = renderCard({ sessions: [...sessions] });
    expect(
      container.querySelector(".shell-worktree-card-sentence")?.textContent,
    ).toBe(sentence);
  });

  test("the working glyph rides the lane only while an agent works or waits", () => {
    const working = renderCard({ sessions: [session({ agentState: "working" })] });
    expect(
      working.container.querySelector(
        '[data-worktree-card-status-slot] [aria-label="Working"]',
      ),
    ).not.toBeNull();
    working.unmount();
    const quiet = renderCard({ sessions: [session({ agentState: "idle" })] });
    // A quiet card states its condition in the sentence; the lane keeps only
    // the status ring, so no state glyph competes with it.
    expect(
      quiet.container.querySelector(
        '[data-worktree-card-status-slot] [aria-label="Idle"]',
      ),
    ).toBeNull();
  });
});

describe("card status ring", () => {
  test("draws the workspace status with its own icon and colour", () => {
    const { container } = renderCard({
      sessions: [session()],
      statusId: "in-review",
    });
    const ring = container.querySelector(
      '[data-worktree-card-status-slot] [role="img"]',
    ) as HTMLElement;
    expect(ring.getAttribute("aria-label")).toBe("Status In review");
    // The status' own colour tone travels with the definition (kanban
    // workspace-status.ts), so the card and the board cannot drift.
    expect(ring.className).toContain("text-[#16a34a]");
  });

  test("no status is the dashed neutral ring, never a status the owner did not set", () => {
    const { container } = renderCard({ sessions: [session()], statusId: null });
    const ring = container.querySelector(
      '[data-worktree-card-status-slot] [role="img"]',
    ) as HTMLElement;
    expect(ring.getAttribute("aria-label")).toBe("No status");
    expect(
      ring.querySelector(".border-dashed"),
      "the unset ring reads as its own state",
    ).not.toBeNull();
  });

  test("a status id this profile no longer defines degrades to no status", () => {
    const { container } = renderCard({
      sessions: [session()],
      statusId: "deleted-status",
    });
    expect(
      container
        .querySelector('[data-worktree-card-status-slot] [role="img"]')!
        .getAttribute("aria-label"),
    ).toBe("No status");
  });
});

describe("card fold", () => {
  test("the card chevron folds the agent list and keeps the sentence", () => {
    const { container } = renderCard({
      sessions: [session({ id: "a", agentState: "working" })],
    });
    expect(
      container.querySelector('[data-worktree-agent-row="a"]'),
    ).not.toBeNull();
    const fold = container.querySelector(
      ".shell-worktree-card-fold",
    ) as HTMLButtonElement;
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(fold);
    expect(container.querySelector('[data-worktree-agent-row="a"]')).toBeNull();
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    // A folded card still says what its agents are doing.
    expect(
      container.querySelector(".shell-worktree-card-sentence")?.textContent,
    ).toBe("1 AGENT WORKING");
  });

  test("the fold survives a renderer reload", () => {
    const first = renderCard({
      sessions: [session({ id: "a", agentState: "working" })],
    });
    fireEvent.click(first.container.querySelector(".shell-worktree-card-fold")!);
    expect(
      first.container.querySelector('[data-worktree-agent-row="a"]'),
    ).toBeNull();
    first.unmount();
    // A reload empties the module cache but keeps localStorage.
    resetWorktreeAgentExpansionMemoryForTests();
    const second = renderCard({ sessions: [session({ id: "a" })] });
    expect(
      second.container.querySelector('[data-worktree-agent-row="a"]'),
    ).toBeNull();
    fireEvent.click(second.container.querySelector(".shell-worktree-card-fold")!);
    expect(
      second.container.querySelector('[data-worktree-agent-row="a"]'),
    ).not.toBeNull();
  });

  test("folding one card leaves another card's list alone", () => {
    const first = renderCard({
      sessions: [session({ id: "a" })],
      worktreeOverrides: { id: "wt-a" },
    });
    const second = renderCard({
      sessions: [session({ id: "a" })],
      worktreeOverrides: { id: "wt-b" },
    });
    fireEvent.click(first.container.querySelector(".shell-worktree-card-fold")!);
    expect(
      first.container.querySelector('[data-worktree-agent-row="a"]'),
    ).toBeNull();
    expect(
      second.container.querySelector('[data-worktree-agent-row="a"]'),
    ).not.toBeNull();
  });
});

describe("agent tree labels", () => {
  test("only a root that owns subagents reads MAIN, and every row states its condition", () => {
    const { container } = renderCard({
      sessions: [
        session({ id: "root", agentState: "working" }),
        session({ id: "child", parentSessionId: "root", agentState: "idle" }),
        session({ id: "lone", agentState: "idle" }),
      ],
    });
    const mainBadges = container.querySelectorAll(
      ".shell-worktree-agent-main-badge",
    );
    expect(mainBadges).toHaveLength(1);
    expect(
      mainBadges[0].closest("[data-worktree-agent-row]")?.getAttribute(
        "data-worktree-agent-row",
      ),
    ).toBe("root");
    // A long, truncated name must not swallow the badge: it lives in the
    // identity group beside the truncating primary, not inside it.
    const badge = mainBadges[0];
    expect(badge.closest(".shell-worktree-agent-identity")).not.toBeNull();
    expect(badge.closest("[data-worktree-agent-primary]")).toBeNull();
    // Each row states its own condition in words, main rows included.
    // Tree order: the lone root, then the root that owns the child, then
    // the child nested under it.
    const labels = [...container.querySelectorAll(".shell-worktree-agent-state")].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(["Idle", "Working", "Idle"]);
    expect(
      container
        .querySelector('[data-worktree-agent-row="child"]')!
        .closest('[role="treeitem"]')!
        .getAttribute("aria-level"),
    ).toBe("2");
    expect(
      container.querySelector('[data-worktree-agent-state="working"]'),
    ).not.toBeNull();
  });

  test("a session that never reported says how long the silence has run, exactly once", () => {
    const { container } = renderCard({
      sessions: [
        session({
          id: "quiet",
          agentState: undefined,
          agentStateAt: "2026-09-08T11:00:00.000Z",
        }),
      ],
    });
    const row = container.querySelector(
      '[data-worktree-agent-row="quiet"]',
    ) as HTMLElement;
    const label = row.querySelector(".shell-worktree-agent-state-label")
      ?.textContent;
    expect(label).toMatch(/^No update in /);
    // The freshness report is the row's state text; the age column must not
    // print the same duration a second time.
    expect(row.textContent?.match(/No update in /g)?.length).toBe(1);
    expect(row.querySelector("[data-worktree-agent-age]")).toBeNull();
  });

  test("a row that knows its state keeps both the state and the age", () => {
    const { container } = renderCard({
      sessions: [
        session({
          id: "working",
          agentState: "working",
          agentStateAt: "2026-09-08T11:59:00.000Z",
        }),
      ],
    });
    const row = container.querySelector(
      '[data-worktree-agent-row="working"]',
    ) as HTMLElement;
    expect(row.querySelector(".shell-worktree-agent-state-label")?.textContent).toBe(
      "Working",
    );
    // "Working" and when it last reported are two different facts.
    expect(
      row.querySelector("[data-worktree-agent-age]")?.textContent,
    ).toMatch(/^\d+[mhd]$/);
  });
});

describe("review marker", () => {
  test.each([
    [{ state: "merged" } as const, "merged", "Linked PR #7: Merged"],
    [{ state: "open", mergeable: "CONFLICTING" } as const, "conflicts", "Linked PR #7: Conflicts with the base branch"],
    [{ state: "draft" } as const, "draft", "Linked PR #7: Draft"],
    [{ state: "open" } as const, "ready", "Linked PR #7: Open"],
  ])("draws %s as %s", (prFields, state, label) => {
    const { container } = renderCard({
      sessions: [session()],
      pr: { provider: "github", number: 7, title: "Fix it", ...prFields },
    });
    const icon = container.querySelector(
      "[data-worktree-card-pr-state]",
    ) as HTMLElement;
    expect(icon.getAttribute("data-worktree-card-pr-state")).toBe(state);
    expect(icon.getAttribute("aria-label")).toBe(label);
  });

  test("no linked review draws nothing rather than a placeholder", () => {
    const { container } = renderCard({ sessions: [session()], pr: null });
    expect(container.querySelector("[data-worktree-card-pr-state]")).toBeNull();
  });
});

describe("concise row identity", () => {
  const PROMPT = "Fix the sidebar card order for real";
  const generated = deriveGeneratedTabTitle(PROMPT) ?? PROMPT;

  function conciseRow(overrides: Partial<WorktreeAgentRowData> = {}) {
    const base = session({
      id: "gen-1",
      harnessId: "pi",
      agentState: "working",
      agentStateAt: "2026-09-08T11:59:00.000Z",
      agentPromptPreview: PROMPT,
    });
    return {
      session: base,
      state: "working",
      title: generated,
      secondary: "Pi",
      stateLabel: "Working",
      relativeTime: "1m",
      focused: false,
      ...overrides,
    } as WorktreeAgentRowData;
  }

  test("a prompt-derived title folds back to the provider name", () => {
    const identity = resolveRowConciseIdentity(conciseRow(), {
      customTitle: null,
      generatedTitle: generated,
    });
    expect(identity?.primary).toBe("Pi");
    expect(identity?.secondary).toContain("Fix the sidebar card order");
  });

  test("an explicit rename, a missing generated title, and plain shells render verbatim", () => {
    // The user's own rename wins over the fold-back.
    expect(
      resolveRowConciseIdentity(conciseRow(), {
        customTitle: "My custom name",
        generatedTitle: generated,
      }),
    ).toBeNull();
    // No generated title means the title is already concise.
    expect(
      resolveRowConciseIdentity(conciseRow(), {
        customTitle: null,
        generatedTitle: null,
      }),
    ).toBeNull();
    // A generated title that did not produce this row's title is ignored.
    expect(
      resolveRowConciseIdentity(conciseRow(), {
        customTitle: null,
        generatedTitle: "Some other title",
      }),
    ).toBeNull();
    // Plain shells already read `Terminal N`.
    const shell = session({ id: "sh", harnessId: null });
    expect(
      resolveRowConciseIdentity(
        conciseRow({ session: shell, title: "Terminal 1" }),
        { customTitle: null, generatedTitle: "Terminal 1" },
      ),
    ).toBeNull();
  });

  test("title provenance changes the memo comparison", () => {
    const base: WorktreeAgentRowProps = {
      row: conciseRow(),
      disabled: false,
      onSelect: () => {},
    };
    expect(
      areWorktreeAgentRowPropsEqual(base, { ...base, onSelect: () => {} }),
    ).toBe(true);
    expect(
      areWorktreeAgentRowPropsEqual(base, {
        ...base,
        generatedTitle: generated,
      }),
    ).toBe(false);
    expect(
      areWorktreeAgentRowPropsEqual(
        { ...base, generatedTitle: generated },
        { ...base, generatedTitle: generated, customTitle: "Mine" },
      ),
    ).toBe(false);
  });

  test("the card shows the provider name with the prompt kept in the tooltip", () => {
    window.localStorage.setItem(
      "drogon:agent-generated-titles:v1",
      JSON.stringify({ "gen-1": generated }),
    );
    const { container } = renderCard({
      sessions: [
        session({
          id: "gen-1",
          harnessId: "pi",
          agentState: "working",
          agentStateAt: "2026-09-08T11:59:00.000Z",
          agentPromptPreview: PROMPT,
        }),
      ],
    });
    const row = container.querySelector(
      '[data-worktree-agent-row="gen-1"]',
    ) as HTMLElement;
    // The visible identity group leads with the concise provider identity.
    const primary = row.querySelector(
      "[data-worktree-agent-primary]",
    ) as HTMLElement;
    expect(primary?.textContent).toBe("Pi");
    // The full prompt-derived title is preserved for tooltip/announcement.
    expect(row.getAttribute("title")).toContain(generated);
  });

  test("an explicit rename still renders verbatim on the card", () => {
    window.localStorage.setItem(
      "drogon:agent-generated-titles:v1",
      JSON.stringify({ "ren-1": generated }),
    );
    const { container } = renderCard({
      sessions: [
        session({
          id: "ren-1",
          harnessId: "pi",
          agentState: "working",
          agentStateAt: "2026-09-08T11:59:00.000Z",
          agentPromptPreview: PROMPT,
        }),
      ],
      tabStrip: { ...EMPTY_TAB_STRIP_STATE, titles: { "ren-1": "My custom name" } },
    });
    const row = container.querySelector(
      '[data-worktree-agent-row="ren-1"]',
    ) as HTMLElement;
    const primary = row.querySelector(
      "[data-worktree-agent-primary]",
    ) as HTMLElement;
    expect(primary?.textContent).toBe("My custom name");
  });
});

describe("right-slot affordances", () => {
  test("no generic branch glyph poses as the review indicator", () => {
    const { container } = renderCard({ sessions: [session({ id: "a" })] });
    // The session marker stays; the branch glyph is gone (the branch reads
    // as text in the meta row, the right slot keeps the real PR icon).
    expect(
      container.querySelector("[data-worktree-card-affordances]"),
    ).not.toBeNull();
    expect(
      container.querySelector(".shell-worktree-card-affordance-branch"),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-worktree-card-affordances] svg.lucide-git-branch',
      ),
    ).toBeNull();
  });

  test("a card with no sessions draws no affordance cluster", () => {
    const { container } = renderCard({ sessions: [] });
    expect(
      container.querySelector("[data-worktree-card-affordances]"),
    ).toBeNull();
  });
});

describe("sidebar provider branding", () => {
  test("the sidebar reads Claude Code while the shared label stays Claude", () => {
    expect(formatSidebarProviderLabel("claude")).toBe("Claude Code");
    expect(formatRowHarnessLabel("claude")).toBe("Claude");
    expect(formatSidebarProviderLabel("pi")).toBe("Pi");
    expect(formatSidebarProviderLabel("codex")).toBe("Codex");
    expect(formatSidebarProviderLabel("opencode")).toBe("OpenCode");
    expect(formatSidebarProviderLabel(null)).toBe("Shell");
  });

  test("an actual default harness title renders the sidebar branding", () => {
    // An observed-Claude session whose title is exactly F1's default label
    // (no generated-title record, no rename) reads "Claude Code" — this is
    // the real default-title path, not the generatedTitles test prop.
    const observed = session({
      id: "obs-1",
      harnessId: null,
      observedHarnessId: "claude",
    });
    const row = {
      session: observed,
      state: "idle",
      title: "Claude",
      secondary: "",
      stateLabel: "Idle",
      relativeTime: "now",
      focused: false,
    } as WorktreeAgentRowData;
    expect(
      resolveRowDisplayPrimary(row, { customTitle: null, generatedTitle: null }),
    ).toBe("Claude Code");
  });

  test("explicit renames and plain shells render verbatim", () => {
    const observed = session({
      id: "obs-1",
      harnessId: null,
      observedHarnessId: "claude",
    });
    const row = {
      session: observed,
      state: "idle",
      title: "My custom name",
      secondary: "",
      stateLabel: "Idle",
      relativeTime: "now",
      focused: false,
    } as WorktreeAgentRowData;
    expect(
      resolveRowDisplayPrimary(row, {
        customTitle: "My custom name",
        generatedTitle: null,
      }),
    ).toBe("My custom name");
    const shell = session({ id: "sh", harnessId: null });
    const shellRow = {
      session: shell,
      state: "idle",
      title: "Terminal 1",
      secondary: "zsh",
      stateLabel: "Idle",
      relativeTime: "now",
      focused: false,
    } as WorktreeAgentRowData;
    expect(
      resolveRowDisplayPrimary(shellRow, {
        customTitle: null,
        generatedTitle: null,
      }),
    ).toBe("Terminal 1");
  });

  test("an observed-Claude card reads Claude Code with no generated titles stored", () => {
    const { container } = renderCard({
      sessions: [
        session({
          id: "obs-1",
          harnessId: null,
          observedHarnessId: "claude",
          agentState: "idle",
          agentStateAt: "2026-09-08T11:59:00.000Z",
        }),
      ],
    });
    const primary = container.querySelector(
      '[data-worktree-agent-row="obs-1"] [data-worktree-agent-primary]',
    );
    expect(primary?.textContent).toBe("Claude Code");
  });
});

describe("provider width budget", () => {
  // Structural half of the 280px regression: the layout rules that keep a
  // provider name readable live in classes jsdom cannot measure, so these
  // tests pin the structure (protected identity group, yielding secondary,
  // non-shrinking tail in DOM order) while the rendered half — real
  // bounding boxes at 280px — is asserted over CDP in
  // scripts/accept-sidebar-agent-tree.mjs, which fails on the old
  // single-truncate-span layout.
  function multiProviderCard() {
    return renderCard({
      sessions: [
        session({
          id: "pi-root",
          harnessId: "pi",
          agentState: "working",
          agentStateAt: "2026-09-08T11:59:00.000Z",
        }),
        session({
          id: "codex-child",
          parentSessionId: "pi-root",
          harnessId: "codex",
          agentState: "idle",
          agentStateAt: "2026-09-08T11:58:00.000Z",
        }),
        session({
          id: "claude-child",
          parentSessionId: "pi-root",
          harnessId: null,
          observedHarnessId: "claude",
          agentState: undefined,
          agentStateAt: "2026-09-08T11:00:00.000Z",
        }),
      ],
    });
  }

  test("every provider name reads whole with MAIN and its own state", () => {
    const { container } = multiProviderCard();
    expect(
      container.querySelector(
        '[data-worktree-agent-row="pi-root"] [data-worktree-agent-primary]',
      )?.textContent,
    ).toBe("Pi");
    expect(
      container.querySelector(
        '[data-worktree-agent-row="codex-child"] [data-worktree-agent-primary]',
      )?.textContent,
    ).toBe("Codex");
    expect(
      container.querySelector(
        '[data-worktree-agent-row="claude-child"] [data-worktree-agent-primary]',
      )?.textContent,
    ).toBe("Claude Code");
    // MAIN marks the genuine root-with-children only.
    const badges = [...container.querySelectorAll(".shell-worktree-agent-main-badge")];
    expect(badges).toHaveLength(1);
    expect(
      badges[0].closest("[data-worktree-agent-row]")?.getAttribute(
        "data-worktree-agent-row",
      ),
    ).toBe("pi-root");
    // Every row states its own condition, main rows included.
    for (const id of ["pi-root", "codex-child", "claude-child"]) {
      const label = container.querySelector(
        `[data-worktree-agent-row="${id}"] .shell-worktree-agent-state-label`,
      );
      expect(label?.textContent?.length).toBeGreaterThan(0);
    }
    expect(
      container.querySelector(
        '[data-worktree-agent-row="claude-child"] .shell-worktree-agent-state-label',
      )?.textContent,
    ).toMatch(/^No update in /);
  });

  test("the tail follows the identity in DOM order and never shrinks away", () => {
    const { container } = multiProviderCard();
    for (const id of ["pi-root", "codex-child", "claude-child"]) {
      const row = container.querySelector(
        `[data-worktree-agent-row="${id}"]`,
      ) as HTMLElement;
      const identity = row.querySelector(".shell-worktree-agent-identity");
      const tail = row.querySelector(".shell-worktree-agent-tail");
      expect(identity).not.toBeNull();
      expect(tail).not.toBeNull();
      // The state group renders after the identity group, pushed right, so
      // a tight row wraps the state below instead of clipping the name.
      expect(
        identity!.compareDocumentPosition(tail!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);
      expect(tail!.className).toContain("shell-worktree-agent-tail");
      // The secondary (when present) is its own truncating item between
      // identity and tail — never inside the identity group.
      const secondary = row.querySelector("[data-worktree-agent-secondary]");
      if (secondary) {
        expect(
          secondary.closest(".shell-worktree-agent-identity"),
        ).toBeNull();
      }
    }
  });

  test("a long rename truncates inside the identity while MAIN and state stay", () => {
    const { container } = renderCard({
      sessions: [
        session({
          id: "long-1",
          harnessId: "pi",
          agentState: "working",
          agentStateAt: "2026-09-08T11:59:00.000Z",
        }),
      ],
      tabStrip: {
        ...EMPTY_TAB_STRIP_STATE,
        titles: {
          "long-1":
            "A very long explicit user rename that cannot fit beside a state label",
        },
      },
    });
    const row = container.querySelector(
      '[data-worktree-agent-row="long-1"]',
    ) as HTMLElement;
    const primary = row.querySelector(
      "[data-worktree-agent-primary]",
    ) as HTMLElement;
    expect(primary?.textContent).toContain("A very long explicit user rename");
    expect(primary?.className).toContain("shell-worktree-agent-primary");
    expect(row.getAttribute("title")).toContain(
      "A very long explicit user rename",
    );
    expect(
      row.querySelector(".shell-worktree-agent-state-label")?.textContent,
    ).toBe("Working");
  });
});

describe("creator provenance", () => {
  test("cli provenance is a compact pill, not a full-strength line", () => {
    const { container } = renderCard({
      sessions: [session({ id: "a" })],
      worktreeOverrides: { creator: "cli" },
    });
    const pill = container.querySelector(
      ".shell-worktree-card-provenance",
    ) as HTMLElement;
    expect(pill?.textContent).toBe("Drogon CLI");
    // The same fact no longer repeats as a bright mono metadata badge.
    const issues = [
      ...container.querySelectorAll(".shell-worktree-card-issue"),
    ].map((node) => node.textContent);
    expect(issues).not.toContain("Drogon CLI");
  });

  test("the cli property toggle still hides the provenance pill", () => {
    const { container } = renderCard({
      sessions: [session({ id: "a" })],
      worktreeOverrides: { creator: "cli" },
      showProperties: { cli: false },
    });
    expect(
      container.querySelector(".shell-worktree-card-provenance"),
    ).toBeNull();
  });
});
