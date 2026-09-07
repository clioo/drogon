// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/commit/commit-message-composer.tsx.
// Adapter: AI message generation is out of MVP, so the composer always
// renders without the generate affordance (showGenerate stays in props so
// the port tracks the source).
import React from "react";

export function CommitMessageComposer({
  rows,
  commitMessage,
  disabled,
  onCommitMessageChange,
  describedBy,
  showGenerate = false,
}: {
  rows: number;
  commitMessage: string;
  disabled: boolean;
  onCommitMessageChange: (message: string) => void;
  describedBy: string;
  showGenerate?: boolean;
}): React.JSX.Element {
  return (
    <div className="relative">
      <textarea
        rows={rows}
        value={commitMessage}
        disabled={disabled}
        onChange={(e) => onCommitMessageChange(e.target.value)}
        placeholder="Message"
        aria-label="Commit message"
        aria-describedby={describedBy || undefined}
        // Why: reserve right padding so text doesn't slide under the absolute-positioned Generate icon.
        // Why: pin disabled:border-input so Chromium's UA disabled styles don't wash out the field outline.
        className={`mt-0.5 min-h-14 w-full resize-none appearance-none rounded-md border border-input bg-background shadow-xs px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:border-input disabled:bg-background disabled:text-foreground disabled:shadow-xs dark:bg-input/30 dark:disabled:bg-input/30 ${
          showGenerate ? "pr-8" : ""
        }`}
      />
    </div>
  );
}
