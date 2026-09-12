// MIT Copyright (c) 2026 Lovecast Inc.
// Install-resilience P6 (additive): the `backups` namespace. One channel,
// `drogon:backups`; the main side (main/backups-bridge.ts) validates every
// shape and spawns the bundled CLI — the renderer never sees a path.
import { ipcRenderer } from "electron";
import type { BackupsBridge } from "../shared/backups-contract";

export const backups: BackupsBridge = {
  list: () => ipcRenderer.invoke("drogon:backups", { op: "list" }),
  restore: (backupId: string) =>
    ipcRenderer.invoke("drogon:backups", { op: "restore", backupId }),
  relaunchApp: () => ipcRenderer.invoke("drogon:backups", { op: "relaunchApp" }),
};
