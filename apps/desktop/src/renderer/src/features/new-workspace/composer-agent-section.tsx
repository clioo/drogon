/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/new-workspace/NewWorkspaceComposerAgentSection.tsx
   (adapter: agents are the daemon-listed harnesses; i18n keys inlined). */
import React from "react";
import { ChevronDown, Settings2 } from "lucide-react";
import AgentCombobox, { type ComposerAgentOption } from "./AgentCombobox";
import { Button } from "../../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../lib/utils";
import type { HarnessId } from "../../../../shared/session-contract";

type NewWorkspaceComposerAgentSectionProps = {
  quickAgent: HarnessId | null;
  onQuickAgentChange: (agent: HarnessId | null) => void;
  onOpenAgentSettings: () => void;
  createDisabled: boolean;
  onCreate: () => void;
  advancedOpen: boolean;
  onToggleAdvanced: () => void;
  visibleQuickAgents: ComposerAgentOption[];
  defaultTuiAgent: HarnessId | "blank" | null;
  handleSetDefaultAgent: (next: HarnessId | "blank" | null) => void;
};

export function NewWorkspaceComposerAgentSection({
  quickAgent,
  onQuickAgentChange,
  onOpenAgentSettings,
  createDisabled,
  onCreate,
  advancedOpen,
  onToggleAdvanced,
  visibleQuickAgents,
  defaultTuiAgent,
  handleSetDefaultAgent,
}: NewWorkspaceComposerAgentSectionProps): React.JSX.Element {
  return (
    <>
      <div className="min-w-0 space-y-1" data-contextual-tour-target="workspace-creation-agent">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium text-muted-foreground">Agent</label>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={onOpenAgentSettings}
                tabIndex={-1}
                className="size-5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
                aria-label="Open agent settings"
              >
                <Settings2 className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              Configure agents
            </TooltipContent>
          </Tooltip>
        </div>
        <AgentCombobox
          agents={visibleQuickAgents}
          value={quickAgent}
          onValueChange={onQuickAgentChange}
          onOpenManageAgents={onOpenAgentSettings}
          defaultAgent={defaultTuiAgent}
          onSetDefault={handleSetDefaultAgent}
          allowNarrowTrigger
          triggerClassName="h-9 w-full min-w-0 border-input text-sm focus:border-ring focus:ring-[3px] focus:ring-ring/50"
          onTriggerEnter={createDisabled ? undefined : onCreate}
        />
      </div>

      <div className="!mb-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onToggleAdvanced}
          className="-ml-2 text-xs focus-visible:ring-inset"
        >
          Advanced
          <ChevronDown
            className={cn("size-4 transition-transform", advancedOpen && "rotate-180")}
          />
        </Button>
      </div>
    </>
  );
}
