// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from orca-drogon: src/renderer/src/components/meetings/
// MeetingsPageHeader.tsx. Structure, classes, icons, tooltips and ARIA are
// verbatim; the only addition is the honest unknown count (the fork always
// knew its transcript count, this build reads it from the daemon).
import { CalendarDays, RefreshCw, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import { meetingsCountLabel } from "./meetings-page-copy";

export function MeetingsPageHeader({
  count,
  loading,
  onClose,
  onRefresh,
}: {
  count: number | null;
  loading: boolean;
  onClose: (() => void) | undefined;
  onRefresh: () => void;
}): React.JSX.Element {
  return (
    <header className="shrink-0 border-b border-border">
      <div className="flex items-center gap-2 px-5 py-3">
        {onClose ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 rounded-full"
                  onClick={onClose}
                  aria-label="Close meetings"
                >
                  <X className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                Close · Esc
              </TooltipContent>
            </Tooltip>
            <div className="mx-1 h-5 w-px bg-border/50" aria-hidden />
          </>
        ) : null}
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-foreground">Meetings</h1>
          <p className="truncate text-xs text-muted-foreground">
            {meetingsCountLabel(count, loading)}
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onRefresh}
              disabled={loading}
              aria-label="Refresh meetings"
            >
              <RefreshCw
                className={loading ? "animate-spin motion-reduce:animate-none" : undefined}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            Refresh meetings
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
