import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@drogon/desktop";
import { Bot, Search, Terminal } from "lucide-react";

/** Inline command palette: search input over a filtered, grouped item list. */
export function Default() {
  return (
    <Command className="w-full max-w-sm border">
      <CommandInput placeholder="Search agents..." />
      <CommandList>
        <CommandEmpty>No agents match your search.</CommandEmpty>
        <CommandGroup>
          <CommandItem>
            <Terminal className="size-4" />
            Blank Terminal
          </CommandItem>
          <CommandItem>
            <Bot className="size-4" />
            Claude Opus
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup>
          <CommandItem>
            <Search className="size-4" />
            Search all files
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
