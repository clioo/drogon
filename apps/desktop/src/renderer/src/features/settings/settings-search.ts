// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/settings/settings-search.ts
//     (normalize + match a free-text query against title/description/
//      keywords entries)
// Adapted: the reference matches per-row SettingsSearchEntry lists; the MVP
// page matches per-section keyword buckets instead (five sections, no
// per-row search entries yet) — same normalize/match semantics.
import type { SettingsSectionId } from "./settings-sections";

export function normalizeSettingsSearchQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export type SettingsSectionSearchBucket = {
  id: SettingsSectionId;
  title: string;
  description: string;
  keywords: readonly string[];
};

export const SETTINGS_SEARCH_BUCKETS: readonly SettingsSectionSearchBucket[] = [
  {
    id: "agents",
    title: "Agents",
    description: "Default harness and per-harness launch defaults.",
    keywords: ["harness", "model", "agent", "default", "launch", "claude", "pi", "opencode", "cli", "shell command", "drogon-cli"],
  },
  {
    id: "git",
    title: "Git and GitHub",
    description: "Read-only identity and login status on this host.",
    keywords: ["git", "github", "identity", "auth", "login", "gh"],
  },
  {
    id: "appearance",
    title: "Appearance",
    description: "Theme and terminal typography.",
    keywords: ["theme", "dark", "light", "system", "font", "terminal", "text size", "interface", "typography", "family", "weight", "bold", "editor"],
  },
  {
    id: "notifications",
    title: "Notifications",
    description: "When Drogon may interrupt you.",
    keywords: ["notification", "notify", "alert", "input", "sound"],
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    description: "Read-only reference for this window's shortcuts.",
    keywords: ["keyboard", "shortcut", "keys", "keybinding", "hotkey"],
  },
];

function bucketText(bucket: SettingsSectionSearchBucket): string {
  return [bucket.title, bucket.description, ...bucket.keywords]
    .join(" ")
    .toLowerCase();
}

/** Every whitespace-separated token must appear somewhere in the bucket. */
export function matchesSettingsSearch(
  query: string,
  bucket: SettingsSectionSearchBucket,
): boolean {
  const normalized = normalizeSettingsSearchQuery(query);
  if (normalized === "") return true;
  const haystack = bucketText(bucket);
  return normalized.split(" ").every((token) => haystack.includes(token));
}

/** Section ids matching the query, in nav order; empty query matches all. */
export function filterSettingsSections(query: string): SettingsSectionId[] {
  return SETTINGS_SEARCH_BUCKETS.filter((bucket) =>
    matchesSettingsSearch(query, bucket),
  ).map((bucket) => bucket.id);
}
