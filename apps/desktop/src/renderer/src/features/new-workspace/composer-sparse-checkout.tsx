/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sparse/SparseCheckoutPresetSelect.tsx.
   Adapter: preset persistence is the daemon's project.sparsePresets /
   project.saveSparsePreset RPC pair; creation still consumes plain
   repo-relative `git sparse-checkout set` directories. */
import React, { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Pencil, Plus } from "lucide-react";
import type { SparsePresetResult } from "../../../../shared/project-contract";
import { Button } from "../../components/ui/button";
import {
  Command,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "../../components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { cn } from "../../lib/utils";

function parseDirectories(value: string): {
  directories: string[];
  error: string | null;
} {
  const seen = new Set<string>();
  const directories: string[] = [];
  for (const rawValue of value.split(/\r?\n/)) {
    const raw = rawValue.trim();
    if (!raw) continue;
    if (
      raw.startsWith("/") ||
      raw.startsWith("\\") ||
      raw.split("/").includes("..")
    ) {
      return {
        directories: [],
        error:
          "Use repo-relative directories, not root, absolute paths, or parent segments.",
      };
    }
    const normalized = raw.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    if (!normalized || normalized === ".") continue;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      directories.push(normalized);
    }
  }
  return directories.length
    ? { directories, error: null }
    : { directories: [], error: "Add at least one directory." };
}

export function ComposerSparseCheckout({
  presets,
  selectedPresetId,
  onSelectPreset,
  onSavePreset,
  disabled = false,
}: {
  presets: readonly SparsePresetResult[];
  selectedPresetId: string | null;
  onSelectPreset: (preset: SparsePresetResult | null) => void;
  onSavePreset: (input: {
    id?: string;
    name: string;
    directories: string[];
  }) => Promise<SparsePresetResult | null>;
  disabled?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{
    id?: string;
    name: string;
    directoriesText: string;
  } | null>(null);
  const selected = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) ?? null,
    [presets, selectedPresetId],
  );
  const parsed = draft ? parseDirectories(draft.directoriesText) : null;
  const nameError =
    draft && !draft.name.trim()
      ? "Name is required."
      : draft && draft.name.trim().length > 80
        ? "Name must be 80 characters or fewer."
        : null;
  const canSave = Boolean(draft && parsed && !parsed.error && !nameError);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setDraft(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-9 w-full justify-between border-input px-3 text-sm font-normal text-foreground focus:border-ring focus:ring-[3px] focus:ring-ring/50"
        >
          <span className="truncate">{selected?.name ?? "Off"}</span>
          <ChevronsUpDown className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[17rem] p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {draft ? (
          <div className="space-y-3 p-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Preset name
              </label>
              <input
                autoFocus
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                // Why (source SparseCheckoutPresetDraftForm): preset names
                // and directory lists are identifiers/paths, not prose.
                maxLength={80}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Repo-relative directories
              </label>
              <textarea
                rows={4}
                value={draft.directoriesText}
                onChange={(event) =>
                  setDraft({ ...draft, directoriesText: event.target.value })
                }
                placeholder="apps/desktop\ncrates"
                // Why (source SparseCheckoutPresetDraftForm): paths, not prose.
                spellCheck={false}
                className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-1.5 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>
            {nameError || parsed?.error ? (
              <p className="text-[11px] text-destructive">
                {nameError ?? parsed?.error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setDraft(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!canSave}
                onClick={() => {
                  if (!draft || !parsed || parsed.error || !canSave) return;
                  void onSavePreset({
                    id: draft.id,
                    name: draft.name.trim(),
                    directories: parsed.directories,
                  }).then((saved) => {
                    if (saved) {
                      onSelectPreset(saved);
                      setDraft(null);
                      setOpen(false);
                    }
                  });
                }}
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          <Command>
            <CommandList>
              <CommandItem
                value="off"
                onSelect={() => {
                  onSelectPreset(null);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "size-4",
                    selected ? "opacity-0" : "opacity-100",
                  )}
                />
                <span>Off</span>
              </CommandItem>
              {presets.length > 0 ? <CommandSeparator /> : null}
              {presets.map((preset) => (
                <CommandItem
                  key={preset.id}
                  value={preset.id}
                  onSelect={() => {
                    onSelectPreset(preset);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "size-4 shrink-0",
                      selected?.id === preset.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{preset.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Edit ${preset.name}`}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setDraft({
                        id: preset.id,
                        name: preset.name,
                        directoriesText: preset.directories.join("\n"),
                      });
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </CommandItem>
              ))}
              <CommandSeparator />
              <CommandItem
                value="new-preset"
                onSelect={() => setDraft({ name: "", directoriesText: "" })}
              >
                <Plus className="size-4 shrink-0" />
                <span>New preset</span>
              </CommandItem>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}
