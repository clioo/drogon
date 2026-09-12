import { ScrollArea } from "@drogon/desktop";

/** A tall list clipped to a fixed height, with a visible scrollbar. */
export function Default() {
  return (
    <ScrollArea className="h-64 w-64 rounded-md border">
      <div className="flex flex-col gap-1 p-3 text-sm">
        {Array.from({ length: 15 }, (_, i) => (
          <div key={i} className="rounded px-2 py-1.5 hover:bg-accent">
            Worktree agent-{i + 1}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
