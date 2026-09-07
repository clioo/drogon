// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/preload/api/shell-bridge.ts (`openUrl`). Adapter: the
// `drogon:openExternal` channel; handled by main/shell-bridge.ts.
import { ipcRenderer } from "electron";
import { SHELL_OPEN_EXTERNAL_CHANNEL } from "../shared/shell-contract";
import type { ShellBridge } from "../shared/shell-contract";

/** `window.drogon.shell.*` namespace; channels are handled by main/shell-bridge.ts. */
export const shell: ShellBridge = {
  openExternal: (url) => ipcRenderer.invoke(SHELL_OPEN_EXTERNAL_CHANNEL, url),
};
