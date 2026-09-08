// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/settings/SettingsSidebar.tsx
//     (Back to app row, search field with the shortcut hint, section nav
//      with aria-current on the active row)
// Adapted: no zustand store, no setup-guide row —
// a controlled six-section grouped nav over this repo's settings-sections;
// the ⌘F hint is a plain kbd pair (no ShortcutKeyCombo dependency).
import { ArrowLeft, Search } from "lucide-react";
import type { RefObject } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  SETTINGS_NAV_GROUPS,
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "./settings-sections";

export function SettingsSidebar({
  activeSectionId,
  visibleSectionIds = SETTINGS_SECTIONS.map((section) => section.id),
  searchQuery,
  onSearchChange,
  searchInputRef,
  searchAutoFocus = false,
  onBack,
  onSelectSection,
  projectNav = null,
  onSelectProject,
}: {
  /** "project" selects the dynamic per-project row (R14-A). */
  activeSectionId: SettingsSectionId | "project";
  /** While searching, the nav lists every match (reference behavior). */
  visibleSectionIds?: readonly SettingsSectionId[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  searchAutoFocus?: boolean;
  onBack: () => void;
  onSelectSection: (sectionId: SettingsSectionId) => void;
  /** Per-project row (R14-A): shown only while a project section is open. */
  projectNav?: { title: string; active: boolean } | null;
  onSelectProject?: () => void;
}): React.JSX.Element {
  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="border-b border-border px-3 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="w-full justify-start gap-2 text-[13px] text-muted-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to app
        </Button>
      </div>

      <div className="border-b border-border px-3 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            autoFocus={searchAutoFocus}
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search settings"
            className="bg-background/60 pl-9 pr-14 text-[13px]"
          />
          {searchQuery === "" ? (
            <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 text-[10px] text-muted-foreground">
              <kbd className="rounded border border-border bg-muted/50 px-1 font-sans">
                ⌘
              </kbd>
              <kbd className="rounded border border-border bg-muted/50 px-1 font-sans">
                F
              </kbd>
            </span>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-5">
          {SETTINGS_NAV_GROUPS.map((group) => {
            const rows = SETTINGS_SECTIONS.filter(
              (section) =>
                section.group === group.id &&
                visibleSectionIds.includes(section.id),
            );
            if (rows.length === 0) return null;
            return (
              <div key={group.id} className="space-y-2">
                <p className="px-3 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {group.title}
                </p>
                <div className="space-y-1">
                  {rows.map((section) => {
                    const isActive = activeSectionId === section.id;
                    const Icon = section.icon;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        aria-current={isActive ? "page" : undefined}
                        data-current={isActive ? "true" : undefined}
                        onClick={() => onSelectSection(section.id)}
                        className={
                          isActive
                            ? "flex w-full items-center gap-2 rounded-lg bg-sidebar-accent px-3 py-1.5 text-left text-[13px] font-medium text-foreground outline-none ring-1 ring-ring/25 transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                            : "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        }
                      >
                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{section.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {projectNav ? (
            <div key="project-group" className="space-y-2">
              <p className="px-3 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Projects
              </p>
              <div className="space-y-1">
                <button
                  key="project"
                  type="button"
                  aria-current={projectNav.active ? "page" : undefined}
                  data-current={projectNav.active ? "true" : undefined}
                  onClick={() => onSelectProject?.()}
                  className={
                    projectNav.active
                      ? "flex w-full items-center gap-2 rounded-lg bg-sidebar-accent px-3 py-1.5 text-left text-[13px] font-medium text-foreground outline-none ring-1 ring-ring/25 transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      : "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  }
                >
                  <span className="truncate">{projectNav.title}</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
