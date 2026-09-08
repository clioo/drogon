// MIT Copyright (c) 2026 Lovecast Inc.
// Ported shell from the Orca reference (read-only):
//   src/renderer/src/components/settings/settings-page-renderer.tsx
//     (settings-view-shell: left SettingsSidebar + scrollable content with
//      max-w-4xl panes, "No settings found" empty state on empty search)
// Adapted: the MVP section list is this repo's five implemented sections
// (no accounts/agents-catalog/repo sections); search filters both the nav
// and the pane, and ⌘F focuses the search field.
import { useEffect, useRef, useState } from "react";
import type { Harness, Project } from "../../../../shared/session-contract";
import type { HarnessAgentDefault, Theme, TerminalGpuAcceleration } from "../../settings-store";
import { AgentsSection } from "./agents-section";
import { AppearanceSection } from "./appearance-section";
import { GitSection } from "./git-section";
import { NotificationsSection } from "./notifications-section";
import { ShortcutsSection } from "./shortcuts-section";
import { SettingsSidebar } from "./SettingsSidebar";
import {
  DEFAULT_SETTINGS_SECTION,
  isSettingsSectionId,
  type SettingsSectionId,
} from "./settings-sections";
import { filterSettingsSections } from "./settings-search";
import {
  matchesProjectSettingsQuery,
  ProjectSettingsSection,
  ProjectSettingsSectionChrome,
} from "./project-settings-section";

/** Page-level section: the five static sections plus the dynamic
   per-project section (R14-A). The static vocabulary in
   settings-sections.ts is untouched — existing tests pin it. */
export type SettingsPageSection = SettingsSectionId | "project";

export type SettingsPageProps = {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  terminalFontSize: number;
  onTerminalFontSizeChange: (size: number) => void;
  terminalGpuAcceleration: TerminalGpuAcceleration;
  onTerminalGpuAccelerationChange: (mode: TerminalGpuAcceleration) => void;
  /** Source typography knobs (optional pass-through; AppearanceSection
   *  falls back to the persisted envelope when omitted). */
  terminalFontFamily?: string;
  onTerminalFontFamilyChange?: (family: string) => void;
  terminalFontWeight?: number;
  onTerminalFontWeightChange?: (weight: number) => void;
  terminalFontWeightBold?: number;
  onTerminalFontWeightBoldChange?: (weight: number) => void;
  editorFontFamily?: string;
  onEditorFontFamilyChange?: (family: string) => void;
  inspectorVisible: boolean;
  onInspectorChange: (visible: boolean) => void;
  /** R14-B appearance flags (View > Appearance submenu marks + shell visibility). */
  statusBarVisible: boolean;
  onStatusBarVisibleChange: (visible: boolean) => void;
  tasksButtonVisible: boolean;
  onTasksButtonVisibleChange: (visible: boolean) => void;
  automationsButtonVisible: boolean;
  onAutomationsButtonVisibleChange: (visible: boolean) => void;
  titlebarAppNameVisible: boolean;
  onTitlebarAppNameVisibleChange: (visible: boolean) => void;
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
  initialSection?: SettingsPageSection;
  /** Per-project section model (R14-A); null hides the project section. */
  project?: Project | null;
  /** Removes the project registration; the page closes on success. */
  onRemoveProject?: (projectId: string) => void;
  onBack: () => void;
};

