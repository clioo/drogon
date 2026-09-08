import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Tooltip } from "radix-ui";
import { UncommittedEntryRow } from "./uncommitted-entry-row";
import { SectionHeader } from "./section-header";
import { CommitMessageComposer } from "./commit-message-composer";
import { CommitArea } from "./commit-area";
import { SourceControlDiscardDialog } from "./discard-dialog";
import { SourceControlBranchLineTotalChip } from "./branch-line-total-chip";
import { SourceControlBranchContextRow } from "./branch-context-row";
import { SourceControlHeaderToolbar } from "./header-toolbar";
import { resolveCreatePrToolbarAction } from "./create-pr-action";
import { SyncRow } from "./sync-row";
import { EmptyState } from "./empty-state";
import { DiffLineCounts } from "./diff-line-counts";
import type { SourceControlEntry } from "./source-control-entry";

function html(node: React.ReactElement): string {
  // Like App's single Tooltip.Provider: every Radix tooltip trigger below
  // requires a provider ancestor to render.
  return renderToString(
    createElement(Tooltip.Provider, { delayDuration: 400, children: node }),
  ).replace(/<!-- -->/g, "");
}

const entry: SourceControlEntry = {
  path: "src/App.tsx",
  area: "unstaged",
  status: "modified",
  added: 3,
  removed: 1,
};

const rowProps = {
  entryKey: "unstaged::src/App.tsx",
  entry,
  onOpen: () => {},
  onStage: () => Promise.resolve(),
  onUnstage: () => Promise.resolve(),
  onDiscard: () => {},
};

