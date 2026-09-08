// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/settings/ShortcutRowsList.tsx
//     (group headers with rows underneath, empty-filter state)
// Adapted: read-only rows (no recording/removal), plain props, chords and
// groups from the keybinding core table; disabled rows show their reason.
import { useMemo, useState } from "react";
import { Input } from "../../components/ui/input";
import { keybindingGroupOrder } from "../../../../shared/keybindings/definitions";
import { formatKeybindingList } from "../../../../shared/keybindings/labels";
import {
  buildShortcutList,
  filterShortcuts,
  formatEntryBinding,
  resolveShortcutPlatform,
} from "./shortcut-labels";
import { SettingsSection } from "./settings-rows";

export function ShortcutsSection(): React.JSX.Element {
  const [query, setQuery] = useState("");
  const platform = resolveShortcutPlatform(
    typeof navigator === "undefined" ? "" : navigator.userAgent,
  );
  const entries = useMemo(() => buildShortcutList(platform), [platform]);
  const visible = filterShortcuts(entries, query);
  const groups = keybindingGroupOrder()
    .map((group) => ({
      group,
      rows: visible.filter((entry) => entry.group === group),
    }))
    .filter((item) => item.rows.length > 0);
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
        <div
          role="status"
          className="rounded-md border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground"
        >
          No shortcuts match those filters.
        </div>
      ) : (
        <div className="settings-shortcut-groups">
          {groups.map(({ group, rows }) => (
            <div key={group}>
              <h3 className="settings-shortcut-group-title">{group}</h3>
              <ul className="settings-shortcut-list">
                {rows.map((row) => {
                  const kbPlatform =
                    platform === "darwin" ? "darwin" : "linux";
                  const status = row.definition.status;
                  return (
                    <li key={row.id} className="settings-shortcut-row">
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="settings-shortcut-title">
                          {row.title}
                        </span>
                        {status.kind !== "implemented" ? (
                          <span className="settings-note">
                            {status.kind === "disabled"
                              ? `Unavailable: ${status.reason}`
                              : status.note}
                          </span>
                        ) : null}
                      </span>
                      <span
                        className="settings-shortcut-keys"
                        aria-label={formatKeybindingList(
                          row.bindings,
                          kbPlatform,
                        )}
                      >
                        {row.bindings.length === 0 ? (
                          <span className="settings-unavailable">
                            Unassigned
                          </span>
                        ) : (
                          row.bindings.map((binding, chordIndex) => (
                            <span
                              key={binding}
                              className="inline-flex items-center gap-1"
                            >
                              {chordIndex > 0 ? (
                                <span aria-hidden="true">, </span>
                              ) : null}
                              {formatEntryBinding(binding, platform).map(
                                (key, index) => (
                                  <kbd key={index} className="settings-kbd">
                                    {key}
                                  </kbd>
                                ),
                              )}
                            </span>
                          ))
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
