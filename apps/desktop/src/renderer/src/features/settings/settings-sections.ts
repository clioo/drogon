// MIT Copyright (c) 2026 Lovecast Inc.
// Settings surface section vocabulary (journey J10). The surface is fully
// controlled: App owns the SettingsStore, this only names the sections.
//
// Ported order/groups/icons from the Orca reference (read-only):
//   src/renderer/src/hooks/useSettingsNavigationMetadata.ts +
//   settings-navigation-{capability,setup,workflow,interface}-sections.ts
//   (capabilities first, then setup, workflows, interface) and
//   src/renderer/src/components/settings/settings-navigation-foundations.ts
//   (SETTINGS_NAV_GROUPS titles: "AI Capabilities", "Set Up", "Workflows",
//   "Interface").
// Adapted: only the seven MVP-backed sections exist (the ~34 fork panes for
// updater, telemetry, cloud, remote servers, mobile, plugins and friends
// are out of the MVP — no rows below). Titles stay the honest MVP ones:
// "Git and GitHub" (the source "Git & Source Control" covers branch
// naming/AI author rows Drogon lacks) and "Keyboard shortcuts" (matches
// the R7-I-owned section header verbatim).
import {
  Bell,
  Bot,
  GitBranch,
  Keyboard,
  Palette,
  SlidersHorizontal,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";

export const SETTINGS_NAV_GROUPS = [
  { id: "capabilities", title: "AI Capabilities" },
  { id: "setup", title: "Set Up" },
  { id: "workflows", title: "Workflows" },
  { id: "interface", title: "Interface" },
] as const;

export type SettingsNavGroupId =
  (typeof SETTINGS_NAV_GROUPS)[number]["id"];

export type SettingsNavEntry = {
  id: string;
  title: string;
  description: string;
  group: SettingsNavGroupId;
  icon: LucideIcon;
};

export const SETTINGS_SECTIONS: readonly SettingsNavEntry[] = [
  {
    id: "agents",
    title: "Agents",
    description: "Default harness and per-harness launch defaults.",
    group: "capabilities",
    icon: Bot,
  },
  {
    id: "general",
    title: "General",
    description: "Workspace defaults, app setup, and maintenance.",
    group: "setup",
    icon: SlidersHorizontal,
  },
  {
    id: "git",
    title: "Git and GitHub",
    description: "Read-only identity and login status on this host.",
    group: "workflows",
    icon: GitBranch,
  },
  {
    id: "terminal",
    title: "Terminal",
    description: "Shells, renderer, sessions, and terminal behavior.",
    group: "workflows",
    icon: SquareTerminal,
  },
  {
    id: "appearance",
    title: "Appearance",
    description: "Theme and terminal text size.",
    group: "interface",
    icon: Palette,
  },
  {
    id: "notifications",
    title: "Notifications",
    description: "When Drogon may interrupt you.",
    group: "interface",
    icon: Bell,
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    description: "Read-only reference for this window's shortcuts.",
    group: "interface",
    icon: Keyboard,
  },
];

export type SettingsSectionId =
  (typeof SETTINGS_SECTIONS)[number]["id"];

/** The fork opens Settings on General (captured in `09-settings`). */
export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "general";

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}
