import { ipcRenderer } from "electron";
import type { SettingsProbeBridge } from "../shared/settings-contract";

/**
 * `window.drogon.settings.*` namespace. Git/GitHub channels are handled by
 * main/settings-probes.ts; the CLI channel by main/settings-bridge.ts.
 */
export const settings: SettingsProbeBridge = {
  gitIdentity: (value) => ipcRenderer.invoke("drogon:settingsGitIdentity", value),
  ghAuthStatus: () => ipcRenderer.invoke("drogon:settingsGhAuthStatus"),
  cliStatus: () => ipcRenderer.invoke("drogon:settingsCliStatus"),
};
