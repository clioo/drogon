// MIT Copyright (c) 2026 Lovecast Inc.
// The Meetings filter bar. There is no equivalent in the reference fork (its
// page browsed a snapshot it had already loaded), so this is built from the
// product's own primitives and tokens — `Input`, the Radix `Select` the Tasks
// source bar uses (`h-8 … border-border/50 bg-muted/50 text-xs`), and the
// `Button` used for the page's own actions — so the chrome reads as part of
// Drogon rather than bolted on.
//
// Every control here is a *request*, not a local filter: the daemon searches
// the corpus and returns the matching page, which is the only way this stays
// true at 327 transcripts and beyond.
import { Search, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { MAX_MEETINGS_QUERY_CHARS } from "../../../../shared/meetings-contract";
import {
  type MeetingsDurationPreset,
  type MeetingsFilterState,
  type MeetingsWhenPreset,
  customRangeProblem,
  isFilterActive,
} from "./meetings-filters";

const WHEN_OPTIONS: Array<{ value: MeetingsWhenPreset; label: string }> = [
  { value: "any", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "last-7", label: "Last 7 days" },
  { value: "last-30", label: "Last 30 days" },
  { value: "last-90", label: "Last 90 days" },
  { value: "custom", label: "Custom range…" },
];

const DURATION_OPTIONS: Array<{ value: MeetingsDurationPreset; label: string }> = [
  { value: "any", label: "Any length" },
  { value: "up-to-15", label: "Up to 15 min" },
  { value: "15-to-60", label: "15–60 min" },
  { value: "over-60", label: "Over 60 min" },
];

/** The search input's id, so the label and the field are always paired. */
export const MEETINGS_SEARCH_INPUT_ID = "meetings-search";

export function MeetingsFilterBar({
  state,
  loading,
  onChange,
  onClear,
}: {
  state: MeetingsFilterState;
  loading: boolean;
  onChange: (next: Partial<MeetingsFilterState>) => void;
  onClear: () => void;
}): React.JSX.Element {
  const problem = customRangeProblem(state);
  const active = isFilterActive(state);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id={MEETINGS_SEARCH_INPUT_ID}
            type="search"
            value={state.query}
            maxLength={MAX_MEETINGS_QUERY_CHARS}
            onChange={(event) => onChange({ query: event.target.value })}
            placeholder="Search inside every transcript"
            aria-label="Search transcripts"
            className="h-8 rounded-md border-border/50 bg-muted/50 pl-8 text-xs placeholder:text-muted-foreground"
          />
        </div>
        <Select
          value={state.when}
          onValueChange={(value) => onChange({ when: value as MeetingsWhenPreset })}
        >
          <SelectTrigger
            size="sm"
            aria-label="Meeting date"
            className="h-8 w-[150px] rounded-md border-border/50 bg-muted/50 text-xs font-medium shadow-sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WHEN_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={state.duration}
          onValueChange={(value) =>
            onChange({ duration: value as MeetingsDurationPreset })
          }
        >
          <SelectTrigger
            size="sm"
            aria-label="Meeting duration"
            className="h-8 w-[130px] rounded-md border-border/50 bg-muted/50 text-xs font-medium shadow-sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DURATION_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {active ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={onClear}
            disabled={loading}
          >
            <X className="size-3.5" />
            Clear
          </Button>
        ) : null}
      </div>
      {state.when === "custom" ? (
        <div className="flex flex-wrap items-center gap-2">
          <label
            className="text-xs text-muted-foreground"
            htmlFor="meetings-range-from"
          >
            From
          </label>
          <Input
            id="meetings-range-from"
            type="date"
            value={state.from}
            onChange={(event) => onChange({ from: event.target.value })}
            aria-label="Meetings from date"
            aria-invalid={problem !== null ? true : undefined}
            className="h-8 w-[150px] rounded-md border-border/50 bg-muted/50 text-xs"
          />
          <label className="text-xs text-muted-foreground" htmlFor="meetings-range-to">
            To
          </label>
          <Input
            id="meetings-range-to"
            type="date"
            value={state.to}
            onChange={(event) => onChange({ to: event.target.value })}
            aria-label="Meetings to date"
            aria-invalid={problem !== null ? true : undefined}
            className="h-8 w-[150px] rounded-md border-border/50 bg-muted/50 text-xs"
          />
        </div>
      ) : null}
      {problem !== null ? (
        <p role="status" className="text-xs text-muted-foreground">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
