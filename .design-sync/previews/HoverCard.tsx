import { Button, HoverCard, HoverCardContent, HoverCardTrigger } from "@drogon/desktop";

/** Open by default so the floating content is visible in the card. */
export function Open() {
  return (
    <HoverCard defaultOpen openDelay={0}>
      <HoverCardTrigger asChild>
        <Button variant="link">@drogon-bot</Button>
      </HoverCardTrigger>
      <HoverCardContent>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold">Drogon Bot</p>
          <p className="text-sm text-muted-foreground">
            Automates responsibilities on a cron schedule.
          </p>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
