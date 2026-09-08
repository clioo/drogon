// Settings surface section vocabulary (journey J10). The surface is fully
// controlled: App owns the SettingsStore, this only names the sections.
//
// Order mirrors the Orca reference sidebar (read-only
// src/renderer/src/hooks/useSettingsNavigationMetadata.ts + group builders:
// capabilities first, then setup, workflows, interface): Agents
// (capabilities), General (setup — omitted: no MVP row is backed by a real
// setting, see the PR), Git (workflows), Appearance and Notifications
// (interface), Shortcuts last. Titles stay the honest MVP ones: "Git and
// GitHub" (the source "Git & Source Control" covers branch naming/AI author
// rows Drogon lacks) and "Keyboard shortcuts" (matches the R7-I-owned
// section header verbatim).

export const SETTINGS_SECTIONS = [
  {
    id: "agents",
    title: "Agents",
    description: "Default harness and per-harness launch defaults.",
  },
  {
    id: "git",
    title: "Git and GitHub",
    description: "Read-only identity and login status on this host.",
  },
  {
    id: "appearance",
    title: "Appearance",
    description: "Theme and terminal text size.",
  },
  {
    id: "notifications",
    title: "Notifications",
    description: "When Drogon may interrupt you.",
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    description: "Read-only reference for this window's shortcuts.",
  },
] as const;

export type SettingsSectionId =
  (typeof SETTINGS_SECTIONS)[number]["id"];

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "appearance";

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}
