import { ipcRenderer } from "electron";
import type { GraphBridge } from "../shared/graph-contract";

/** `window.drogon.graph.*` namespace: the work-graph authoring seam
 *  (additive wiring, mirroring the jira/mentu namespace precedents).
 *  Channels are handled by main/graph-bridge.ts; every method proxies the
 *  daemon's ownership-enforcing `graph.*` RPCs — the store refuses any
 *  payload that carries the daemon-owned `state` half, so the renderer can
 *  never write what it may only observe. */
export const graph: GraphBridge = {
  graphRead: (value) => ipcRenderer.invoke("drogon:graphRead", value),
  graphWriteIntent: (value) => ipcRenderer.invoke("drogon:graphWriteIntent", value),
  graphCompile: (value) => ipcRenderer.invoke("drogon:graphCompile", value),
  graphRun: (value) => ipcRenderer.invoke("drogon:graphRun", value),
};
