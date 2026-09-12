import { ipcRenderer } from "electron";
import type {
  DaemonBridge,
  DaemonRestartInput,
} from "../shared/daemon-contract";

/** `window.drogon.daemon` namespace: Manage Sessions restart (additive)
 *  plus the install-resilience P5 launch-update state pull. */
export const daemon: DaemonBridge = {
  restart: (input?: DaemonRestartInput) =>
    ipcRenderer.invoke("drogon:daemon:restart", input),
  updateState: () => ipcRenderer.invoke("drogon:daemon:updateState"),
};
