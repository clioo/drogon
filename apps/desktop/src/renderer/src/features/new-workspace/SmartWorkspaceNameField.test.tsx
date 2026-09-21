// @vitest-environment jsdom
/* The composer's GitHub source rows must say what the PR they offer is: a
   merged PR in its purple, a failing pipeline in its rose, a green pipeline in
   its emerald, a draft by its glyph -- and hovering a row must offer to open
   that PR without turning it into the workspace's source. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import type { TaskPullRequest, TasksBridge } from "../../../../shared/tasks-contract";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { SmartWorkspaceNameField } from "./SmartWorkspaceNameField";

installRadixJsdomStubs();
afterEach(() => {
  cleanup();
  delete (window as { drogon?: unknown }).drogon;
});

const PR_URL = (number: number): string =>
  `https://github.com/clioo/drogon/pull/${number}`;

function pull(overrides: Partial<TaskPullRequest> & { number: number }): TaskPullRequest {
  return {
    title: `Pull ${overrides.number}`,
    state: "open",
    labels: [],
    assignees: [],
    updatedAt: "2026-09-20T00:00:00Z",
    url: PR_URL(overrides.number),
    isDraft: false,
    ...overrides,
  };
}

const mergedPull = pull({
  number: 12,
  title: "Merged already",
  state: "merged",
  checks: { state: "success", total: 4, passed: 4, failed: 0, pending: 0, neutral: 0 },
});
const failingPull = pull({
  number: 13,
  title: "Red pipeline",
  state: "open",
  checks: { state: "failure", total: 3, passed: 1, failed: 2, pending: 0, neutral: 0 },
});
const draftPull = pull({ number: 14, title: "Work in progress", state: "draft", isDraft: true });
/** A PR the listing never returns, so a direct `#99` lookup is unambiguous. */
const directPull = pull({
  number: 99,
  title: "Looked up by number",
  state: "merged",
  checks: { state: "success", total: 2, passed: 2, failed: 0, pending: 0, neutral: 0 },
});

/** The daemon bridge the field reads: issues on the default mode, PRs on
 *  `mode: "pulls"`, and one PR per direct number lookup. */
function tasksBridge(): Pick<TasksBridge, "tasksList" | "tasksShow"> {
  return {
    tasksList: vi.fn(async (input: { mode?: string }) =>
      input.mode === "pulls"
        ? {
            ok: true as const,
            result: {
              repo: "clioo/drogon",
              issues: [],
              pulls: [mergedPull, failingPull, draftPull],
              page: 1,
              perPage: 12,
              hasNextPage: false,
            },
          }
        : {
            ok: true as const,
            result: {
              repo: "clioo/drogon",
              issues: [
                {
                  number: 7,
                  title: "Reported bug",
                  state: "open" as const,
                  labels: [],
                  assignees: [],
                  updatedAt: "2026-09-20T00:00:00Z",
                  url: "https://github.com/clioo/drogon/issues/7",
                  body: null,
                },
              ],
              page: 1,
              perPage: 12,
              hasNextPage: false,
            },
          },
    ),
    tasksShow: vi.fn(async (input: { number: number; mode?: string }) =>
      input.mode === "pulls" && input.number === directPull.number
        ? { ok: true as const, result: { issue: undefined as never, pull: directPull } }
        : {
            ok: false as const,
            error: { code: "not_found", message: "no item", retryable: false },
          },
    ),
  };
}

function mountField({
  value,
  tasks = tasksBridge(),
  onGitHubItemSelect = vi.fn(),
}: {
  value: string;
  tasks?: Pick<TasksBridge, "tasksList" | "tasksShow">;
  onGitHubItemSelect?: (item: unknown) => void;
}) {
  const inputRef = createRef<HTMLInputElement>();
  render(
    <SmartWorkspaceNameField
      inputRef={inputRef}
      value={value}
      onValueChange={() => {}}
      onGitHubItemSelect={onGitHubItemSelect}
      onBranchSelect={() => {}}
      selectedSource={null}
      onClearSelectedSource={() => {}}
      textOnly={false}
      projectId="git:1"
      repoSlug={{ owner: "clioo", repo: "drogon" }}
      tasks={tasks}
      branchSearch={null}
    />,
  );
  return { inputRef, onGitHubItemSelect };
}

/** The rows only render while the field's source popover is open. */
async function openRows(input: HTMLInputElement): Promise<void> {
  fireEvent.pointerDown(input);
  await screen.findByText("Reported bug", undefined, { timeout: 4000 });
}

