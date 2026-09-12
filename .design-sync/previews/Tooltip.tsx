import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@drogon/desktop";

/** Open by default so the floating label is visible in the card. */
export function Open() {
  return (
    <Tooltip defaultOpen>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Settings">
          ⚙
        </Button>
      </TooltipTrigger>
      <TooltipContent>Settings</TooltipContent>
    </Tooltip>
  );
}
