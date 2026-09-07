/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/Landing.tsx GitHubStarButton and
   src/renderer/src/components/landing-github-star-state.ts (adapter: the
   source resolves starring through `window.api.gh` plus the star-nag
   service, which need Orca runtime — this variant keeps local state only
   and opens the repo URL through the shell bridge. The openExternal seam
   is injectable so tests use no network). */
import { Star } from "lucide-react";

export const DROGON_REPO_URL = "https://github.com/clioo/drogon";

export type OpenExternal = (url: string) => Promise<unknown> | unknown;

export function windowShellOpenExternal(
  host: unknown,
): OpenExternal | null {
  if (typeof host !== "object" || host === null) return null;
  const shell = (host as { shell?: { openExternal?: OpenExternal } }).shell;
  return typeof shell?.openExternal === "function" ? shell.openExternal : null;
}

/** Opens the repo URL; extracted so tests fixture the seam (no network). */
export async function openRepoUrl(
  openExternal: OpenExternal | null | undefined,
): Promise<void> {
  await openExternal?.(DROGON_REPO_URL);
}

function defaultOpenExternal(): OpenExternal | null {
  if (typeof window === "undefined") return null;
  return windowShellOpenExternal(window.drogon);
}

export function GitHubStarButton({
  openExternal,
}: {
  openExternal?: OpenExternal | null;
}): React.JSX.Element {
  const open = openExternal ?? defaultOpenExternal();
  return (
    <div className="relative inline-block">
      <button
        className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-amber-500/60 px-4 py-1.5 text-[13px] font-medium text-amber-700 transition-all duration-300 hover:border-amber-500/80 hover:bg-amber-400/10 dark:border-amber-400/30 dark:text-amber-300/90 dark:hover:border-amber-400/50 dark:hover:bg-amber-400/[0.08]"
        onClick={() => void openRepoUrl(open)}
      >
        <Star className="size-3.5 text-amber-600 transition-all duration-300 dark:text-amber-400/80" />
        Star on GitHub
      </button>
    </div>
  );
}