describe("source control render", () => {
  test("untracked directory entries name the directory", () => {
    const out = html(
      createElement(UncommittedEntryRow, {
        ...rowProps,
        entryKey: "untracked::fresh-dir/",
        entry: { path: "fresh-dir/", area: "untracked", status: "untracked" },
      }),
    );
    expect(out).toContain("fresh-dir");
  });

  test("file rows are non-interactive divs with separate action buttons", () => {
    const out = html(createElement(UncommittedEntryRow, rowProps));
    // Fork parity: no role=button wrapper with nested buttons — the row
    // div only carries identity attrs; Discard/Stage are sibling buttons.
    expect(out).not.toContain('role="button"');
    expect(out).not.toContain("tabindex");
    expect(out).toContain('data-testid="source-control-entry"');
    expect(out).toContain('aria-label="Discard changes"');
    expect(out).toContain('aria-label="Stage"');
  });

  test("file rows show the status letter, name, dimmed directory and line counts", () => {
    const out = html(createElement(UncommittedEntryRow, rowProps));
    expect(out).toContain('data-source-control-path="src/App.tsx"');
    expect(out).toContain('data-source-control-area="unstaged"');
    expect(out).toContain(">M<");
    expect(out).toContain("App.tsx");
    expect(out).toContain("src");
    expect(out).toContain("+3");
    expect(out).toContain("-1");
    expect(out).toContain("Stage");
    expect(out).toContain("Discard changes");
  });

  test("staged rows offer unstage instead of stage", () => {
    const out = html(
      createElement(UncommittedEntryRow, {
        ...rowProps,
        entry: { ...entry, area: "staged" },
      }),
    );
    expect(out).toContain("Unstage");
    expect(out).not.toContain('"Stage"');
  });

  test("section headers show the label and count", () => {
    const out = html(
      createElement(SectionHeader, {
        label: "Staged Changes",
        count: 2,
        isCollapsed: false,
        onToggle: () => {},
      }),
    );
    expect(out).toContain("Staged Changes");
    expect(out).toContain(">2<");
  });

  test("commit composer keeps the source placeholder and label", () => {
    const out = html(
      createElement(CommitMessageComposer, {
        rows: 2,
        commitMessage: "",
        disabled: false,
        onCommitMessageChange: () => {},
        describedBy: "",
      }),
    );
    expect(out).toContain('placeholder="Message"');
    expect(out).toContain('aria-label="Commit message"');
  });

  test("commit button needs a message and staged rows", () => {
    const base = {
      commitError: null,
      remoteActionError: null,
      prNotice: null,
      prUrl: null,
      isCommitting: false,
      isSecondaryBusy: false,
      stagedCount: 1,
      hasPartiallyStagedChanges: false,
      isBusy: false,
      amend: false,
      canAmend: true,
      onCommitMessageChange: () => {},
      onCommit: () => {},
      onCommitAndPush: () => {},
      onToggleAmend: () => {},
    };
    const empty = html(createElement(CommitArea, { ...base, commitMessage: "" }));
    expect(empty).toContain("Commit");
    // NB: the `disabled=` attribute, not the Tailwind `disabled:` classes
    // that appear in every render.
    expect(empty).toContain("disabled=");
    const ready = html(createElement(CommitArea, { ...base, commitMessage: "fix it" }));
    expect(ready).toContain("Commit");
    expect(ready).not.toContain("disabled=");
    // The chevron menu items portal out of SSR; the trigger proves the
    // Commit & Push / amend menu is wired.
    expect(ready).toContain('aria-label="More commit and remote actions"');
  });

  test("discard dialog stays unmounted without a pending confirmation", () => {
    // Radix portals do not SSR, so the open dialog's copy is pinned by
    // discard-copy.test.ts; here the closed dialog must render nothing.
    expect(
      html(
        createElement(SourceControlDiscardDialog, {
          pendingDiscard: null,
          onCancel: () => {},
          onConfirm: () => {},
        }),
      ),
    ).toBe("");
  });

  test("branch line-total chip announces raw counts", () => {
    const out = html(
      createElement(SourceControlBranchLineTotalChip, { added: 12, removed: 4 }),
    );
    expect(out).toContain('data-testid="source-control-branch-line-total"');
    expect(out).toContain('aria-label="12 lines added, 4 lines deleted"');
    expect(html(createElement(SourceControlBranchLineTotalChip, { added: 0, removed: 0 }))).toBe(
      "",
    );
  });

  test("branch row names the branch and upstream", () => {
    const out = html(
      createElement(SourceControlBranchContextRow, {
        branchHead: "feature-x",
        upstream: "origin/main",
        ahead: 2,
        behind: 0,
        lineTotalAdded: 5,
        lineTotalRemoved: 0,
      }),
    );
    expect(out).toContain("feature-x");
    expect(out).toContain("origin/main");
    expect(out).toContain("↑2");
  });

  test("sync row reports upstream and gates push without it", () => {
    const props = {
      busyKind: null as null,
      actionsAvailable: { pull: true, fetch: true },
      onPush: () => {},
      onPull: () => {},
      onFetch: () => {},
    };
    const withUpstream = html(
      createElement(SyncRow, { ...props, upstream: "origin/main", ahead: 1, behind: 0 }),
    );
    expect(withUpstream).toContain("origin/main");
    // The fork has no "New PR" string anywhere: PR creation lives in the
    // header toolbar as "Create PR" (see #136).
    expect(withUpstream).not.toContain("New PR");
    expect(withUpstream).not.toContain("Create PR");
    expect(withUpstream).toContain("Push");
    expect(withUpstream).toContain("Pull");
    expect(withUpstream).toContain("Fetch");
    const withoutUpstream = html(
      createElement(SyncRow, { ...props, upstream: null, ahead: null, behind: null }),
    );
    expect(withoutUpstream).toContain("No upstream");
  });

  test("header toolbar keeps the fork slots: Create PR, filter, overflow", () => {
    const toolbarProps = {
      filterQuery: "",
      filterExpanded: false,
      onFilterQueryChange: () => {},
      onFilterExpandedChange: () => {},
      isCreatingPr: false,
      onCreatePr: () => {},
      sourceControlViewMode: "list" as const,
      onToggleViewMode: () => {},
      onRefresh: () => {},
      refreshDisabled: false,
      branchHead: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 0,
      lineTotalAdded: 0,
      lineTotalRemoved: 0,
      reviewUrl: null,
      onOpenReviewPage: () => {},
    };
    const enabled = html(
      createElement(SourceControlHeaderToolbar, {
        ...toolbarProps,
        createPrAction: resolveCreatePrToolbarAction({
          busy: false,
          upstream: "origin/main",
          ahead: 2,
          hasUncommitted: false,
        }),
      }),
    );
    expect(enabled).toContain("Create PR");
    expect(enabled).toContain("Filter files by name");
    expect(enabled).toContain("More source control actions");
    // The fork has no Refresh button in the collapsed toolbar (see #136);
    // manual refresh stays in the overflow menu.
    expect(enabled).not.toContain("Refresh source control status");
    const disabled = html(
      createElement(SourceControlHeaderToolbar, {
        ...toolbarProps,
        createPrAction: resolveCreatePrToolbarAction({
          busy: false,
          upstream: null,
          ahead: null,
          hasUncommitted: false,
        }),
      }),
    );
    // The fork renders Create PR disabled rather than hiding it.
    expect(disabled).toContain("Create PR");
    expect(disabled).toContain('disabled=""');
  });

  test("branch row opens the review page only when a review url is known", () => {
    const rowProps = {
      branchHead: "feature-x",
      upstream: "origin/main",
      ahead: 2,
      behind: 0,
      lineTotalAdded: 5,
      lineTotalRemoved: 0,
    };
    const withReview = html(
      createElement(SourceControlBranchContextRow, {
        ...rowProps,
        reviewUrl: "https://github.com/clioo/drogon/pull/1",
        onOpenReviewPage: () => {},
      }),
    );
    expect(withReview).toContain("Open review page in browser");
    const withoutReview = html(createElement(SourceControlBranchContextRow, rowProps));
    expect(withoutReview).not.toContain("Open review page in browser");
  });

  test("empty state and diff counts render their copy", () => {
    expect(
      html(createElement(EmptyState, { heading: "No changes on this branch", supportingText: "Clean." })),
    ).toContain("No changes on this branch");
    expect(html(createElement(DiffLineCounts, { added: 2, removed: 0 }))).toContain("+2");
    expect(html(createElement(DiffLineCounts, {}))).toBe("");
  });
});
