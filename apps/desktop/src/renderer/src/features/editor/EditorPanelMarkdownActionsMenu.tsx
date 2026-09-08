// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/editor/EditorPanelMarkdownActionsMenu.tsx.
// Structure, classes and copy are verbatim. Data-layer adaptations: this
// build keeps ONE pane-local wrap preference for both surfaces (the fork
// splits editorWordWrap/diffWordWrap across settings — the checkbox
// reflects and drives whichever surface is visible), and whitespace state
// is pane-local too. "Show Whitespace" renders only on the changes diff
// surface like the source. "Export as PDF" renders for markdown files but
// stays disabled with the source's copy: the fork enables it only with a
// rendered markdown document to export, which this Monaco-only build
// never has. The front-matter toggle is omitted — the fork renders it
// only when eligible, and nothing here is ever eligible.
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";

export function EditorPanelMarkdownActionsMenu({
  isMarkdown,
  isDiffSurface,
  wordWrapChecked,
  showWhitespace,
  onToggleWordWrap,
  onToggleWhitespace,
}: {
  isMarkdown: boolean;
  isDiffSurface: boolean;
  /** Pane wrap preference; drives the visible surface (editor or diff). */
  wordWrapChecked: boolean;
  /** Diff-only whitespace preference; ignored for the normal editor. */
  showWhitespace: boolean;
  onToggleWordWrap: () => void;
  onToggleWhitespace: () => void;
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          aria-label="More actions"
          title="More actions"
        >
          <MoreHorizontal size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4}>
        <DropdownMenuCheckboxItem checked={wordWrapChecked} onCheckedChange={onToggleWordWrap}>
          Word Wrap
        </DropdownMenuCheckboxItem>
        {isDiffSurface ? (
          <DropdownMenuCheckboxItem
            checked={showWhitespace}
            onCheckedChange={onToggleWhitespace}
          >
            Show Whitespace
          </DropdownMenuCheckboxItem>
        ) : null}
        {isMarkdown ? <DropdownMenuSeparator /> : null}
        {isMarkdown ? (
          <DropdownMenuItem
            // Why: source/Monaco fallbacks have no rendered document DOM to export.
            disabled
          >
            Export as PDF
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