describe("composer GitHub rows: the PR is shown as what it is", () => {
  test("merged, failing, green and draft rows each carry their own state", async () => {
    const { inputRef } = mountField({ value: "fix" });
    const input = inputRef.current!;
    await openRows(input);

    const mergedRow = screen.getByLabelText(
      "Pull request #12, Merged, checks 4/4 passed: Merged already",
    );
    expect(mergedRow.getAttribute("data-smart-workspace-source-state")).toBe("merged");
    expect(mergedRow.querySelector("svg")?.getAttribute("class")).toContain("purple");
    expect(
      mergedRow.querySelector('[data-smart-workspace-checks="success"]')?.textContent,
    ).toContain("4/4 passed");

    const failingRow = screen.getByLabelText(
      "Pull request #13, Open, checks 2 failing: Red pipeline",
    );
    const failingPill = failingRow.querySelector('[data-smart-workspace-checks="failure"]');
    expect(failingPill?.textContent).toContain("2 failing");
    expect(failingPill?.getAttribute("class")).toContain("rose");
    // A failing pipeline does not turn the PR itself red: the PR is open.
    expect(failingRow.querySelector("svg")?.getAttribute("class")).toContain("emerald");

    const draftRow = screen.getByLabelText("Pull request #14, Draft: Work in progress");
    expect(draftRow.querySelector("svg")?.getAttribute("class")).toContain(
      "lucide-git-pull-request-draft",
    );
    // A PR the daemon listed without a rollup claims no verdict.
    expect(draftRow.querySelector("[data-smart-workspace-checks]")).toBeNull();

    // The issue row keeps its shipped muted dot and gets no PR affordances.
    const issueRow = screen.getByLabelText("Issue #7: Reported bug");
    expect(issueRow.querySelector("[data-smart-workspace-checks]")).toBeNull();
    expect(issueRow.querySelector("svg")?.getAttribute("class")).toContain(
      "text-muted-foreground",
    );
  });
});

describe("composer GitHub rows: the hover affordance opens the link", () => {
  test("the open-link button stays hidden until the row is hovered or selected", async () => {
    const { inputRef } = mountField({ value: "fix" });
    const input = inputRef.current!;
    await openRows(input);

    const row = screen.getByLabelText(
      "Pull request #12, Merged, checks 4/4 passed: Merged already",
    );
    const open = screen.getByRole("button", {
      name: "Open pull request #12 in browser",
    });
    expect(row.contains(open)).toBe(true);
    // Hidden by default, revealed by the row's own hover/selection.
    expect(open.className).toContain("opacity-0");
    expect(open.className).toContain("group-hover/row:opacity-100");
    expect(open.className).toContain("group-data-[selected=true]/row:opacity-100");
    expect(open.className).toContain("pointer-events-none");

    // cmdk marks the row the pointer is over as selected: that is the state
    // the reveal keys off.
    fireEvent.pointerMove(row);
    expect(row.getAttribute("data-selected")).toBe("true");
  });

  test("clicking it opens the PR page through the shell bridge without selecting the row", async () => {
    const openExternal = vi.fn(async (_url: string) => ({ ok: true }));
    (window as { drogon?: unknown }).drogon = { shell: { openExternal } };
    const { inputRef, onGitHubItemSelect } = mountField({ value: "fix" });
    await openRows(inputRef.current!);

    fireEvent.click(
      screen.getByRole("button", { name: "Open pull request #13 in browser" }),
    );
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith(PR_URL(13));
    expect(onGitHubItemSelect).not.toHaveBeenCalled();
  });

  test("Alt+Enter opens the highlighted row's link; plain Enter still picks it", async () => {
    const openExternal = vi.fn(async (_url: string) => ({ ok: true }));
    (window as { drogon?: unknown }).drogon = { shell: { openExternal } };
    const { inputRef, onGitHubItemSelect } = mountField({ value: "#99" });
    const input = inputRef.current!;
    fireEvent.pointerDown(input);
    // The direct lookup's row is the one the settled `#99` query resolves to.
    await screen.findByLabelText(
      "Pull request #99, Merged, checks 2/2 passed: Looked up by number",
      undefined,
      { timeout: 4000 },
    );

    fireEvent.keyDown(input, { key: "Enter", altKey: true });
    expect(openExternal).toHaveBeenCalledWith(PR_URL(99));
    expect(onGitHubItemSelect).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onGitHubItemSelect).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledTimes(1);
  });
});
