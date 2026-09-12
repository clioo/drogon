// `graph.*` desktop bridge: the renderer's ONLY path to the work graph's
// write/compile/run RPCs. Registered here rather than in shared/
// result-validation.ts's map (coordinator-owned) with the identical
// precedent of `main/mentu-bridge.ts` / `main/tasks-bridge.ts`, and with
// the same sender/frame gate main/index.ts applies to its own bridge.
//
// Ownership is enforced at every layer: the payload schemas refuse any
// `state` key before the IPC hop (shared/graph-contract.ts), and the
// daemon's `graph.write_intent` refuses it again on the raw params. The
// bridge itself is a dumb, validated pipe — it never touches the graph
// file and never invents a result shape.

import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import {
  graphCompileParamsSchema,
  graphCompileResultSchema,
  graphNodeParamsSchema,
  graphReadParamsSchema,
  graphResultSchema,
  graphRunNodeFailoverResultSchema,
  graphRunResultSchema,
  graphWriteIntentParamsSchema,
  graphWritePolicyParamsSchema,
  graphEvidenceAppendParamsSchema,
  graphUsageAppendParamsSchema,
  graphObservabilityResultSchema,
  orchestratorResultSchema,
  orchestratorStartParamsSchema,
  orchestratorControlParamsSchema,
} from "../shared/graph-contract";
import { resultSchemas } from "../shared/result-validation";
import type { Result } from "../shared/session-contract";
import { callNative } from "./native-client";

type NativeCall = (
  method: string,
  params: object,
  requestId?: string,
) => Promise<Result<unknown>>;

const invalid = {
  ok: false,
  error: {
    code: "invalid_argument",
    message: "Invalid graph request.",
    retryable: false,
  },
} as const;

type GraphMethod =
  | "graphObservabilityStatus"
  | "graphEvidenceAppend"
  | "graphUsageAppend"
  | "graphOrchestratorStart"
  | "graphOrchestratorStatus"
  | "graphOrchestratorStop"
  | "graphOrchestratorResume"
  | "graphRead"
  | "graphWriteIntent"
  | "graphWritePolicy"
  | "graphCompile"
  | "graphRun"
  | "graphRunNodeFailover";

const nativeMethodFor: Record<GraphMethod, string> = {
  graphObservabilityStatus: "graph.observability_status",
  graphEvidenceAppend: "graph.evidence_append",
  graphUsageAppend: "graph.usage_append",
  graphOrchestratorStart: "graph.orchestrator_start",
  graphOrchestratorStatus: "graph.orchestrator_status",
  graphOrchestratorStop: "graph.orchestrator_stop",
  graphOrchestratorResume: "graph.orchestrator_resume",
  graphRead: "graph.read",
  graphWriteIntent: "graph.write_intent",
  graphWritePolicy: "graph.write_policy",
  graphCompile: "graph.compile",
  graphRun: "graph.run",
  graphRunNodeFailover: "graph.run_node_failover",
};

const channelFor: Record<GraphMethod, string> = {
  graphObservabilityStatus: "drogon:graphObservabilityStatus",
  graphEvidenceAppend: "drogon:graphEvidenceAppend",
  graphUsageAppend: "drogon:graphUsageAppend",
  graphOrchestratorStart: "drogon:graphOrchestratorStart",
  graphOrchestratorStatus: "drogon:graphOrchestratorStatus",
  graphOrchestratorStop: "drogon:graphOrchestratorStop",
  graphOrchestratorResume: "drogon:graphOrchestratorResume",
  graphRead: "drogon:graphRead",
  graphWriteIntent: "drogon:graphWriteIntent",
  graphWritePolicy: "drogon:graphWritePolicy",
  graphCompile: "drogon:graphCompile",
  graphRun: "drogon:graphRun",
  graphRunNodeFailover: "drogon:graphRunNodeFailover",
};

const paramSchemas = {
  graphObservabilityStatus: graphReadParamsSchema,
  graphEvidenceAppend: graphEvidenceAppendParamsSchema,
  graphUsageAppend: graphUsageAppendParamsSchema,
  graphOrchestratorStart: orchestratorStartParamsSchema,
  graphOrchestratorStatus: graphReadParamsSchema,
  graphOrchestratorStop: orchestratorControlParamsSchema,
  graphOrchestratorResume: orchestratorControlParamsSchema,
  graphRead: graphReadParamsSchema,
  graphWriteIntent: graphWriteIntentParamsSchema,
  graphWritePolicy: graphWritePolicyParamsSchema,
  graphCompile: graphCompileParamsSchema,
  graphRun: graphCompileParamsSchema,
  graphRunNodeFailover: graphNodeParamsSchema,
} as const;

const resultSchemasFor = {
  graphObservabilityStatus: graphObservabilityResultSchema,
  graphEvidenceAppend: graphObservabilityResultSchema,
  graphUsageAppend: graphObservabilityResultSchema,
  graphOrchestratorStart: orchestratorResultSchema,
  graphOrchestratorStatus: orchestratorResultSchema,
  graphOrchestratorStop: orchestratorResultSchema,
  graphOrchestratorResume: orchestratorResultSchema,
  graphRead: graphResultSchema,
  graphWriteIntent: graphResultSchema,
  graphWritePolicy: graphResultSchema,
  graphCompile: graphCompileResultSchema,
  graphRun: graphRunResultSchema,
  graphRunNodeFailover: graphRunNodeFailoverResultSchema,
} as const;

// Registered here rather than editing shared/result-validation.ts directly:
// identical precedent to main/mentu-bridge.ts / main/tasks-bridge.ts.
// native-client.ts validates EVERY daemon response through the shared map,
// so an unregistered method would fail every call with a false "does not
// match the expected contract".
for (const [method, schema] of Object.entries(resultSchemasFor)) {
  resultSchemas[nativeMethodFor[method as keyof typeof resultSchemasFor]] =
    schema;
}

export async function dispatchGraphRequest(
  method: GraphMethod,
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<unknown>> {
  const parsed = paramSchemas[method].safeParse(input);
  if (!parsed.success) return { ...invalid };
  const result = await call(nativeMethodFor[method], parsed.data);
  if (!result.ok) return result;
  const checked = resultSchemasFor[method].safeParse(result.result);
  if (!checked.success)
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: "The graph response does not match its contract.",
        retryable: false,
      },
    };
  return { ok: true, result: checked.data };
}

/**
 * Registers one `ipcMain.handle` per graph channel with the same
 * sender/frame gate main/index.ts applies to its own bridge (see
 * `main/mentu-bridge.ts` for the identical precedent).
 */
export function registerGraphBridge(
  getWindow: () => BrowserWindow | null,
): void {
  for (const method of Object.keys(channelFor) as GraphMethod[]) {
    ipcMain.handle(channelFor[method], async (event, input: unknown) => {
      const window = getWindow();
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        return { ...invalid };
      return dispatchGraphRequest(method, input);
    });
  }
}
