// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/browser-pane/assemble-chrome/browser-page-chrome-banners.tsx
//   (resource-notice row shape)
//   src/renderer/src/components/browser-pane/navigate/browser-load-failure-overlay.tsx
//   (failure copy: Retry, Copy Address, Open Externally, Can't reach {host})
// Adapted to the MVP subset: a load-failed banner with retry and a blocked
// navigation notice. Certificate, SSH-route, guest-recovery and annotation
// rows are not ported (listed in the PR).

export type BrowserChromeBanner =
  | {
      kind: "failed";
      title: string;
      description: string;
      canOpenExternal: boolean;
    }
  | {
      kind: "blocked";
      reason: string;
    }
  | {
      kind: "notice";
      text: string;
    };

export function BrowserChromeBanners({
  banner,
  onRetry,
  onCopyAddress,
  onOpenExternal,
  onDismiss,
}: {
  banner: BrowserChromeBanner | null;
  onRetry: () => void;
  onCopyAddress: () => void;
  onOpenExternal: () => void;
  onDismiss: () => void;
}): React.JSX.Element | null {
  if (!banner) return null;
  if (banner.kind === "notice") {
    return (
      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-background px-3 py-1.5 text-xs text-muted-foreground">
        <span>{banner.text}</span>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-muted-foreground/60 hover:text-foreground"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    );
  }
  if (banner.kind === "blocked") {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 border-b border-border/60 bg-accent px-3 py-1.5 text-xs text-foreground/90"
      >
        <span className="min-w-0 flex-1 truncate">
          Blocked navigation: {banner.reason}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-muted-foreground/60 hover:text-foreground"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    );
  }
  return (
    <div
      role="alert"
      className="flex items-center gap-2 border-b border-border/60 bg-accent px-3 py-1.5 text-xs text-foreground/90"
    >
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{banner.title}</span>
        {banner.description ? (
          <span className="text-muted-foreground"> — {banner.description}</span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded px-2 py-0.5 font-medium text-foreground transition-colors hover:bg-black/8 dark:hover:bg-white/14"
      >
        Retry
      </button>
      <button
        type="button"
        onClick={onCopyAddress}
        className="shrink-0 rounded px-2 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        Copy Address
      </button>
      {banner.canOpenExternal ? (
        <button
          type="button"
          onClick={onOpenExternal}
          className="shrink-0 rounded px-2 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          Open Externally
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 text-muted-foreground/60 hover:text-foreground"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
