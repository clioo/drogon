// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/settings/BrowserSearchEngineSetting.tsx
//     (Default Search Engine select over SEARCH_ENGINE_LABELS)
// Adapted: no SearchableSetting wrapper or Kagi session-link form in this
// build (no per-row search entries, no Kagi backend) — the row uses this
// repo's SettingsRow grammar and persists through the browser feature's
// search-engine preference seam, which the address bar reads.

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  listSearchEngines,
  readBrowserSearchEngine,
  SEARCH_ENGINE_LABELS,
  writeBrowserSearchEngine,
  type SearchEngine,
} from "../browser/browser-search-engine";
import { SettingsRow } from "./settings-rows";

export function BrowserSearchEngineSetting(): React.JSX.Element {
  const [engine, setEngine] = useState<SearchEngine>(readBrowserSearchEngine);
  return (
    <SettingsRow
      label="Default Search Engine"
      description="Search engine used when typing non-URL text in the address bar."
      control={
        <Select
          value={engine}
          onValueChange={(value) => {
            if (value === engine) return;
            const next = value as SearchEngine;
            setEngine(next);
            writeBrowserSearchEngine(next);
          }}
        >
          <SelectTrigger
            aria-label="Default Search Engine"
            className="h-7 w-36 text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {listSearchEngines().map((option) => (
              <SelectItem key={option} value={option} className="text-xs">
                {SEARCH_ENGINE_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}
