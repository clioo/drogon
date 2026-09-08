/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/new-workspace/ComposerParentWorktreePicker.tsx.
   Adapter: Drogon's ProjectGroup already carries the selected project's
   Worktree rows, so the picker receives that list instead of reading Orca's
   lineage stores; selecting a parent records only the sidebar edge. */
import React, { useMemo, useState } from "react";
import { Check, ChevronsUpDown, GitBranch } from "lucide-react";
import type { Worktree } from "../../../../shared/session-contract";
import { Button } from "../../components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { cn } from "../../lib/utils";

export function ComposerParentWorktreePicker({
  worktrees,
  value,
  onChange,
  disabled = false,
}: {
  worktrees: readonly Worktree[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = worktrees.find((worktree) => worktree.id === value) ?? null;
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return worktrees.filter((worktree) => {
      if (worktree.id === value) return true;
      if (!query) return true;
      return `${worktree.title ?? ""} ${worktree.branch} ${worktree.path}`
        .toLowerCase()
        .includes(query);
    });
  }, [search, value, worktrees]);

  return (
    <div className="space-y-1.5">
      <span className="block text-xs font-medium text-muted-foreground">
        Parent worktree
      </span>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-label="Parent worktree"
            aria-expanded={open}
            disabled={disabled}
            className="h-9 w-full justify-between border-input px-3 text-sm font-normal text-foreground focus:border-ring focus:ring-[3px] focus:ring-ring/50"
          >
            <span className="truncate">
              {selected?.title || selected?.branch || "No parent"}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] min-w-[17rem] p-0"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <Command shouldFilter={false}>
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search workspaces..."
            />
            <CommandList>
              <CommandItem
                value="no-parent"
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "size-3.5",
                    value ? "opacity-0" : "opacity-100",
                  )}
                />
                <span>No parent</span>
              </CommandItem>
              <CommandEmpty>No matches.</CommandEmpty>
              {filtered.map((worktree) => (
                <CommandItem
                  key={worktree.id}
                  value={worktree.id}
                  onSelect={() => {
                    onChange(worktree.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "size-3.5",
                      worktree.id === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">
                      {worktree.title || worktree.branch || worktree.path}
                    </div>
                    {worktree.branch ? (
                      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] leading-none text-muted-foreground">
                        <GitBranch className="size-3 shrink-0" />
                        <span className="truncate">{worktree.branch}</span>
                      </div>
                    ) : null}
                  </div>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <p className="text-[11px] text-muted-foreground">
        Nests this workspace under another in the sidebar. Does not change the
        base branch.
      </p>
    </div>
  );
}
