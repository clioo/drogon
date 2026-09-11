// MIT Copyright (c) 2026 Lovecast Inc.
// `window.drogon.meetings.*`; the channel is handled by
// main/meetings-bridge.ts (one channel, one validated request shape, like
// the Automation bridge). Read-only: there is no mutating op to expose.
import { ipcRenderer } from "electron";
import type { MeetingsBridge } from "../shared/meetings-contract";

const MEETINGS_IPC_CHANNEL = "drogon:meetings";

type MeetingsRequest =
  | { op: "list"; params: object }
  | { op: "read"; params: object };

export const meetings: MeetingsBridge = {
  list: (input) =>
    ipcRenderer.invoke(MEETINGS_IPC_CHANNEL, {
      op: "list",
      params: input ?? {},
    } satisfies MeetingsRequest) as ReturnType<MeetingsBridge["list"]>,
  read: (input) =>
    ipcRenderer.invoke(MEETINGS_IPC_CHANNEL, {
      op: "read",
      params: input,
    } satisfies MeetingsRequest) as ReturnType<MeetingsBridge["read"]>,
};
