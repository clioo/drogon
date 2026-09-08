// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/editor/EditorViewToggle.tsx. The source
// unifies markdown source/rich/preview plus edit/changes into one segmented
// control; this rewrite has no markdown rich/preview surface (and no
// notebook/mermaid rich modes), so the toggle collapses to the source's own
// CODE_EDIT_TOGGLE_MODES pair for plain code files: Edit | Changes, with
// the source's metadata (FileText/GitCompareArrows icons, "Edit" label,
// "Changes" label with the "Uncommitted changes" hover title that
// disambiguates it from source-control branch changes). Structure,
// classes and copy are otherwise verbatim; `translate()` calls become
// literals (this build has no i18n pipeline) and the CSV/notebook
// metadataOverride plumbing is dropped with the modes it served.
import { FileText, GitCompareArrows, type LucideIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip";

export type EditorToggleValue = "edit" | "changes";

type ViewModeMetadata = { label: string; icon: LucideIcon; title?: string };

const VIEW_MODE_METADATA: Record<EditorToggleValue, ViewModeMetadata> = {
  edit: { label: "Edit", icon: FileText },
  changes: {
    label: "Changes",
    icon: GitCompareArrows,
    // Why: "Changes" collides with the Source Control sidebar's branch
    // changes, which diff against the base ref. This toggle shows
    // uncommitted changes (working tree vs HEAD), so disambiguate in the
    // hover title without repeating the button label.
    title: "Uncommitted changes",
  },
};

const TOGGLE_MODES: readonly EditorToggleValue[] = ["edit", "changes"];

export default function EditorViewToggle({
  value,
  onChange,
}: {
  value: EditorToggleValue;
  onChange: (value: EditorToggleValue) => void;
}): React.JSX.Element {
  return (
    <TooltipProvider delayDuration={300}>
      <ToggleGroup
        type="single"
        size="sm"
        className="h-[23px] [&_[data-slot=toggle-group-item]]:h-[23px] [&_[data-slot=toggle-group-item]]:min-w-[24px] [&_[data-slot=toggle-group-item]]:px-2"
        variant="outline"
        value={value}
        onValueChange={(v) => {
          if (v) {
            onChange(v as EditorToggleValue);
          }
        }}
      >
        {TOGGLE_MODES.map((viewMode) => {
          const metadata = VIEW_MODE_METADATA[viewMode];
          const Icon = metadata.icon;
          const tooltipLabel = metadata.title ?? metadata.label;
          return (
            <Tooltip key={viewMode}>
              <TooltipTrigger asChild>
                <ToggleGroupItem
                  value={viewMode}
                  aria-label={metadata.label}
                  className="h-[23px] min-w-[24px] px-2 aria-[checked=true]:border-foreground/20 aria-[checked=true]:bg-foreground/10 aria-[checked=true]:text-foreground aria-[checked=true]:shadow-xs aria-[checked=true]:hover:bg-foreground/15 aria-[checked=true]:hover:text-foreground data-[state=on]:border-foreground/20 data-[state=on]:bg-foreground/10 data-[state=on]:text-foreground data-[state=on]:shadow-xs data-[state=on]:hover:bg-foreground/15 data-[state=on]:hover:text-foreground"
                >
                  <Icon className="size-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {tooltipLabel}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </ToggleGroup>
    </TooltipProvider>
  );
}
