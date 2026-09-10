// MIT Copyright (c) 2026 Lovecast Inc.
// `window.drogon.skills.*` namespace: Settings "Agent skills" data.
// Ported from the Orca reference: src/preload/api/skills-bridge.ts
// (narrowed to the catalog/installed-state read the adapted settings panel
// needs). Types are declared locally — the same structural pattern
// preload/settings.ts uses for `listFonts` — so shared contracts stay
// untouched.
import { ipcRenderer } from "electron";

export type SkillsBridgeTopic = {
  name: string;
  description: string;
  installed: boolean;
  rootsFound: string[];
  installCommand: string;
  updateCommand: string;
};

export type SkillsOverviewResult = {
  ok: boolean;
  error?: { code: string; message: string; retryable: boolean };
  result?: {
    available: boolean;
    reason: string | null;
    topics: SkillsBridgeTopic[];
  };
};

export const skills = {
  overview: () => ipcRenderer.invoke("drogon:skillsOverview"),
};
