// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/settings/ShortcutRowsList.tsx
//     (group headers with rows underneath, empty-filter state)
// Adapted: read-only rows (no recording/removal), local chord labels, no
// i18n store — plain props.
import { useMemo, useState } from "react";
import { Input } from "../../components/ui/input";
import {
  buildShortcutList,
  filterShortcuts,
  formatChordForPlatform,
  resolveShortcutPlatform,
  type ShortcutGroup,
} from "./shortcut-labels";
import { SettingsSection } from "./settings-rows";

const GROUP_ORDER: ShortcutGroup[] = ["Settings", "Terminals", "Commands", "Tabs"];

export function ShortcutsSection(): React.JSX.Element {
  const [query, setQuery] = useState("");
  const entries = useMemo(() => buildShortcutList(), []);
  const platform = resolveShortcutPlatform(
    typeof navigator === "undefined" ? "" : navigator.userAgent,
  );
  const visible = filterShortcuts(entries, query);
  const groups = GROUP_ORDER.map((group) => ({
    group,
    rows: visible.filter((entry) => entry.group === group),
  })).filter((item) => item.rows.length > 0);
  return (
    <SettingsSection
      id="shortcuts"
      title="Keyboard shortcuts"
      description="What each shortcut does in this window. Shortcuts cannot be changed here."
    >
      <Input
        type="search"
        aria-label="Search shortcuts"
        placeholder="Search shortcuts"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {groups.length === 0 ? (
        <p role="status" className="settings-empty">
          No shortcuts match that search.
        </p>
      ) : (
        <div className="settings-shortcut-groups">
          {groups.map(({ group, rows }) => (
            <div key={group}>
              <h3 className="settings-shortcut-group-title">{group}</h3>
              <ul className="settings-shortcut-list">
                {rows.map((row) => (
                  <li key={row.id} className="settings-shortcut-row">
                    <span className="settings-shortcut-title">{row.title}</span>
                    <span
                      className="settings-shortcut-keys"
                      aria-label={formatChordForPlatform(row.chord, platform).join(
                        platform === "darwin" ? "" : "+",
                      )}
                    >
                      {formatChordForPlatform(row.chord, platform).map(
                        (key, index) => (
                          <kbd key={index} className="settings-kbd">
                            {key}
                          </kbd>
                        ),
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
