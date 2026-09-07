// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/browser-pane/assemble-chrome/browser-page-viewport-overlays.tsx
//   (blank-tab overlay, failure overlay)
// Adapted to the MVP subset: no annotate/markup overlays, no certificate or
// SSH rows, no HTTPS-recovery action. The failure overlay keeps the source's
// copy contract (Can't reach {host} / Can't load this page, Retry, Copy
// Address, Open Externally). The find bar and zoom pill live in the pane
// chrome above the viewport, not here: the guest is a native view that
// paints over this DOM, so only states the host hides the guest for
// (loading-before-commit, blank, failed) can render inside this rect.
import { Globe, Loader2 } from "lucide-react";

export type BrowserViewportState =
  | { kind: "page" }
  | { kind: "loading"; url: string }
  | { kind: "blank" }
  | {
      kind: "failed";
      title: string;
      description: string;
      canOpenExternal: boolean;
    };

export function BrowserViewportOverlays({
  viewport,
  onRetry,
  onCopyAddress,
  onOpenExternal,
}: {
  viewport: BrowserViewportState;
  onRetry: () => void;
  onCopyAddress: () => void;
  onOpenExternal: () => void;
}): React.JSX.Element {
  return (
    <>
      {viewport.kind === "failed" ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background px-6">
          <div
            aria-live="polite"
            className="flex max-w-lg flex-col items-center px-8 py-8 text-center"
          >
            <div className="mb-4 rounded-full border border-border bg-muted p-3 text-muted-foreground">
              <Globe className="size-5" />
            </div>
            <h2 className="text-base font-semibold text-foreground">{viewport.title}</h2>
            {viewport.description ? (
              <p className="mt-2 text-sm text-muted-foreground">{viewport.description}</p>
            ) : null}
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-accent"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={onCopyAddress}
                className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                Copy Address
              </button>
              {viewport.canOpenExternal ? (
                <button
                  type="button"
                  onClick={onOpenExternal}
                  className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  Open Externally
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {viewport.kind === "loading" ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background px-6">
          <div className="flex flex-col items-center px-8 py-8 text-center opacity-70">
            <div className="mb-4 rounded-full border border-border/70 bg-muted/30 p-3">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
            <p className="text-base font-semibold text-foreground/85">Loading…</p>
            <p className="mt-2 max-w-md truncate text-sm text-muted-foreground">
              {viewport.url}
            </p>
          </div>
        </div>
      ) : null}
      {viewport.kind === "blank" ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.02),transparent_58%)] px-6">
          <div className="flex flex-col items-center px-8 py-8 text-center opacity-70">
            <div className="mb-4 rounded-full border border-border/70 bg-muted/30 p-3">
              <Globe className="size-5 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-foreground/85">New Tab</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Type a URL above to start browsing.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
