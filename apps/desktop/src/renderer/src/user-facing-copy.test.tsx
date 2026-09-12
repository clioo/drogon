// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// The owner retired the word "Mentu" from everything a human sees in the
// running app: the feature's user-facing name is "Work Graph". This file is
// the guard for that decision. It renders the user-visible surfaces that
// carry the feature's name — the tab strip, the "+" create menu, the Work
// Graph tab's right-sidebar panel and the right-sidebar activity bar — and
// fails on any occurrence of /mentu/i that is not on the explicit survivor
// allowlist below. The allowlist is exact-string: identifiers (module names,
// RPC method names, `data-testid`s) never reach it because only rendered
// text and the visible/accessibility attributes are scanned.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tooltip } from "radix-ui";
import type { MentuBridge, MentuRun } from "../../shared/mentu-contract";
import type { Session } from "../../shared/session-contract";
import { installRadixJsdomStubs } from "./components/ui/radix-jsdom-stubs";
import { TabBar } from "./features/shell/TabBar";
import { TabCreateMenu } from "./features/shell/TabCreateMenu";
import { MentuPanel } from "./features/mentu/MentuPanel";
import {
  activityItemAriaLabel,
  buildRightSidebarActivityItems,
} from "./features/right-sidebar/activity-bar-items";

/** Exact strings that may still carry the word. Each entry needs a reason
 *  the owner accepted: it names the EXTERNAL pinned Mentu runtime (a
 *  dependency the product genuinely talks about in host-capability
 *  diagnostics), or it is an identifier-shaped token on disk/wire, not copy. */
const SURVIVOR_STRINGS: ReadonlyArray<{ match: string; why: string }> = [
  {
    match: ".mentu/recipes",
    why: "on-disk recipes directory path; file paths are the daemon's contract",
  },
  {
    match: "mentu.v1",
    why: "daemon capability id (wire protocol)",
  },
  {
    match: "drogon-cli mentu",
    why: "CLI verb invocation; subcommand names are the daemon's contract and stay",
  },
  {
    match: "Mentu Recipes unavailable:",
    why: "labels the external runtime's recipe subsystem when it is missing",
  },
  {
    match: "Mentu Recipes is unavailable on the execution host.",
    why: "host-capability diagnostic about the external runtime",
  },
  {
    match: "Mentu is unavailable on this execution host.",
    why: "host-capability diagnostic about the external runtime",
  },
  {
    match:
      "The optional Mentu runtime is not installed on this host, so recipes can be viewed here but not run.",
    why: "host-capability diagnostic about the pinned runtime binary",
  },
  {
    match:
      "A Mentu runtime exists on this host but does not match the approved runtime lock.",
    why: "host-capability diagnostic about the pinned runtime binary",
  },
];

const ok = <T,>(result: T) => ({ ok: true as const, result });

/** Everything a screen reader or a human can see in the mounted tree:
 *  rendered text plus the attributes that surface as accessible names or
 *  visible hints. `data-testid`s are deliberately NOT scanned — they are
 *  identifiers tests key on. */
function collectVisibleStrings(): string[] {
  const strings: string[] = [document.body.textContent ?? ""];
  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    for (const attribute of ["aria-label", "title", "placeholder", "alt"]) {
      const value = element.getAttribute(attribute);
      if (value) strings.push(value);
    }
  }
  return strings;
}

/** A /mentu/i match is a violation unless it sits inside an occurrence of a
 *  survivor string. Interval matching keeps the allowlist exact-string: a
 *  new "Mentu" next to (not inside) a survivor still fails. */
function findMentuViolations(strings: string[]): string[] {
  const violations: string[] = [];
  for (const text of strings) {
    const lower = text.toLowerCase();
    const allowed: Array<[number, number]> = [];
    for (const { match } of SURVIVOR_STRINGS) {
      const needle = match.toLowerCase();
      let at = lower.indexOf(needle);
      while (at !== -1) {
        allowed.push([at, at + needle.length]);
        at = lower.indexOf(needle, at + needle.length);
      }
    }
    const re = /mentu/gi;
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      const covered = allowed.some(([start, end]) => at >= start && at < end);
      if (!covered) {
        violations.push(
          text.slice(Math.max(0, at - 60), at + 70).replace(/\s+/g, " ").trim(),
        );
      }
    }
  }
  return violations;
}

function expectNoBannedCopy() {
  const violations = findMentuViolations(collectVisibleStrings());
  expect(violations).toEqual([]);
}

beforeEach(installRadixJsdomStubs);
afterEach(() => {
  cleanup();
  document.body.textContent = "";
});

function stripSession(id: string): Session {
  return {
    id,
    workspaceId: "ws",
    hostId: "host-1",
    incarnation: "inc-1",
    command: "bash",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-07T00:00:00Z",
    harnessId: "claude",
    agentState: "idle",
  };
}

