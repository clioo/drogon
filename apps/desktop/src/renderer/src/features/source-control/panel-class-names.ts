// MIT Copyright (c) 2026 Lovecast Inc. Local class-name joiner and
// repo-relative path display helpers for features/source-control. Mirrors
// the shared button's clsx + tailwind-merge joiner and Orca's lib/path
// basename/dirname semantics (forward-slash relative paths only).
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(...inputs));
}

/**
 * Final `/`-separated segment; the whole path when it has no separator.
 * Trailing slashes (untracked directory entries like `fresh-dir/`) are
 * stripped first so the row still names the directory.
 */
export function basename(path: string): string {
  const trimmed = path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
  const index = trimmed.lastIndexOf("/");
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

/** Everything before the final `/`; `"."` when there is no directory. */
export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "." : path.slice(0, index);
}
