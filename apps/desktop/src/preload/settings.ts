import { ipcRenderer } from "electron";
import type { SettingsProbeBridge } from "../shared/settings-contract";

/** `window.drogon.settings.*` namespace; channels are handled by main/settings-probes.ts. */
export const settings: SettingsProbeBridge = {
  gitIdentity: (value) => ipcRenderer.invoke("drogon:settingsGitIdentity", value),
  ghAuthStatus: () => ipcRenderer.invoke("drogon:settingsGhAuthStatus"),
};