export function SettingsPage(props: SettingsPageProps): React.JSX.Element {
  const [section, setSection] = useState<SettingsPageSection>(
    props.initialSection &&
      (props.initialSection === "project" ||
        isSettingsSectionId(props.initialSection))
      ? props.initialSection
      : DEFAULT_SETTINGS_SECTION,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ⌘F / Ctrl+F focuses settings search while the page is mounted — the
  // same shortcut the reference binds as settings.search. Escape leaves
  // the page like the old dialog's dismissal (Back to app owns the same
  // action for pointer users).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        props.onBack();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.onBack]);

  const matches = filterSettingsSections(searchQuery);
  const searching = searchQuery.trim() !== "";
  // While searching the pane stacks every match (the reference keeps the
  // pane on the selected match; stacking is this page's honest variant and
  // keeps every control reachable without extra navigation).
  const visible: SettingsSectionId[] =
    section === "project"
      ? []
      : searching
        ? matches
        : matches.includes(section)
          ? [section]
          : matches;
  // The dynamic per-project section (R14-A): selected explicitly, or
  // stacked with the static matches while searching on name/path.
  const showProject =
    props.project != null &&
    (section === "project" ||
      (searching && matchesProjectSettingsQuery(searchQuery, props.project)));

  return (
    <div className="settings-view-shell flex min-h-0 flex-1 overflow-hidden bg-background">
      <SettingsSidebar
        activeSectionId={
          section === "project"
            ? "project"
            : visible.includes(section)
              ? section
              : (visible[0] ?? section)
        }
        visibleSectionIds={searching ? matches : undefined}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchInputRef={searchInputRef}
        searchAutoFocus
        onBack={props.onBack}
        onSelectSection={setSection}
        projectNav={
          props.project
            ? {
                title: `Project Settings > ${props.project.name}`,
                active: section === "project",
              }
            : null
        }
        onSelectProject={() => setSection("project")}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-8 pb-24 pt-10">
            {visible.length === 0 && !showProject ? (
              <div className="flex min-h-[24rem] items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card/30 text-sm text-muted-foreground">
                No settings found for &ldquo;{searchQuery.trim()}&rdquo;
              </div>
            ) : (
              <>
                {visible.includes("agents") ? (
                  <AgentsSection
                    harnesses={props.harnesses}
                    defaultHarnessId={props.defaultHarnessId}
                    onDefaultHarnessChange={props.onDefaultHarnessChange}
                    harnessDefaults={props.harnessDefaults}
                    onHarnessDefaultChange={props.onHarnessDefaultChange}
                  />
                ) : null}
                {visible.includes("git") ? (
                  <GitSection workspacePath={props.workspacePath} />
                ) : null}
                {visible.includes("appearance") ? (
                  <AppearanceSection
                    theme={props.theme}
                    onThemeChange={props.onThemeChange}
                    terminalFontSize={props.terminalFontSize}
                    onTerminalFontSizeChange={props.onTerminalFontSizeChange}
                    terminalGpuAcceleration={props.terminalGpuAcceleration}
                    onTerminalGpuAccelerationChange={
                      props.onTerminalGpuAccelerationChange
                    }
                    terminalFontFamily={props.terminalFontFamily}
                    onTerminalFontFamilyChange={props.onTerminalFontFamilyChange}
                    terminalFontWeight={props.terminalFontWeight}
                    onTerminalFontWeightChange={props.onTerminalFontWeightChange}
                    terminalFontWeightBold={props.terminalFontWeightBold}
                    onTerminalFontWeightBoldChange={
                      props.onTerminalFontWeightBoldChange
                    }
                    editorFontFamily={props.editorFontFamily}
                    onEditorFontFamilyChange={props.onEditorFontFamilyChange}
                    inspectorVisible={props.inspectorVisible}
                    onInspectorChange={props.onInspectorChange}
                    statusBarVisible={props.statusBarVisible}
                    onStatusBarVisibleChange={props.onStatusBarVisibleChange}
                    tasksButtonVisible={props.tasksButtonVisible}
                    onTasksButtonVisibleChange={
                      props.onTasksButtonVisibleChange
                    }
                    automationsButtonVisible={props.automationsButtonVisible}
                    onAutomationsButtonVisibleChange={
                      props.onAutomationsButtonVisibleChange
                    }
                    titlebarAppNameVisible={props.titlebarAppNameVisible}
                    onTitlebarAppNameVisibleChange={
                      props.onTitlebarAppNameVisibleChange
                    }
                  />
                ) : null}
                {visible.includes("notifications") ? (
                  <NotificationsSection
                    notifyOnAgentNeedsInput={props.notifyOnAgentNeedsInput}
                    onNotifyChange={props.onNotifyChange}
                  />
                ) : null}
                {visible.includes("shortcuts") ? <ShortcutsSection /> : null}
                {showProject && props.project ? (
                  <ProjectSettingsSectionChrome project={props.project}>
                    <ProjectSettingsSection
                      project={props.project}
                      onRemoveProject={(projectId) =>
                        props.onRemoveProject?.(projectId)
                      }
                    />
                  </ProjectSettingsSectionChrome>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
