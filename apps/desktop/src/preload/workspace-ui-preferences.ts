import { ipcRenderer } from "electron";
import type { WorkspaceUIPreferencesBridge } from "../shared/workspace-ui-preferences-contract";

/** `window.drogon.ui.*` namespace; channels are handled by
 *  main/workspace-ui-preferences-bridge.ts. */
export const ui: WorkspaceUIPreferencesBridge = {
  get: () => ipcRenderer.invoke("drogon:uiGet"),
  set: (partial) => ipcRenderer.invoke("drogon:uiSet", partial),
};