function fakeMentuBridge(): MentuBridge {
  const runningRun: MentuRun = {
    id: "run-1",
    workspaceId: "ws",
    recipeId: "demo",
    approvalId: "approval-1",
    mentuRunId: "run_fixture_1",
    status: "succeeded",
    startedAt: "t",
    endedAt: "t",
    steps: [],
    error: null,
    retryOf: null,
  };
  return {
    mentuRecipes: vi.fn(async () => ok({ recipes: [] })),
    mentuRecipe: vi.fn(async () =>
      ok({
        recipe: {
          id: "demo",
          path: "demo",
          name: "demo",
          description: null,
          contentHash: "h",
          source: "{}",
          steps: [],
        },
      }),
    ),
    mentuRuntime: vi.fn(async () =>
      ok({
        runtime: {
          available: true,
          path: "/bin/mentu-recipes",
          version: "fixture",
          expectedRevision: "r",
          expectedSha256: "s",
          actualSha256: "s",
          lockMatches: true,
          message: null,
        },
      }),
    ),
    mentuApprove: vi.fn(async () =>
      ok({
        approval: {
          id: "approval-1",
          workspaceId: "ws",
          recipeId: "demo",
          contentHash: "h",
          approvedAt: "t",
        },
      }),
    ),
    mentuRun: vi.fn(async () => ok({ run: runningRun })),
    mentuRuns: vi.fn(async () => ok({ runs: [] })),
    mentuRunStatus: vi.fn(async () => ok({ run: runningRun })),
    mentuRetry: vi.fn(async () => ok({ run: runningRun })),
    mentuCancel: vi.fn(async () => ok({ run: runningRun })),
  };
}

describe("user-facing copy: the feature is named Work Graph, never Mentu", () => {
  it("the tab strip labels the tab Work Graph", () => {
    render(
      <Tooltip.Provider>
        <TabBar
          sessions={[stripSession("a")]}
          activeSessionId="a"
          browserTabs={[]}
          activeBrowserTabId={null}
          editorTabs={[]}
          activeEditorTabId={null}
          mentuOpen
          mentuActive
          onSelectMentu={() => {}}
          onCloseMentu={() => {}}
          harnesses={[]}
          workspaceId="ws"
          hostId="host"
          newTerminalShortcut=""
          newBrowserShortcut=""
          closeDisabled={false}
          retryDisabled={false}
          createDisabled={false}
          stripOrder={[]}
          pinnedIds={[]}
          customTitles={{}}
          onOrderChange={() => {}}
          onTogglePin={() => {}}
          onCloseOthers={() => {}}
          onCloseToRight={() => {}}
          onCloseToLeft={() => {}}
          onCommitTitle={() => {}}
          onCopyText={() => {}}
          onSelectSession={() => {}}
          onSelectBrowserTab={() => {}}
          onSelectEditorTab={() => {}}
          onCloseSession={() => {}}
          onCloseBrowserTab={() => {}}
          onCloseEditorTab={() => {}}
          onRetrySession={() => {}}
          onCreateTerminal={() => {}}
          onLaunchHarness={() => Promise.resolve(false)}
          onNewBrowserTab={() => {}}
        />
      </Tooltip.Provider>,
    );
    expect(screen.getByRole("tab", { name: "Work Graph" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Mentu" })).toBeNull();
    expectNoBannedCopy();
  });

  it("the + create menu entry reads Work Graph", () => {
    render(
      <Tooltip.Provider>
        <TabCreateMenu
          workspaceId="ws"
          hostId="host"
          harnesses={[]}
          disabled={false}
          newTerminalShortcut=""
          newBrowserShortcut=""
          onCreateTerminal={() => {}}
          onLaunch={() => Promise.resolve(false)}
          onNewBrowserTab={() => {}}
          onOpenMentu={() => {}}
          mentuAvailable
        />
      </Tooltip.Provider>,
    );
    const trigger = screen.getByRole("button", { name: "New tab" });
    fireEvent.pointerDown(trigger, { pointerType: "mouse", button: 0 });
    fireEvent.click(trigger);
    expect(
      screen.getByRole("menuitem", { name: "Work Graph" }),
    ).not.toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Mentu" })).toBeNull();
    expectNoBannedCopy();
  });

  it("the right-sidebar panel heading and its labels read Work Graph", async () => {
    render(<MentuPanel bridge={fakeMentuBridge()} workspaceId="ws-guard" />);
    expect(screen.getByText("Work Graph")).toBeTruthy();
    expect(screen.queryByText("Mentu")).toBeNull();
    expectNoBannedCopy();
  });

  it("the right-sidebar activity bar entry reads Work Graph", () => {
    const items = buildRightSidebarActivityItems({
      explorerShortcut: "",
      sourceControlShortcut: "",
      portsShortcut: "",
    });
    const labels = items.map(activityItemAriaLabel);
    expect(labels).toContain("Work Graph");
    expect(findMentuViolations(labels)).toEqual([]);
  });
});
