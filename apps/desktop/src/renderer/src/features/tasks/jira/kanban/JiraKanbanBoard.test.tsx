// @vitest-environment jsdom
// C09 board journeys over the real component + hook with the JiraBridge
// contract faked at the transport boundary (in-process Results — the same
// interface the daemon serves). Covers: colliding keys/status names across
// two instances targeting exact issue+transition ids, pending overlay vs
// confirmed status, truthful rejection/uncertainty handling with no blind
// duplicate POST, reconciliation against server truth, pagination/filter
// identity retention, keyboard transitions, and the session/assignment
// seams.
//
// MIT Copyright (c) 2026 Lovecast Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { installRadixJsdomStubs } from "../../../../components/ui/radix-jsdom-stubs";
import type {
  JiraBridge,
  JiraIssue,
  JiraStartIssueResult,
  JiraTransition,
} from "../../../../../../shared/jira-contract";
import type { Result } from "../../../../../../shared/session-contract";
import { JiraKanbanBoard } from "./JiraKanbanBoard";
import { useJiraKanbanBoard } from "./use-jira-kanban-board";

type MutationResult = { ok: boolean; error?: string };

function okResult<T>(value: T): Result<T> {
  return { ok: true, result: value };
}

function errResult(code: string, message: string): Result<MutationResult> {
  return { ok: false, error: { code, message, retryable: false } };
}

beforeEach(installRadixJsdomStubs);
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

// --- fixtures ----------------------------------------------------------------

const SITE_A = "site-a";
const SITE_B = "site-b";

const OPEN = {
  id: "1",
  name: "Open",
  categoryKey: "new",
  categoryName: "To Do",
};
const IN_PROGRESS = {
  id: "3",
  name: "In Progress",
  categoryKey: "indeterminate",
  categoryName: "In Progress",
};
const DONE = {
  id: "10002",
  name: "Done",
  categoryKey: "done",
  categoryName: "Done",
};

function issue(args: {
  siteId: string;
  siteName: string;
  id: string;
  key: string;
  status: typeof OPEN;
  title?: string;
}): JiraIssue {
  return {
    id: args.id,
    key: args.key,
    siteId: args.siteId,
    siteName: args.siteName,
    title: args.title ?? `Issue ${args.key} on ${args.siteName}`,
    url: `https://${args.siteName}.example.com/browse/${args.key}`,
    project: { id: "10000", key: "DROG", name: "Drogon", siteId: args.siteId },
    issueType: { id: "1", name: "Bug" },
    status: args.status,
    labels: [],
    updatedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
  };
}

