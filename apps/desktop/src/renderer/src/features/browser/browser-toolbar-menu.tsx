// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/browser-pane/assemble-chrome/BrowserToolbarMenu.tsx
//   src/renderer/src/components/browser-pane/assemble-chrome/browser-toolbar-menu-dropdown.tsx
// Adapted to the MVP subset the task names: open in system browser (through
// the shell bridge), copy URL, reload, zoom in/out/reset, find in page.
// Profiles, cookie import, viewport presets and settings rows are not
// ported (listed in the PR). The openExternal/clipboard seams are
// injectable so tests use no shell or OS clipboard.
import { useState } from "react";
import { Ellipsis } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../tasks/ui/dropdown-menu";
import type { OpenExternal } from "../landing/github-star";
import { windowShellOpenExternal } from "../landing/github-star";
import {
  resolveBrowserToolbarMenuPolicy,
  type BrowserToolbarMenuPolicy,
} from "./browser-menu-policy";

export { resolveBrowserToolbarMenuPolicy };
export type { BrowserToolbarMenuPolicy };

/**
 * Fork copy for the rows that carry a shortcut hint (the fork never renders
 * a raw `Mod+` token as visible text). The hints follow the chord notation
 * the rest of the app uses: ⌘ glyphs on macOS, Ctrl+ words elsewhere.
 */
export const BROWSER_MENU_RELOAD_LABEL = "Reload";
export const BROWSER_MENU_FIND_LABEL = "Find in page...";
export const BROWSER_MENU_RESET_ZOOM_LABEL = "Reset zoom";

export type BrowserMenuHintRow = "reload" | "find";

export function getBrowserMenuShortcutHint(row: BrowserMenuHintRow, platform: string): string {
  const key = row === "reload" ? "R" : "F";
  return /mac/i.test(platform) ? `⌘${key}` : `Ctrl+${key}`;
}

export function BrowserToolbarMenu({
  pageUrl,
  externalUrl,
  zoomPercent,
  onReload,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onFind,
  openExternal,
  writeClipboardText,
}: {
  pageUrl: string;
  externalUrl: string | null;
  zoomPercent: number;
  onReload: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onFind: () => void;
  openExternal?: OpenExternal | null;
  writeClipboardText?: (text: string) => void;
}): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const platform = typeof navigator === "undefined" ? "" : (navigator.platform ?? "");
  const reloadHint = getBrowserMenuShortcutHint("reload", platform);
  const findHint = getBrowserMenuShortcutHint("find", platform);
  const open = openExternal ?? windowShellOpenExternal(window.drogon);
  const copy = writeClipboardText ?? ((text: string) => void navigator.clipboard?.writeText(text).catch(() => {}));
  const close = (): void => setMenuOpen(false);

  return (
    <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title="Browser menu"
          aria-label="Browser menu"
          data-testid="browser-toolbar-menu-trigger"
        >
          <Ellipsis className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" data-testid="browser-toolbar-menu">
        <DropdownMenuItem
          disabled={!externalUrl}
          onSelect={() => {
            if (externalUrl) void open?.(externalUrl);
            close();
          }}
        >
          Open in system browser
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!pageUrl}
          onSelect={() => {
            if (pageUrl) copy(pageUrl);
            close();
          }}
        >
          Copy URL
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            onReload();
            close();
          }}
        >
          {BROWSER_MENU_RELOAD_LABEL}
          <span className="ml-auto text-xs tracking-widest opacity-60">{reloadHint}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            onZoomIn();
          }}
        >
          Zoom in
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            onZoomOut();
          }}
        >
          Zoom out
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            onZoomReset();
          }}
        >
          {BROWSER_MENU_RESET_ZOOM_LABEL}
          <span className="ml-auto text-xs tracking-widest opacity-60">{zoomPercent}%</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            onFind();
            close();
          }}
        >
          {BROWSER_MENU_FIND_LABEL}
          <span className="ml-auto text-xs tracking-widest opacity-60">{findHint}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
