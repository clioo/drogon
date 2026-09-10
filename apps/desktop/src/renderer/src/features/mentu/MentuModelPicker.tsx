// MIT Copyright (c) 2026 Lovecast Inc.
// Searchable model picker for one Mentu agent step: the `/model` ergonomics
// the owner asked for. A small trigger opens a popover whose search box
// filters the harness's models underneath as the user types; arrow keys
// move the active row, Enter selects, Escape closes. Provenance is rendered
// per row (host-enumerated = verified, curated known catalog = unverified,
// recipe-observed = unverified, or the exact id the user typed) so an
// unverified id is never dressed up as a host-confirmed one.
//
// The free-text Model Input in `MentuAgentStepEditor` stays the field's
// source of truth: the picker only writes the chosen id into it, so typing
// an id the host did not enumerate is still possible (and stays marked
// unverified).

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import type { ModelOption } from "./mentu-model-registry";
import { filterModelOptions } from "./mentu-model-registry";

type PickerGroup = ModelOption["group"] | "default" | "typed";

type PickerRow = {
  id: string;
  group: PickerGroup;
  verified: boolean;
  recommended: boolean;
  notes: string[];
  label: string;
};

const LIST_ID = "recipe-step-model-listbox";
const rowDomId = (index: number) => `recipe-step-model-option-${index}`;

function groupLabel(row: PickerRow): { text: string; className: string } {
  switch (row.group) {
    case "catalog":
      return row.recommended
        ? {
            text: "recommended",
            className: "text-emerald-600 dark:text-emerald-400",
          }
        : { text: "host-verified", className: "text-emerald-600 dark:text-emerald-400" };
    case "known":
      return {
        text: "known catalog · unverified",
        className: "text-amber-600 dark:text-amber-400",
      };
    case "observed":
      return {
        text: "from this recipe · unverified",
        className: "text-muted-foreground",
      };
    case "typed":
      return { text: "typed · unverified", className: "text-muted-foreground" };
    default:
      return { text: "harness default", className: "text-muted-foreground" };
  }
}

export function MentuModelPicker({
  options,
  selected,
  disabled = false,
  emptyReason = null,
  onSelect,
}: {
  options: ModelOption[];
  /** The step's current exact model id (empty = harness default). */
  selected: string;
  disabled?: boolean;
  /** Why no host model is listed, when the caller knows (rendered in the
   *  empty state so a blank list always explains itself). */
  emptyReason?: string | null;
  onSelect: (model: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const matching = useMemo(
    () => filterModelOptions(options, query),
    [options, query],
  );

  const rows = useMemo<PickerRow[]>(() => {
    const mapped: PickerRow[] = matching.map((option) => ({
      id: option.id,
      group: option.group,
      verified: option.verified,
      recommended: option.recommended,
      notes: option.notes,
      label: option.id,
    }));
    const typed = query.trim();
    const exact = typed && mapped.some((row) => row.id === typed);
    // `/model` ergonomics: a typed id the list does not carry can still be
    // chosen, and stays explicitly unverified.
    if (typed && !exact) {
      mapped.push({
        id: typed,
        group: "typed",
        verified: false,
        recommended: false,
        notes: ["typed by you · not host-enumerated"],
        label: typed,
      });
    }
    // The default row is offered only while searching nothing, so it never
    // shadows a real search result.
    return typed
      ? mapped
      : [
          {
            id: "",
            group: "default",
            verified: true,
            recommended: false,
            notes: ["clears the step's model; the harness default applies"],
            label: "Harness default",
          },
          ...mapped,
        ];
  }, [matching, query]);

  // Keep the active row valid and visible as the list changes.
  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, rows.length - 1)));
  }, [rows.length]);
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`#${rowDomId(activeIndex)}`);
    node?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, open, rows.length]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const choose = (row: PickerRow | undefined) => {
    if (!row) return;
    onSelect(row.id);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, rows.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, rows.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(rows[activeIndex]);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  const active = rows[activeIndex] ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 gap-1 px-2 text-[11px]"
          disabled={disabled}
          aria-label="Browse models"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? LIST_ID : undefined}
        >
          Models
          <ChevronDown className="size-3.5" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
          <Search className="size-3.5 shrink-0 opacity-50" aria-hidden />
          <Input
            ref={searchRef}
            role="combobox"
            aria-label="Search models"
            aria-expanded
            aria-controls={LIST_ID}
            aria-autocomplete="list"
            aria-activedescendant={active ? rowDomId(activeIndex) : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search models…"
            className="h-7 border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
        </div>
        <div
          ref={listRef}
          role="listbox"
          id={LIST_ID}
          aria-label="Models"
          className="max-h-[min(320px,55vh)] overflow-y-auto p-1"
        >
          {matching.length === 0 ? (
            <p
              className="px-2 py-2 text-center text-[11px] text-muted-foreground"
              role="status"
              data-testid="model-picker-empty"
            >
              {emptyReason ??
                "No models listed for this harness. Type an exact id in the Model field — it rides unverified."}
            </p>
          ) : null}
          {rows.map((row, index) => {
              const badge = groupLabel(row);
              const isSelected = row.id === selected && row.group !== "typed";
              return (
                <div
                  key={`${row.group}:${row.id}`}
                  id={rowDomId(index)}
                  role="option"
                  aria-selected={index === activeIndex}
                  data-active={index === activeIndex ? "true" : "false"}
                  className={`flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-xs ${
                    index === activeIndex ? "bg-accent text-accent-foreground" : ""
                  }`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => {
                    // Keep focus in the search input: selecting must not blur
                    // the combobox before Enter/click is processed.
                    event.preventDefault();
                  }}
                  onClick={() => choose(row)}
                >
                  <Check
                    className={`size-3.5 shrink-0 ${isSelected ? "opacity-100" : "opacity-0"}`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate font-medium">{row.label}</span>
                      <span className={`shrink-0 text-[10px] ${badge.className}`}>
                        {badge.text}
                      </span>
                    </span>
                    {row.notes.length > 0 ? (
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {row.notes.join(" · ")}
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })
          }
        </div>
      </PopoverContent>
    </Popover>
  );
}
