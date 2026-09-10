import { ipcRenderer } from "electron";
import {
  MENTU_OPEN_TAB_CHANNEL,
  MENTU_OPEN_TAB_RESULT_CHANNEL,
  mentuOpenTabRequestSchema,
  mentuOpenTabResultSchema,
  type MentuBridge,
  type MentuOpenTabRequest,
  type MentuOpenTabResult,
} from "../shared/mentu-contract";

/** `window.drogon.mentu.*` namespace; channels are handled by main/mentu-bridge.ts. */
export const mentu: MentuBridge = {
  mentuRecipes: (value) => ipcRenderer.invoke("drogon:mentuRecipes", value),
  mentuRecipe: (value) => ipcRenderer.invoke("drogon:mentuRecipe", value),
  mentuRecipeSave: (value) => ipcRenderer.invoke("drogon:mentuRecipeSave", value),
  mentuRuntime: () => ipcRenderer.invoke("drogon:mentuRuntime", {}),
  mentuApprove: (value) => ipcRenderer.invoke("drogon:mentuApprove", value),
  mentuRun: (value) => ipcRenderer.invoke("drogon:mentuRun", value),
  mentuRuns: (value) => ipcRenderer.invoke("drogon:mentuRuns", value),
  mentuRunStatus: (value) =>
    ipcRenderer.invoke("drogon:mentuRunStatus", value),
  mentuRunEvidence: (value) =>
    ipcRenderer.invoke("drogon:mentuRunEvidence", value),
  mentuRetry: (value) => ipcRenderer.invoke("drogon:mentuRetry", value),
  mentuCancel: (value) => ipcRenderer.invoke("drogon:mentuCancel", value),
  // Additive (Mentu-as-tab): `drogon-cli mentu open` reaches the shell as a
  // main -> renderer request. Payloads are shape-checked in both directions,
  // so a malformed frame never reaches App and a bogus verdict never
  // resolves the CLI's wait.
  onOpenTab: (listener: (request: MentuOpenTabRequest) => void) => {
    const wrapped = (_event: unknown, payload: unknown) => {
      const parsed = mentuOpenTabRequestSchema.safeParse(payload);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(MENTU_OPEN_TAB_CHANNEL, wrapped);
    return () => ipcRenderer.removeListener(MENTU_OPEN_TAB_CHANNEL, wrapped);
  },
  reportOpenTab: (result: MentuOpenTabResult) =>
    ipcRenderer.invoke(
      MENTU_OPEN_TAB_RESULT_CHANNEL,
      mentuOpenTabResultSchema.parse(result),
    ),
};
