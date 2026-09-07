// Settings surface section vocabulary (journey J10). The surface is fully
// controlled: App owns the SettingsStore, this only names the sections.

export const SETTINGS_SECTIONS = [
  {
    id: "appearance",
    title: "Appearance",
    description: "Theme and terminal text size.",
  },
  {
    id: "agents",
    title: "Agents",
    description: "Default harness and per-harness launch defaults.",
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    description: "Read-only reference for this window's shortcuts.",
  },
  {
    id: "git",
    title: "Git and GitHub",
    description: "Read-only identity and login status on this host.",
  },
  {
    id: "notifications",
    title: "Notifications",
    description: "When Drogon may interrupt you.",
  },
] as const;

export type SettingsSectionId =
  (typeof SETTINGS_SECTIONS)[number]["id"];

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "appearance";

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}
