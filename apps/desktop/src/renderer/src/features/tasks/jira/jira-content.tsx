// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/jira/Content.tsx — the connected
// list card (header counts, sort controls, scroll region), the per-state
// bodies (spinner / connect prompt / skeletons / empty / error banner) and
// the issue workspace sheet placement are the fork's; the model rides this
// repo's TaskPageModel and the workspace is the R17-C port (props instead
// of the source's store bindings).
import { LoaderCircle } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { JiraIcon } from "./jira-issue-workspace-content";
import { TaskPageJiraSortControls } from "./jira-sort-controls";
import { TaskPageJiraErrorBanner } from "./jira-error-banner";
import { TaskPageJiraIssueList } from "./jira-issue-list";
import { getJiraStatusTone } from "./jira-status-tone";
import { formatRelativeTime } from "../task-page-source-context";
import JiraIssueWorkspace from "./jira-issue-workspace";
import type { TaskPageModelProps } from "../task-page-model";

export function TaskPageJiraContent({
  model,
}: TaskPageModelProps): React.JSX.Element | null {
  const {
    jiraStatus,
    jiraStatusReady,
    jiraConnected,
    selectedJiraSiteId,
    hideTaskSource,
    closeJiraDetailPage,
    selectedJiraIssue,
    openJiraDetailPage,
    jiraIssues,
    jiraLoading,
    jiraError,
    jiraErrorDetailsOpen,
    setJiraErrorDetailsOpen,
    jiraSearchInput,
    jiraOrderBy,
    jiraOrderDirection,
    handleJiraSort,
    sortedJiraIssues,
    setJiraConnectOpen,
    handleUseJiraItem,
    jiraWorkspaceBridge,
    jiraWorkspaceSiteId,
    openJiraIssueUrl,
    writeJiraClipboardText,
    onJiraIssuePatched,
  } = model;

  if (!jiraStatusReady) {
    return (
      <div className="mt-4 flex items-center justify-center py-14">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!jiraConnected) {
    return (
      <div className="mt-4 flex flex-col items-center justify-center rounded-md border border-border/50 bg-muted/50 px-6 py-14 text-center shadow-sm">
        <JiraIcon className="mb-4 size-8 text-muted-foreground/60" />
        <p className="text-base font-medium text-foreground">
          Connect your Jira site
        </p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Browse, edit, create, and start work from Jira issues directly from
          here.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => setJiraConnectOpen(true)}>Connect Jira</Button>
          <Button variant="outline" onClick={() => hideTaskSource("jira", "Jira")}>
            Hide Jira
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 max-h-full flex-col overflow-hidden rounded-md rounded-t-none border border-t-0 border-border/50 bg-background shadow-sm">
      <div className="flex h-10 flex-none items-center justify-between gap-3 border-b border-border/50 bg-muted/35 px-3">
        <div className="min-w-0 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Jira issues
        </div>
        <div className="shrink-0 text-[11px] text-muted-foreground">
          {jiraIssues.length} shown
        </div>
      </div>

      <TaskPageJiraSortControls
        direction={jiraOrderDirection}
        onSort={handleJiraSort}
        orderBy={jiraOrderBy}
      />

      <div
        className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek"
        style={{
          scrollbarGutter: "stable",
        }}
      >
        {jiraStatus?.credentialError ? (
          <div className="border-b border-border px-4 py-4 text-sm text-destructive">
            {jiraStatus.credentialError}
          </div>
        ) : null}
        {!jiraStatus?.credentialError && jiraError ? (
          <TaskPageJiraErrorBanner
            error={jiraError}
            open={jiraErrorDetailsOpen}
            onOpenChange={setJiraErrorDetailsOpen}
          />
        ) : null}

        {jiraLoading && jiraIssues.length === 0 ? (
          <div className="divide-y divide-border/50">
            {Array.from({
              length: 6,
            }).map((_, i) => (
              <div key={i} className="px-3 py-3">
                <div className="h-4 w-4/5 animate-pulse rounded bg-muted/70" />
                <div className="mt-2 h-3 w-3/5 animate-pulse rounded bg-muted/60" />
              </div>
            ))}
          </div>
        ) : null}

        {!jiraLoading &&
        jiraIssues.length === 0 &&
        !jiraError &&
        !jiraStatus?.credentialError ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium text-foreground">
              No Jira issues found
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {jiraSearchInput
                ? "Try a different JQL query."
                : "No issues match the selected preset."}
            </p>
          </div>
        ) : null}

        <TaskPageJiraIssueList
          formatUpdatedAt={formatRelativeTime}
          getStatusTone={getJiraStatusTone}
          issues={sortedJiraIssues}
          onOpenIssue={openJiraDetailPage}
          onStartWorkspace={handleUseJiraItem}
          selectedIssue={selectedJiraIssue}
          showSiteContext={selectedJiraSiteId === "all"}
          statusDirection={jiraOrderBy === "status" ? jiraOrderDirection : "asc"}
          statusOrder={null}
        />
      </div>
      <JiraIssueWorkspace
        issue={selectedJiraIssue}
        onUse={handleUseJiraItem}
        onClose={closeJiraDetailPage}
        bridge={jiraWorkspaceBridge}
        siteId={jiraWorkspaceSiteId}
        openUrl={openJiraIssueUrl}
        writeClipboardText={writeJiraClipboardText}
        onPatched={onJiraIssuePatched}
      />
    </div>
  );
}
