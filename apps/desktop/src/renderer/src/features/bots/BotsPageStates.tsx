/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/bots/BotsPageStates.tsx (adapter: the empty
   state keeps a `data-testid="bots-empty"` hook this repo's packaged probe
   waits on; structure, classes, copy and ARIA are the source's verbatim). */

import { AlertCircle, Bot, Plus } from "lucide-react";
import { Button } from "../../components/ui/button";

export function BotLoadingState(): React.JSX.Element {
  return (
    <div className="space-y-3" role="status" aria-label="Loading Bots">
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="space-y-3 rounded-lg border border-border px-5 py-4"
        >
          <div className="h-4 w-44 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="h-3 w-72 max-w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="h-3 w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

export function BotsEmptyState({
  onCreate,
}: {
  // Optional so capability-gated callers can render the read-only empty
  // view (no control without a real capability behind it); the fork always
  // passes it.
  onCreate?: () => void;
}): React.JSX.Element {
  return (
    <div
      data-testid="bots-empty"
      className="rounded-lg border border-dashed border-border px-5 py-10 text-center"
    >
      <Bot className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium text-foreground">No Bots yet</p>
      <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-muted-foreground">
        Give a character a purpose. Its identity and memory stay with you
        across sessions.
      </p>
      {onCreate ? (
        <Button className="mt-4" onClick={onCreate}>
          <Plus />
          Create Bot
        </Button>
      ) : null}
    </div>
  );
}

export function BotsErrorState({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-5 py-8 text-center">
      <AlertCircle
        className="mx-auto mb-3 size-7 text-destructive"
        aria-hidden
      />
      <p className="text-sm font-medium text-foreground">
        Bots could not be loaded
      </p>
      <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
        {error}
      </p>
      <Button className="mt-4" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
