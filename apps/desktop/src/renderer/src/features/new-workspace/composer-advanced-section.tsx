/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/new-workspace/NewWorkspaceComposerAdvancedSection.tsx
   (adapter: the animated disclosure shell is verbatim; of the source's
   advanced rows, Drogon's data layer has exactly one analog — the base ref
   the worktree is created from — placed where the source places its
   branch-level controls. The source's Branch name override (the daemon's
   worktree.create takes a single name), Parent worktree nesting, Note,
   setup-script and sparse-checkout rows are not ported: none of them exist
   in this repo's Project/Worktree RPC contract). */
import React from "react";
import { cn } from "../../lib/utils";

/** The source's advanced text-input recipe (branch name / note fields). */
const ADVANCED_INPUT_CLASS =
  "w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function NewWorkspaceComposerAdvancedSection({
  advancedOpen,
  selectedRepoIsGit,
  baseRefInputId,
  baseRef,
  onBaseRefChange,
  defaultBaseRef,
}: {
  advancedOpen: boolean;
  selectedRepoIsGit: boolean;
  baseRefInputId: string;
  baseRef: string;
  onBaseRefChange: (value: string) => void;
  defaultBaseRef: string | null;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out",
        !advancedOpen && "!mt-2",
        advancedOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
      aria-hidden={!advancedOpen}
      inert={!advancedOpen}
    >
      <div className="min-h-0">
        <div
          className={cn(
            "space-y-4 px-1 pt-1 pb-3 transition-[opacity,transform] duration-150 ease-out",
            advancedOpen
              ? "translate-y-0 opacity-100 delay-200"
              : "-translate-y-1 opacity-0 delay-0",
          )}
        >
          {selectedRepoIsGit ? (
            <div className="space-y-1">
              <label
                htmlFor={baseRefInputId}
                className="text-xs font-medium text-muted-foreground"
              >
                Base ref <span className="text-muted-foreground/70">(optional)</span>
              </label>
              <input
                id={baseRefInputId}
                type="text"
                value={baseRef}
                onChange={(event) => onBaseRefChange(event.target.value)}
                placeholder={defaultBaseRef ?? "repo default"}
                className={ADVANCED_INPUT_CLASS}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
