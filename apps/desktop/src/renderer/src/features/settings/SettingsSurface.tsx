// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/settings/SettingsSidebar.tsx
//     (section-nav list with an active row)
// Adapted: no zustand store or repo sections — a controlled five-section
// nav; the pane renders the matching section only.
import { useState } from "react";
import type { Harness } from "../../../../shared/session-contract";
import type { HarnessAgentDefault, Theme } from "../../settings-store";
import { AgentsSection } from "./agents-section";
import { AppearanceSection } from "./appearance-section";
import { GitSection } from "./git-section";
import { NotificationsSection } from "./notifications-section";
import { ShortcutsSection } from "./shortcuts-section";
import {
  DEFAULT_SETTINGS_SECTION,
  isSettingsSectionId,
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "./settings-sections";

export type SettingsSurfaceProps = {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  terminalFontSize: number;
  onTerminalFontSizeChange: (size: number) => void;
  inspectorVisible: boolean;
  onInspectorChange: (visible: boolean) => void;
  harnesses: Harness[];
  defaultHarnessId: string;
  onDefaultHarnessChange: (harnessId: string) => void;
  harnessDefaults: Record<string, HarnessAgentDefault>;
  onHarnessDefaultChange: (
    harnessId: string,
    next: HarnessAgentDefault,
  ) => void;
  notifyOnAgentNeedsInput: boolean;
  onNotifyChange: (next: boolean) => void;
  /** Selected workspace path for the git probe; null renders the honest empty state. */
  workspacePath: string | null;
  initialSection?: SettingsSectionId;
};

export function SettingsSurface(props: SettingsSurfaceProps): React.JSX.Element {
  const [section, setSection] = useState<SettingsSectionId>(
    props.initialSection && isSettingsSectionId(props.initialSection)
      ? props.initialSection
      : DEFAULT_SETTINGS_SECTION,
  );
  return (
    <div className="settings-surface">
      <nav className="settings-surface-nav" aria-label="Settings sections">
        {SETTINGS_SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-current={section === entry.id ? "page" : undefined}
            className={
              section === entry.id
                ? "settings-nav-item settings-nav-item-active"
                : "settings-nav-item"
            }
            onClick={() => setSection(entry.id)}
          >
            {entry.title}
          </button>
        ))}
      </nav>
      <div className="settings-surface-pane">
        {section === "appearance" ? (
          <AppearanceSection
            theme={props.theme}
            onThemeChange={props.onThemeChange}
            terminalFontSize={props.terminalFontSize}
            onTerminalFontSizeChange={props.onTerminalFontSizeChange}
            inspectorVisible={props.inspectorVisible}
            onInspectorChange={props.onInspectorChange}
          />
        ) : null}
        {section === "agents" ? (
          <AgentsSection
            harnesses={props.harnesses}
            defaultHarnessId={props.defaultHarnessId}
            onDefaultHarnessChange={props.onDefaultHarnessChange}
            harnessDefaults={props.harnessDefaults}
            onHarnessDefaultChange={props.onHarnessDefaultChange}
          />
        ) : null}
        {section === "shortcuts" ? <ShortcutsSection /> : null}
        {section === "git" ? <GitSection workspacePath={props.workspacePath} /> : null}
        {section === "notifications" ? (
          <NotificationsSection
            notifyOnAgentNeedsInput={props.notifyOnAgentNeedsInput}
            onNotifyChange={props.onNotifyChange}
          />
        ) : null}
      </div>
    </div>
  );
}
