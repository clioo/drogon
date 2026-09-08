// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationRunDetailsPage.tsx.
// Adaptations: this repo has no react-markdown, so the run content renders
// as a plain pre-wrap block (run output is plain text) with the source's
// text classes; the workspace display resolves this repo's `Workspace`.
// Structure, copy, breadcrumb order, badges and actions stay literal.
import React from "react";
import { Eye, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "./automation-class-names";
import type { AutomationSummary } from "../../../../shared/automation-contract";
import type { AutomationRunDetail } from "../../../../shared/automation-contract";
import { AutomationRunPageFrame } from "./AutomationRunPageFrame";
import { getAutomationRunContent } from "./automation-run-content";
import type { AutomationRunViewState } from "./automation-run-view-state";
import type { AutomationRunWorkspaceDisplay } from "./automation-run-workspace-display";
import {
  formatAutomationDateTimeWithRelative,
  getAutomationRunStatusLabel,
  getAutomationRunStatusVariant,
} from "./automation-page-parts";

export function AutomationRunDetailsPage({
  automation,
  run,
  relativeNow,
  workspaceDisplay,
  viewState,
  canRerun,
  isRerunPending,
  onRerun,
  onOpenWorkspace,
  onBack,
}: {
  automation: AutomationSummary | null;
  run: AutomationRunDetail;
  relativeNow: number;
  workspaceDisplay: AutomationRunWorkspaceDisplay | null;
  viewState: AutomationRunViewState | null;
  canRerun: boolean;
  isRerunPending: boolean;
  onRerun: () => void;
  onOpenWorkspace: () => void;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <section className="flex min-h-0 flex-1 p-5">
      <AutomationRunPageFrame
        title={automation?.name ?? run.title}
        breadcrumbs={[
          formatAutomationDateTimeWithRelative(run.scheduledFor, relativeNow),
          "Drogon",
          workspaceDisplay?.detailLabel ?? "No workspace",
        ]}
        detail={
          run.outputSnapshot?.truncated ? "Latest saved output" : null
        }
        statusLabel={getAutomationRunStatusLabel(run.status)}
        statusVariant={getAutomationRunStatusVariant(run.status)}
        actions={
          <>
            {canRerun && automation ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isRerunPending}
                onClick={onRerun}
              >
                <RefreshCw className={cn("size-3.5", isRerunPending && "animate-spin")} />
                Rerun
              </Button>
            ) : null}
            {viewState ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!viewState.canOpen}
                onClick={onOpenWorkspace}
              >
                <Eye className="size-3.5" />
                {viewState.actionLabel}
              </Button>
            ) : null}
          </>
        }
        onBack={onBack}
      >
        <div className="text-sm leading-relaxed text-foreground whitespace-pre-wrap break-words">
          {getAutomationRunContent(run)}
        </div>
      </AutomationRunPageFrame>
    </section>
  );
}
