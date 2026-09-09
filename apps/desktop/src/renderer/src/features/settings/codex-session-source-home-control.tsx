// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from components/settings/codex-session-source-home-control.tsx (host control).
import { useId, useRef, useState } from "react";
import { Info } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip";
export type AgentSessionSourceHomeControl = {
  runtimeLabel: string;
  value: string;
  onSave: (value: string) => void;
};
export function AgentSessionSourceHomeInput({
  runtimeLabel,
  value,
  onSave,
}: AgentSessionSourceHomeControl) {
  const [draft, setDraft] = useState(value);
  const cancel = useRef(false);
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        Codex home to import from
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="About importing Codex history"
              className="grid size-4 place-items-center rounded text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Info className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6} className="max-w-xs">
            Drogon runs Codex in an isolated home. Point this at your existing
            Codex home to import that session history. Empty uses ~/.codex.
          </TooltipContent>
        </Tooltip>
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (!cancel.current) onSave(draft.trim());
            cancel.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.stopPropagation();
              cancel.current = true;
              setDraft(value);
              event.currentTarget.blur();
            }
          }}
          placeholder={runtimeLabel}
          spellCheck={false}
          className="h-7 flex-1 font-mono text-xs"
        />
        {value.trim() && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              onSave("");
              setDraft("");
            }}
            className="h-7 shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}
