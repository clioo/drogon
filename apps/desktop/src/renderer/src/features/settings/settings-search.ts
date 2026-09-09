// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/settings/settings-search.ts
//     (normalize + match a free-text query against title/description/
//      keywords entries)
// Adapted: the reference matches per-row SettingsSearchEntry lists; the MVP
// page matches per-section keyword buckets instead (seven sections, no
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
    description: "Manage AI agents, set a default, and customize commands.",
    keywords: [
      "harness",
      "model",
      "agent",
      "default",
      "launch",
      "claude",
      "pi",
      "opencode",
      "codex", "antigravity", "hooks", "status", "working", "waiting", "done",
      "auto-generate", "tab titles", "prompt", "cache", "timer", "duration", "ttl",
      "awake", "sleep", "power", "permissions", "yolo", "manual", "arguments", "cli",
      "environment", "command override", "installed", "detection", "enabled", "disabled",
    ],
  },
  {
    id: "general",
    title: "General",
    description: "Workspace defaults, app setup, and maintenance.",
    keywords: ["general", "workspace", "delete", "deleting", "ask", "ask before", "confirm", "confirmation", "automation", "cli", "shell command", "drogon-cli", "star", "github", "support", "browser", "search", "search engine", "google", "duckduckgo", "bing", "kagi", "address bar"],
  },
  {
    id: "git",
    title: "Git and GitHub",
    description: "Read-only identity and login status on this host.",
    keywords: ["git", "github", "identity", "auth", "login", "gh"],
  },
  {
    id: "terminal",
    title: "Terminal",
    description: "Shells, renderer, sessions, and terminal behavior.",
    keywords: [
      "terminal",
      "shell",
      "shells",
      "renderer",
      "sessions",
      "kill",
      "refresh",
      "behavior",
      "manage",
      "scroll",
      "scrolling",
      "speed",
      "sensitivity",
      "multiplier",
      "normal",
      "fast",
      "wheel",
      "mouse",
      "trackpad",
      "tui",
      "opencode",
      "right click",
      "right-click",
      "paste",
      "context menu",
      "focus-follows-mouse",
      "active",
      "copy-on-select",
      "focus",
      "follows",
      "hover",
      "pane",
      "ghostty",
      "copy",
      "select",
      "selection",
      "auto",
      "automatic",
      "clipboard",
      "x11",
      "linux",
      "gnome",
      "osc 52",
      "osc52",
      "zellij",
      "tmux",
      "neovim",
      "nvim",
      "fzf",
      "grok",
      "ssh",
      "remote",
      "scrollback",
      "rows",
      "buffer",
      "memory",
      "word",
      "separator",
      "boundary",
      "double-click",
      "option",
      "alt",
      "key",
      "meta",
      "compose",
      "mac",
      "macos",
      "german",
      "international",
      "readline",
      "jis",
      "yen",
      "backslash",
      "japanese",
      "intl",
    ],
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

function matchesSearchToken(haystack: string, token: string): boolean {
  // Short queries such as "cli" should not accidentally match the middle of
  // unrelated words such as "clipboard"; longer queries retain the source's
  // forgiving substring behavior ("notify" matches "notifications").
  if (token.length <= 3) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`).test(haystack);
  }
  return haystack.includes(token);
}

/** Every whitespace-separated token must appear somewhere in the bucket. */
export function matchesSettingsSearch(
  query: string,
  bucket: SettingsSectionSearchBucket,
): boolean {
  const normalized = normalizeSettingsSearchQuery(query);
  if (normalized === "") return true;
  const haystack = bucketText(bucket);
  return normalized
    .split(" ")
    .every((token) => matchesSearchToken(haystack, token));
}

/** Section ids matching the query, in nav order; empty query matches all. */
export function filterSettingsSections(query: string): SettingsSectionId[] {
  return SETTINGS_SEARCH_BUCKETS.filter((bucket) =>
    matchesSettingsSearch(query, bucket),
  ).map((bucket) => bucket.id);
}
