// MIT Copyright (c) 2026 Lovecast Inc.
// `window.drogon.meetings.*`; the channel is handled by
// main/meetings-bridge.ts (one channel, one validated request shape, like
// the Automation bridge). Reading the notes is read-only by construction;
// `analyze` runs the free local model once and creates nothing, and the two
// `commitment` ops write only Drogon's own ledger file.
import { ipcRenderer } from "electron";
import type { MeetingsBridge } from "../shared/meetings-contract";

const MEETINGS_IPC_CHANNEL = "drogon:meetings";

type MeetingsRequest =
  | { op: "list"; params: object }
  | { op: "read"; params: object }
  | { op: "analyze"; params: object }
  | { op: "commitments"; params: object }
  | { op: "accept"; params: object }
  | { op: "resolve"; params: object };

const call = (op: MeetingsRequest["op"], params: object): Promise<unknown> =>
  ipcRenderer.invoke(MEETINGS_IPC_CHANNEL, { op, params });

export const meetings: MeetingsBridge = {
  list: (input) =>
    call("list", input ?? {}) as ReturnType<MeetingsBridge["list"]>,
  read: (input) => call("read", input) as ReturnType<MeetingsBridge["read"]>,
  analyze: (input) =>
    call("analyze", input) as ReturnType<MeetingsBridge["analyze"]>,
  commitments: (input) =>
    call("commitments", input ?? {}) as ReturnType<MeetingsBridge["commitments"]>,
  accept: (input) => call("accept", input) as ReturnType<MeetingsBridge["accept"]>,
  resolve: (input) => call("resolve", input) as ReturnType<MeetingsBridge["resolve"]>,
};
