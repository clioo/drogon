import { Button, Input, Label, Popover, PopoverContent, PopoverTrigger } from "@drogon/desktop";

/** Open by default so the floating content is visible in the card. */
export function Open() {
  return (
    <Popover defaultOpen>
      <PopoverTrigger asChild>
        <Button variant="outline">Dimensions</Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">Dimensions</p>
          <div className="flex items-center gap-2">
            <Label htmlFor="width" className="w-16 shrink-0">
              Width
            </Label>
            <Input id="width" defaultValue="100%" className="h-8" />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
