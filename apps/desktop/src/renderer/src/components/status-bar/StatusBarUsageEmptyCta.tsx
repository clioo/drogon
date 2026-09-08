// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only; never edit the reference):
//   src/renderer/src/components/status-bar/StatusBarUsageEmptyCta.tsx
//     ("Configure usage tracking" CTA + hover card shown when no provider is
//     configured; connecting an account is what makes the chips appear).
// Adapted: routes to the Agents settings pane (Drogon has no AI Provider
// Accounts page; the Agents pane is the accounts surface this repo has);
// the fork's "Supports:" icon row renders the two providers Drogon ships;
// the EyeOff "Hide from status bar" dismiss needs the fork's persisted
// usageEmptyStateDismissed flag (no Drogon settings key yet) and is omitted.
import React, { useCallback } from "react";
import { BarChart3 } from "lucide-react";
import { Button } from "../ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../ui/hover-card";
import { ClaudeIcon, OpenAIIcon } from "./provider-icons";

export function StatusBarUsageEmptyCta({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}): React.JSX.Element {
  const handleOpenSettings = useCallback(() => {
    onOpenSettings();
  }, [onOpenSettings]);

  return (
    <HoverCard openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={handleOpenSettings}
          aria-label="Configure usage tracking"
          className="inline-flex h-5 cursor-pointer items-center gap-1.5 rounded px-1.5 text-xs font-normal text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
        >
          <BarChart3 className="size-3.5" />
          <span>Configure usage tracking</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[260px] p-2.5"
      >
        <div className="space-y-2 text-xs leading-[1.45]">
          <div className="flex items-start justify-between gap-2">
            <div className="font-semibold text-foreground">Agent usage limits</div>
          </div>
          <p className="text-muted-foreground">
            Connect your AI provider accounts to see their usage in real time
            and easily switch between accounts.
          </p>
          {/* Name the provider set so the feature doesn't read as support for
              just one agent (fork renders its five; Drogon ships two). */}
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span>Supports:</span>
            <ClaudeIcon size={13} />
            <OpenAIIcon size={13} />
          </div>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleOpenSettings}
            className="mt-0.5 h-7 w-full text-xs"
          >
            Connect an account
          </Button>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
