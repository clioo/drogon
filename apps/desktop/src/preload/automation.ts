import { ipcRenderer } from "electron";
import type {
  AutomationBridge,
  AutomationCreateInput,
  AutomationUpdateInput,
} from "../shared/automation-contract";

// Same channel as main/automation-bridge.ts's AUTOMATION_IPC_CHANNEL;
// inlined (never imported from main/) per the usage-bridge precedent.
const AUTOMATION_IPC_CHANNEL = "drogon:automation";

function invoke(op: string, params: object): Promise<never> {
  return ipcRenderer.invoke(AUTOMATION_IPC_CHANNEL, { op, params }) as Promise<never>;
}

export const automationBridge: AutomationBridge = {
  list: () => invoke("list", {}),
  create: (input: AutomationCreateInput) => invoke("create", input as object),
  update: (input: AutomationUpdateInput) => invoke("update", input as object),
  remove: (input: { id: string }) => invoke("delete", input),
  runNow: (input: { id: string }) => invoke("runNow", input),
  history: (input: { automationId: string; limit?: number }) =>
    invoke("history", input as object),
};
