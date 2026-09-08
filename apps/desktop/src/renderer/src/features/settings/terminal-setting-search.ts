// MIT Copyright (c) 2026 Lovecast Inc. Adapted from the Orca reference's
// SettingsSearchEntry/matchesSettingsSearch grammar for Drogon's single
// Terminal settings surface.

import { matchesSettingsSearch } from "./settings-search";

export function matchesTerminalSetting(
  query: string,
  title: string,
  description: string,
  keywords: readonly string[] = [],
): boolean {
  return matchesSettingsSearch(query, {
    id: "terminal",
    title,
    description,
    keywords,
  });
}
