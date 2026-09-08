// R17-C fidelity oracle: mounts the ported Jira create dialog and issue
// workspace outside the app shell (R17-B's Tasks chrome has not landed, so
// the dialogs cannot be mounted into the app yet). Driven by
// scripts/fidelity/jira-dialog-states.mjs over a bare vite dev server;
// ?state=create|detail, ?theme=light|dark, ?filled=1.
import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "../../../../components/ui/sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../../components/ui/tooltip";
import "../../../../assets/main.css";
import type { JiraBridge } from "../../../../../../shared/jira-contract";
import { JiraIssueCreateDialog } from "../jira-issue-create-dialog";
import { useJiraIssueCreationDialog } from "../use-jira-issue-creation";
import JiraIssueWorkspace from "../jira-issue-workspace";
import {
  ORACLE_COMMENTS,
  ORACLE_CREATE_FIELDS,
  ORACLE_ISSUE,
  ORACLE_ISSUE_TYPES,
  ORACLE_PRIORITIES,
  ORACLE_PROJECTS,
  ORACLE_TRANSITIONS,
  ORACLE_USERS,
} from "./fixture-data";

const ok = <T,>(result: T) => Promise.resolve({ ok: true as const, result });

/** Fixture-backed bridge: every read serves the committed oracle data. */
const oracleBridge = {
  jiraListProjects: () => ok(ORACLE_PROJECTS),
  jiraListIssueTypes: () => ok(ORACLE_ISSUE_TYPES),
  jiraListCreateFields: () => ok(ORACLE_CREATE_FIELDS),
  jiraGetIssue: () => ok(ORACLE_ISSUE),
  jiraComments: () => ok(ORACLE_COMMENTS),
  jiraListTransitions: () => ok(ORACLE_TRANSITIONS),
  jiraListPriorities: () => ok(ORACLE_PRIORITIES),
  jiraSearchUsers: () => ok(ORACLE_USERS),
  jiraUpdateIssue: () => ok({ ok: true as const }),
  jiraAddComment: () => ok({ ok: true as const, id: "local-oracle" }),
} as unknown as JiraBridge;

function OracleCreate({ filled }: { filled: boolean }): React.JSX.Element {
  const model = useJiraIssueCreationDialog({
    bridge: oracleBridge,
    connected: true,
    siteId: null,
  });
  useEffect(() => {
    model.setOpen(true);
    if (filled) {
      model.setTitle("Port the Jira create dialog");
      model.setBody("Bring the fork's IssueDialog over verbatim.\n\nKeep the copy strings.");
    }
    // The oracle renders one state; model setters are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Create fields load after the project/type resolve (and reset the draft
  // map), so apply the Team selection once the grid exists.
  useEffect(() => {
    if (!filled) return;
    if (model.createFieldsLoading || model.visibleCreateFields.length === 0) return;
    model.setCustomFieldValues((prev) => ({ ...prev, custom_10002: "2" }));
  }, [filled, model.createFieldsLoading, model.visibleCreateFields.length, model]);
  return <JiraIssueCreateDialog model={model} />;
}

function OracleDetail(): React.JSX.Element {
  return (
    <JiraIssueWorkspace
      issue={ORACLE_ISSUE}
      onUse={() => {}}
      onClose={() => {}}
      bridge={oracleBridge}
      siteId={null}
      openUrl={() => Promise.resolve()}
      writeClipboardText={() => Promise.resolve()}
    />
  );
}

function App(): React.JSX.Element {
  const params = new URLSearchParams(window.location.search);
  const state = params.get("state") ?? "create";
  const filled = params.get("filled") === "1";
  return (
    <TooltipProvider>
      <div className="h-screen w-screen bg-background text-foreground">
        {state === "detail" ? <OracleDetail /> : <OracleCreate filled={filled} />}
      </div>
      <Toaster />
      {/* Marker the Playwright driver waits for before screenshotting. */}
      <span
        data-oracle-ready="true"
        className="pointer-events-none fixed bottom-1 left-1 text-[10px] text-muted-foreground"
      >
        oracle ready
      </span>
    </TooltipProvider>
  );
}

// Give the dialogs a beat to mount/open before the driver snapshots.
createRoot(document.getElementById("root")!).render(<App />);