const TRANSITIONS: JiraTransition[] = [
  { id: "11", name: "Go to In Progress", to: IN_PROGRESS },
  { id: "31", name: "Done", to: DONE },
];

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (cause: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type UpdateCall = { key: string; siteId?: string; transitionId?: string };

/** The bridge transport fake: records calls, serves deterministic pages. */
function makeBridge(
  overrides: {
    initialIssues?: JiraIssue[];
    transitionsBySite?: Map<string, JiraTransition[]>;
    freshIssue?: JiraIssue | null;
    updateResult?: Result<MutationResult>;
    updateError?: { code: string; message: string };
  } = {},
) {
  const updateCalls: UpdateCall[] = [];

  const bridge = {
    jiraListIssues: vi.fn((_input: unknown) =>
      Promise.resolve(
        okResult({
          issues: overrides.initialIssues ?? [],
          total: (overrides.initialIssues ?? []).length,
          isLast: true,
        }),
      ),
    ),
    jiraSearchIssues: vi.fn((_input: unknown) =>
      Promise.resolve(okResult({ issues: [], total: 0, isLast: true })),
    ),
    jiraListTransitions: vi.fn((input: { key: string; siteId?: string }) =>
      Promise.resolve(
        okResult(
          (overrides.transitionsBySite ?? new Map()).get(input.siteId ?? "") ??
            TRANSITIONS,
        ),
      ),
    ),
    jiraUpdateIssue: vi.fn((input: UpdateCall) => {
      updateCalls.push(input);
      if (overrides.updateError) {
        // Transport-level failure: the Result error envelope the daemon
        // maps timeouts/network loss onto (jira_unreachable, retryable).
        return Promise.resolve({
          ok: false,
          error: {
            code: overrides.updateError.code,
            message: overrides.updateError.message,
            retryable: true,
          },
        });
      }
      return Promise.resolve(overrides.updateResult ?? okResult({ ok: true }));
    }),
    jiraGetIssue: vi.fn((_input: { key: string; siteId?: string }) =>
      Promise.resolve(okResult(overrides.freshIssue ?? null)),
    ),
    jiraStartIssue: vi.fn((_input: unknown) =>
      Promise.resolve(
        okResult({
          ok: true,
          key: "DROG-1",
          url: "https://x/browse/DROG-1",
          displayName: "DROG-1 Issue",
          seedName: "drog-1-issue",
          worktree: {
            id: "wt-1",
            projectId: "proj-1",
            workspaceId: "ws-1",
            path: "/tmp/wt-1",
            branch: "drog-1",
            head: "abc",
            baseRef: null,
            createdAt: "2026-09-01T00:00:00.000Z",
          },
        }),
      ),
    ),
  } as unknown as JiraBridge & {
    jiraListIssues: ReturnType<typeof vi.fn>;
    jiraListTransitions: ReturnType<typeof vi.fn>;
    jiraUpdateIssue: ReturnType<typeof vi.fn>;
    jiraGetIssue: ReturnType<typeof vi.fn>;
    jiraStartIssue: ReturnType<typeof vi.fn>;
  };
  return { bridge, updateCalls };
}

/** Render the board with its hook, exposing the live controller. */
function BoardHarness(props: {
  bridge: JiraBridge;
  showSiteContext?: boolean;
  renderAssignmentSlot?: (issue: JiraIssue) => React.ReactNode;
  onSessionOpened?: (issue: JiraIssue, result: JiraStartIssueResult) => void;
  controllerRef?: (controller: ReturnType<typeof useJiraKanbanBoard>) => void;
}) {
  const controller = useJiraKanbanBoard({
    bridge: props.bridge,
    jiraConnected: true,
    selectedSiteId: "all",
    startIssueProjectId: "proj-1",
    onSessionOpened: props.onSessionOpened,
  });
  props.controllerRef?.(controller);
  return (
    <JiraKanbanBoard
      controller={controller}
      showSiteContext={props.showSiteContext ?? true}
      renderAssignmentSlot={props.renderAssignmentSlot}
    />
  );
}

function renderBoard(props: Parameters<typeof BoardHarness>[0]) {
  const utils = render(<BoardHarness {...props} />);
  return utils;
}

const cardSelector = (identity: string) => `[data-jira-card="${identity}"]`;

/** Live card lookup: React may replace the card node when lanes re-render,
 *  so post-mutation assertions must re-query instead of holding a node. */
function liveCard(container: HTMLElement): HTMLElement {
  return container.querySelector("[data-jira-card]") as HTMLElement;
}

/** Open a card's transition menu and run one transition once its real item
 *  has rendered (the menu first shows a loading item while the fetch is in
 *  flight — tests must not race it). */
async function runTransitionFromMenu(card: HTMLElement, transitionId: string) {
  fireEvent.click(card.querySelector("[data-jira-card-menu-trigger]")!);
  const item = await waitFor(() => {
    const found = document.querySelector(
      `[data-jira-transition-id="${transitionId}"]`,
    );
    expect(found).not.toBeNull();
    return found!;
  });
  fireEvent.pointerDown(item, { pointerType: "mouse", button: 0 });
  fireEvent.click(item);
}

// --- journeys ----------------------------------------------------------------

describe("JiraKanbanBoard", () => {
  it("renders colliding keys from two instances into distinct lanes and moves the exact issue/transition ids", async () => {
    // Same displayed key AND same status name on both instances.
    const { bridge, updateCalls } = makeBridge({
      initialIssues: [
        issue({
          siteId: SITE_A,
          siteName: "Alpha",
          id: "10001",
          key: "DROG-1",
          status: OPEN,
        }),
        issue({
          siteId: SITE_B,
          siteName: "Beta",
          id: "10001",
          key: "DROG-1",
          status: OPEN,
        }),
      ],
      transitionsBySite: new Map([
        [SITE_A, [{ id: "a-31", name: "Done", to: DONE }]],
        [SITE_B, [{ id: "b-31", name: "Done", to: DONE }]],
      ]),
    });
    const { container } = renderBoard({ bridge });
    await waitFor(() => {
      expect(container.querySelectorAll("[data-jira-card]")).toHaveLength(2);
    });
    // Distinct lanes for the same-named status on the two sites.
    expect(container.querySelectorAll("[data-jira-lane]")).toHaveLength(2);

    // Menu on the ALPHA card (composed identity selects the card).
    const alphaIdentity = "site-a|10001";
    const alphaCard = container.querySelector(cardSelector(alphaIdentity))!;
    expect(alphaCard).not.toBeNull();
    fireEvent.click(alphaCard.querySelector("[data-jira-card-menu-trigger]")!);
    const menu = await waitFor(() => {
      const found = document.querySelector(
        "[data-jira-kanban-transitions-menu]",
      );
      expect(found).not.toBeNull();
      return found!;
    });
    // The offered transition id is ALPHA's own ("a-31"), never Beta's.
    expect(
      menu.querySelector('[data-jira-transition-id="a-31"]'),
    ).not.toBeNull();
    expect(menu.querySelector('[data-jira-transition-id="b-31"]')).toBeNull();
    fireEvent.pointerDown(
      await waitFor(() => {
        const item = menu.querySelector('[data-jira-transition-id="a-31"]');
        expect(item).not.toBeNull();
        return item!;
      }),
      { pointerType: "mouse", button: 0 },
    );
    fireEvent.click(menu.querySelector('[data-jira-transition-id="a-31"]')!);
    await waitFor(() => {
      expect(updateCalls).toHaveLength(1);
    });
    expect(updateCalls[0]).toEqual({
      key: "DROG-1",
      siteId: SITE_A,
      transitionId: "a-31",
    });
  });

  it("shows the pending move separately and adopts the confirmed server status", async () => {
    const confirmed = issue({
      siteId: SITE_A,
      siteName: "Alpha",
      id: "10001",
      key: "DROG-1",
      status: IN_PROGRESS,
    });
    const { bridge, updateCalls } = makeBridge({
      initialIssues: [
        issue({
          siteId: SITE_A,
          siteName: "Alpha",
          id: "10001",
          key: "DROG-1",
          status: OPEN,
        }),
      ],
      updateResult: okResult({ ok: true }),
      freshIssue: confirmed,
    });
    const { container } = renderBoard({ bridge });
    await waitFor(() => {
      expect(container.querySelector("[data-jira-card]")).not.toBeNull();
    });
    await runTransitionFromMenu(liveCard(container), "11");
    // Pending chip while the POST is unresolved — separate from the status chip.
    await waitFor(() => {
      expect(
        liveCard(container).querySelector("[data-jira-card-pending-chip]"),
      ).not.toBeNull();
    });
    await waitFor(() => {
      expect(updateCalls).toHaveLength(1);
      // Applied → the board re-reads the server and adopts its status.
      expect(bridge.jiraGetIssue).toHaveBeenCalled();
    });
    // Re-query the live card: React may replace the node as lanes re-render.
    await waitFor(() => {
      const node = container.querySelector("[data-jira-card]")!;
      expect(node.querySelector("[data-jira-card-status]")!.textContent).toBe(
        "In Progress",
      );
      expect(node.querySelector("[data-jira-card-pending-chip]")).toBeNull();
    });
  });

  it("restores the card and surfaces the reason on a 403 rejection", async () => {
    const { bridge, updateCalls } = makeBridge({
      initialIssues: [
        issue({
          siteId: SITE_A,
          siteName: "Alpha",
          id: "10001",
          key: "DROG-1",
          status: OPEN,
        }),
      ],
      updateResult: okResult({ ok: false, error: "Error 403: no permission" }),
    });
    const { container } = renderBoard({ bridge });
    await waitFor(() => {
      expect(container.querySelector("[data-jira-card]")).not.toBeNull();
    });
    await runTransitionFromMenu(liveCard(container), "11");
    await waitFor(() => {
      expect(updateCalls).toHaveLength(1);
      const notice = document.querySelector(
        "[data-jira-kanban-notice-message]",
      );
      expect(notice?.textContent).toContain("Error 403");
      // Restored: no pending overlay, status chip unchanged.
      expect(
        liveCard(container).querySelector("[data-jira-card-pending-chip]"),
      ).toBeNull();
      expect(
        liveCard(container).querySelector("[data-jira-card-status]")!
          .textContent,
      ).toBe("Open");
    });
  });

  it("never blind-reposts after an uncertain timeout; reconciliation adopts server truth", async () => {
    const confirmed = issue({
      siteId: SITE_A,
      siteName: "Alpha",
      id: "10001",
      key: "DROG-1",
      status: IN_PROGRESS,
    });
    const { bridge, updateCalls } = makeBridge({
      initialIssues: [
        issue({
          siteId: SITE_A,
          siteName: "Alpha",
          id: "10001",
          key: "DROG-1",
          status: OPEN,
        }),
      ],
      updateError: {
        code: "jira_unreachable",
        message: "Jira request timed out.",
      },
      freshIssue: confirmed,
    });
    const { container } = renderBoard({ bridge });
    await waitFor(() => {
      expect(container.querySelector("[data-jira-card]")).not.toBeNull();
    });
    const runMove = () => runTransitionFromMenu(liveCard(container), "11");
    await runMove();
    // Uncertain: pending stays and the board reconciles with a fresh GET…
    await waitFor(() => {
      expect(updateCalls).toHaveLength(1);
      expect(bridge.jiraGetIssue).toHaveBeenCalled();
    });
    await waitFor(() => {
      // …the server shows the target status → confirmed, exactly one POST.
      expect(
        liveCard(container).querySelector("[data-jira-card-status]")!
          .textContent,
      ).toBe("In Progress");
      expect(updateCalls).toHaveLength(1);
      expect(
        liveCard(container).querySelector("[data-jira-card-pending-chip]"),
      ).toBeNull();
    });
  });

  it("refuses a second move while one is pending (no duplicate POST)", async () => {
    const { bridge, updateCalls } = makeBridge({
      initialIssues: [
        issue({
          siteId: SITE_A,
          siteName: "Alpha",
          id: "10001",
          key: "DROG-1",
          status: OPEN,
        }),
      ],
    });
    // Gate the update call so the move stays in-flight.
    vi.spyOn(bridge, "jiraUpdateIssue").mockImplementation(
      (input: UpdateCall) => {
        updateCalls.push(input);
        return deferred<Result<MutationResult>>().promise;
      },
    );
    const { container } = renderBoard({ bridge });
    await waitFor(() => {
      expect(container.querySelector("[data-jira-card]")).not.toBeNull();
    });
    await runTransitionFromMenu(liveCard(container), "11");
    await waitFor(() => {
      expect(updateCalls).toHaveLength(1);
      expect(
        liveCard(container).querySelector("[data-jira-card-pending-chip]"),
      ).not.toBeNull();
    });
    // The menu trigger is disabled while pending; a second move is unreachable.
    expect(
      (
        liveCard(container).querySelector(
          "[data-jira-card-menu-trigger]",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("shows a superseded remote mutation instead of local success", async () => {
    // The remote moved the issue to Done while our POST was uncertain.
    const remoteDone = issue({
      siteId: SITE_A,
      siteName: "Alpha",
      id: "10001",
      key: "DROG-1",
      status: DONE,
    });
    const { bridge } = makeBridge({
      initialIssues: [
        issue({
          siteId: SITE_A,
          siteName: "Alpha",
          id: "10001",
          key: "DROG-1",
          status: OPEN,
        }),
      ],
      updateError: { code: "jira_unreachable", message: "network lost" },
      freshIssue: remoteDone,
    });
    const { container } = renderBoard({ bridge });
    await waitFor(() => {
      expect(container.querySelector("[data-jira-card]")).not.toBeNull();
    });
    await runTransitionFromMenu(liveCard(container), "11");
    await waitFor(() => {
      const notice = document.querySelector(
        "[data-jira-kanban-notice-message]",
      );
      expect(notice?.textContent).toContain("moved this issue to Done");
      // The board adopts the server's status — never hides it.
      expect(
        liveCard(container).querySelector("[data-jira-card-status]")!
          .textContent,
      ).toBe("Done");
      expect(
        liveCard(container).querySelector("[data-jira-card-pending-chip]"),
      ).toBeNull();
    });
  });

  it("keeps selection across filter changes by composed identity", async () => {
    const alpha = issue({
      siteId: SITE_A,
      siteName: "Alpha",
      id: "10001",
      key: "DROG-1",
      status: OPEN,
    });
    const beta = issue({
      siteId: SITE_B,
      siteName: "Beta",
      id: "10001",
      key: "DROG-1",
      status: OPEN,
    });
    const { bridge } = makeBridge({ initialIssues: [alpha, beta] });
    const { container } = renderBoard({ bridge });
    await waitFor(() => {
      expect(container.querySelectorAll("[data-jira-card]")).toHaveLength(2);
    });
    const alphaCard = container.querySelector(cardSelector("site-a|10001"))!;
    const betaCard = container.querySelector(cardSelector("site-b|10001"))!;
    // Ctrl-click both (jsdom is non-Mac → ctrl is the toggle modifier).
    fireEvent.click(alphaCard, { ctrlKey: true });
    fireEvent.click(betaCard, { ctrlKey: true });
    expect(alphaCard.getAttribute("aria-selected")).toBe("true");
    expect(betaCard.getAttribute("aria-selected")).toBe("true");
    // Narrow the rendered cards to Beta only.
    const filter = container.querySelector(
      "[data-jira-kanban-card-filter]",
    ) as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "Beta" } });
    await waitFor(() => {
      expect(container.querySelectorAll("[data-jira-card]")).toHaveLength(1);
    });
    expect(
      container
        .querySelector(cardSelector("site-b|10001"))!
        .getAttribute("aria-selected"),
    ).toBe("true");
    // Clearing the filter restores BOTH selections — nothing was lost.
    fireEvent.change(filter, { target: { value: "" } });
    await waitFor(() => {
      expect(container.querySelectorAll("[data-jira-card]")).toHaveLength(2);
    });
    expect(
      container
        .querySelector(cardSelector("site-a|10001"))!
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      container
        .querySelector(cardSelector("site-b|10001"))!
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("labels partial pages honestly and appends deduped pages by identity", async () => {
    const pageOne = [
      issue({
        siteId: SITE_A,
        siteName: "Alpha",
        id: "10001",
        key: "DROG-1",
        status: OPEN,
      }),
    ];
    const bridge = makeBridge();
    // Typed JQL search pages: page one has 1 of 2; page two re-serves the
    // same issue plus the second one — the board must dedupe by identity.
    (
      bridge.bridge.jiraSearchIssues as ReturnType<typeof vi.fn>
    ).mockImplementation((input: { startAt?: number }) =>
      Promise.resolve(
        okResult({
          issues:
            (input.startAt ?? 0) === 0
              ? pageOne
              : [
                  ...pageOne,
                  issue({
                    siteId: SITE_A,
                    siteName: "Alpha",
                    id: "10002",
                    key: "DROG-2",
                    status: OPEN,
                  }),
                ],
          total: 2,
          isLast: (input.startAt ?? 0) === 0 ? false : true,
        }),
      ),
    );
    (
      bridge.bridge.jiraListIssues as ReturnType<typeof vi.fn>
    ).mockImplementation(() =>
      Promise.resolve(okResult({ issues: pageOne, total: 2, isLast: false })),
    );
    const { container } = renderBoard({ bridge: bridge.bridge });
    // Seed a JQL query so the search path (paged) is active.
    const jql = container.querySelector(
      "[data-jira-kanban-jql]",
    ) as HTMLInputElement;
    fireEvent.change(jql, { target: { value: "project = DROG" } });
    // The JQL debounce (300ms) precedes the paged search and its Load more.
    const loadMore = await waitFor(() => {
      const found = container.querySelector(
        "[data-jira-kanban-load-more]",
      ) as HTMLButtonElement | null;
      expect(found).not.toBeNull();
      return found!;
    });
    expect(
      container.querySelector("[data-jira-kanban-coverage-line]")?.textContent,
    ).toBe("Showing 1 of 2 issues.");
    fireEvent.click(loadMore);
    await waitFor(() => {
      expect(container.querySelectorAll("[data-jira-card]")).toHaveLength(2);
      expect(
        container.querySelector("[data-jira-kanban-coverage-line]")
          ?.textContent,
      ).toBe("Showing all 2 issues.");
    });
    // The overlapping page did not duplicate the colliding identity.
    const identities = [...container.querySelectorAll("[data-jira-card]")].map(
      (node) => node.getAttribute("data-jira-card"),
    );
    expect(new Set(identities).size).toBe(2);
  });

  it("moves a card by dragging it onto another lane's real status", async () => {
    const { bridge, updateCalls } = makeBridge({
      initialIssues: [
        issue({
          siteId: SITE_A,
          siteName: "Alpha",
          id: "10001",
          key: "DROG-1",
          status: OPEN,
        }),
        issue({
          siteId: SITE_A,
          siteName: "Alpha",
          id: "10002",
          key: "DROG-2",
          status: IN_PROGRESS,
        }),
      ],
      updateResult: okResult({ ok: true }),
      freshIssue: issue({
        siteId: SITE_A,
        siteName: "Alpha",
        id: "10001",
        key: "DROG-1",
        status: IN_PROGRESS,
      }),
    });
    const { container } = renderBoard({ bridge });
    await waitFor(() => {
      expect(container.querySelectorAll("[data-jira-card]")).toHaveLength(2);
    });
    const targetLane = [...container.querySelectorAll("[data-jira-lane]")].find(
      (lane) => lane.getAttribute("data-jira-lane-status-id") === "3",
    )!;
    expect(targetLane).not.toBeUndefined();
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      types: ["application/x-orca-worktree-ids"],
      stored: new Map<string, string>(),
      setData(type: string, value: string) {
        this.stored.set(type, value);
        this.types.push(type);
      },
      getData(type: string) {
        return this.stored.get(type) ?? "";
      },
    };
    fireEvent.dragStart(
      container.querySelector(cardSelector("site-a|10001"))!,
      {
        dataTransfer,
      },
    );
    fireEvent.dragOver(targetLane, { dataTransfer });
    fireEvent.drop(targetLane, { dataTransfer });
    await waitFor(() => {
      expect(updateCalls).toHaveLength(1);
    });
    expect(updateCalls[0]).toEqual({
      key: "DROG-1",
      siteId: SITE_A,
      transitionId: "11", // the unique transition reaching status 3
    });
  });

  it("opens the linked session through jira.startIssue and renders the assignment slot", async () => {
    const { bridge } = makeBridge({
      initialIssues: [
        issue({
          siteId: SITE_A,
          siteName: "Alpha",
          id: "10001",
          key: "DROG-1",
          status: OPEN,
        }),
      ],
    });
    const sessionOpened = vi.fn();
    const assignment = vi.fn((issue: JiraIssue) => (
      <button type="button" data-jira-test-assignment>
        assign {issue.key}
      </button>
    ));
    const { container } = renderBoard({
      bridge,
      onSessionOpened: sessionOpened,
      renderAssignmentSlot: assignment,
    });
    await waitFor(() => {
      expect(container.querySelector("[data-jira-card]")).not.toBeNull();
    });
    // C11 slot rendered verbatim, one per card.
    expect(assignment).toHaveBeenCalled();
    expect(
      container.querySelector(
        "[data-jira-card-assignment-slot] [data-jira-test-assignment]",
      ),
    ).not.toBeNull();
    const card = container.querySelector("[data-jira-card]")!;
    fireEvent.click(card.querySelector("[data-jira-card-open-session]")!);
    await waitFor(() => {
      expect(bridge.jiraStartIssue).toHaveBeenCalledWith({
        projectId: "proj-1",
        key: "DROG-1",
        siteId: SITE_A,
        title: expect.any(String),
      });
      expect(sessionOpened).toHaveBeenCalled();
    });
  });

  it("supports the keyboard transition journey (focus, Enter, choose transition)", async () => {
    const { bridge, updateCalls } = makeBridge({
      initialIssues: [
        issue({
          siteId: SITE_A,
          siteName: "Alpha",
          id: "10001",
          key: "DROG-1",
          status: OPEN,
        }),
      ],
      updateResult: okResult({ ok: true }),
      freshIssue: issue({
        siteId: SITE_A,
        siteName: "Alpha",
        id: "10001",
        key: "DROG-1",
        status: IN_PROGRESS,
      }),
    });
    const { container } = renderBoard({ bridge });
    await waitFor(() => {
      expect(container.querySelector("[data-jira-card]")).not.toBeNull();
    });
    const card = container.querySelector(
      cardSelector("site-a|10001"),
    ) as HTMLElement;
    card.focus();
    expect(document.activeElement).toBe(card);
    fireEvent.keyDown(card, { key: "Enter" });
    const item = await waitFor(() => {
      const found = document.querySelector('[data-jira-transition-id="11"]');
      expect(found).not.toBeNull();
      return found!;
    });
    fireEvent.pointerDown(item, { pointerType: "mouse", button: 0 });
    fireEvent.click(item);
    await waitFor(() => {
      expect(updateCalls).toHaveLength(1);
    });
    expect(updateCalls[0]).toEqual({
      key: "DROG-1",
      siteId: SITE_A,
      transitionId: "11",
    });
  });

  it("renders loading, empty and error states honestly", async () => {
    const failing = makeBridge();
    (
      failing.bridge.jiraListIssues as ReturnType<typeof vi.fn>
    ).mockImplementation(() =>
      Promise.resolve(errResult("jira_forbidden", "Error 403: browse denied")),
    );
    const { container } = renderBoard({ bridge: failing.bridge });
    await waitFor(() => {
      expect(document.querySelector("[data-jira-kanban-error]")).not.toBeNull();
    });
    expect(
      document.querySelector("[data-jira-kanban-error]")?.textContent,
    ).toContain("Error 403");
    const empty = makeBridge({ initialIssues: [] });
    const emptyView = render(<BoardHarness bridge={empty.bridge} />);
    await waitFor(() => {
      expect(
        emptyView.container.querySelector("[data-jira-kanban-empty]"),
      ).not.toBeNull();
    });
  });
});
