// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/browser-pane/assemble-chrome/browser-navigation-control-row.tsx
// Adapted: translate() calls are plain English strings (Drogon has no i18n
// catalog) and the Button comes from the local shadcn port. The tour-anchor
// prop is dropped (no contextual tour in this build).
import { ArrowLeft, ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "../tasks/cn";
import { BROWSER_CHROME_ADDRESS_SLOT_ATTRIBUTE } from "./browser-chrome-address-slot";

/**
 * The history/reload/navigate surface the browser host backs: back,
 * forward, reload, then whatever names the thing on screen.
 *
 * Why the middle is a slot rather than the address bar: a web page is named by a URL you may
 * retype, a workspace document by a path you may not. Both still sit in the same place, at the
 * same size, between the same controls — so the identity widget is what varies, not the row.
 */
export type BrowserNavigationControls = {
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  navigate: (url: string) => void;
};

export function BrowserNavigationControlRow({
  controls,
  addressSlot,
  reloadControl,
  reloadLabel,
  children,
}: {
  controls: BrowserNavigationControls;
  /** The surface's identity widget: the editable address bar. */
  addressSlot: React.ReactNode;
  reloadControl?: React.ReactNode;
  /** Accessible name for the default reload button, which doubles as Stop and Retry. */
  reloadLabel?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="relative z-10 flex shrink-0 items-center gap-2 border-b border-border/70 bg-background/95 px-3 py-1.5">
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={controls.goBack}
        disabled={!controls.canGoBack}
        aria-label="Back"
      >
        <ArrowLeft className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={controls.goForward}
        disabled={!controls.canGoForward}
        aria-label="Forward"
      >
        <ArrowRight className="size-4" />
      </Button>
      {reloadControl ?? (
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={controls.reload}
          aria-label={reloadLabel ?? "Reload"}
        >
          {controls.loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
        </Button>
      )}

      <div
        className={cn(
          "flex min-w-0 flex-1 items-stretch",
          "h-7",
        )}
        {...{ [BROWSER_CHROME_ADDRESS_SLOT_ATTRIBUTE]: "true" }}
      >
        {addressSlot}
      </div>

      {children}
    </div>
  );
}
