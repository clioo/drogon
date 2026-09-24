// `window.drogon.work.*`; handled by main/work-bridge.ts (one channel,
// `{ op, params }`, validated on both sides).
import { ipcRenderer } from "electron";
import type { WorkBridge, WorkOp } from "../shared/work-contract";

const call = (op: WorkOp, params: object = {}): Promise<never> =>
  ipcRenderer.invoke("drogon:work", { op, params }) as Promise<never>;

export const work: WorkBridge = {
  board: (input) => call("board", input ?? {}),
  ticketShow: (input) => call("ticketShow", input),
  sends: (input) => call("sends", input),
  preview: (input) => call("preview", input),
  columnCreate: (input) => call("columnCreate", input),
  columnUpdate: (input) => call("columnUpdate", input),
  columnDelete: (input) => call("columnDelete", input),
  columnSend: (input) => call("columnSend", input),
  ticketCreate: (input) => call("ticketCreate", input),
  ticketUpdate: (input) => call("ticketUpdate", input),
  ticketMove: (input) => call("ticketMove", input),
  ticketDelete: (input) => call("ticketDelete", input),
  linkSession: (input) => call("linkSession", input),
  unlinkSession: (input) => call("unlinkSession", input),
  sessionOpen: (input) => call("sessionOpen", input),
  providerBoards: (input) => call("providerBoards", input ?? {}),
  importPreview: (input) => call("importPreview", input),
  boardImport: (input) => call("boardImport", input),
  boardSync: (input) => call("boardSync", input),
  boardPush: (input) => call("boardPush", input),
  boardDelete: (input) => call("boardDelete", input),
  ticketPush: (input) => call("ticketPush", input),
  ticketResolve: (input) => call("ticketResolve", input),
  ticketSprint: (input) => call("ticketSprint", input),
  ticketSessionStart: (input) => call("ticketSessionStart", input),
  ticketSessionRename: (input) => call("ticketSessionRename", input),
};
