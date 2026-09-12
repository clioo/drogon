import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from "@drogon/desktop";
import { ChevronsUpDown } from "lucide-react";

/** Open by default so both the trigger and the revealed content are visible. */
export function Default() {
  return (
    <Collapsible defaultOpen className="w-full max-w-sm space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">3 running agents</span>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="icon-sm">
            <ChevronsUpDown />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="flex flex-col gap-1 text-sm text-muted-foreground">
        <div className="rounded-md border px-3 py-2">R17-B</div>
        <div className="rounded-md border px-3 py-2">QA-INT-2</div>
        <div className="rounded-md border px-3 py-2">#358</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
