import { ipcRenderer } from "electron";
import type {
  DaemonBridge,
  DaemonRestartInput,
} from "../shared/daemon-contract";

/** `window.drogon.daemon` namespace: Manage Sessions restart (additive). */
export const daemon: DaemonBridge = {
  restart: (input?: DaemonRestartInput) =>
    ipcRenderer.invoke("drogon:daemon:restart", input),
};
