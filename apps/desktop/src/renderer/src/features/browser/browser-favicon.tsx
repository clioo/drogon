// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/browser-favicon.tsx
// Adapted: the browser host in this build exposes no favicon URL (see
// BrowserTabState), so every tab renders the Globe fallback today — the
// component keeps the fork's shape (http(s)/data-image allowlist, error
// fallback, Globe) so a future favicon pipeline plugs in without
// touching the strip.
import { useState } from "react";
import { Globe } from "lucide-react";
import { cn } from "../tasks/cn";

function displayableFaviconUrl(faviconUrl: string | null | undefined): string | null {
  const trimmed = faviconUrl?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("data:image/")) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

export function BrowserFavicon({
  faviconUrl,
  className,
  fallbackClassName,
}: {
  faviconUrl: string | null | undefined;
  className?: string;
  fallbackClassName?: string;
}): React.JSX.Element {
  const displayUrl = displayableFaviconUrl(faviconUrl);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  // Why: reset during render on any favicon identity change — including a clear to null while
  // a page loads — so navigating back to the same url retries instead of keeping the fallback.
  if (failedUrl !== null && failedUrl !== displayUrl) {
    setFailedUrl(null);
  }

  if (displayUrl && failedUrl !== displayUrl) {
    return (
      <img
        src={displayUrl}
        alt=""
        aria-hidden
        draggable={false}
        decoding="async"
        loading="lazy"
        className={cn(
          "shrink-0 rounded-sm object-contain drop-shadow-[0_0_1px_var(--foreground)]",
          className,
        )}
        onError={() => setFailedUrl(displayUrl)}
      />
    );
  }

  return <Globe className={cn("shrink-0", className, fallbackClassName)} aria-hidden={true} />;
}
