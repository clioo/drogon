import { ipcRenderer } from "electron";
import type { SettingsProbeBridge } from "../shared/settings-contract";

/**
 * `window.drogon.settings.*` namespace. Git/GitHub channels are handled by
 * main/settings-probes.ts; the CLI channel by main/settings-bridge.ts.
 *
 * Additive (R14-E): `listFonts` exposes main/fonts.ts system font
 * enumeration (display names only). It extends the coordinator-owned
 * SettingsProbeBridge structurally here so shared/settings-contract.ts
 * stays untouched; renderers consume it through an optional structural
 * type with the curated fallback list as the offline path.
 */
export const settings: SettingsProbeBridge & {
  listFonts(): Promise<string[]>;
} = {
  gitIdentity: (value) => ipcRenderer.invoke("drogon:settingsGitIdentity", value),
  ghAuthStatus: () => ipcRenderer.invoke("drogon:settingsGhAuthStatus"),
  cliStatus: () => ipcRenderer.invoke("drogon:settingsCliStatus"),
  listFonts: () => ipcRenderer.invoke("drogon:fontsList"),
};
