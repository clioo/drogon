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
  graphReadParamsSchema,
  graphResultSchema,
  graphRunResultSchema,
  graphWriteIntentParamsSchema,
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

type GraphMethod = "graphRead" | "graphWriteIntent" | "graphCompile" | "graphRun";

const nativeMethodFor: Record<GraphMethod, string> = {
  graphRead: "graph.read",
  graphWriteIntent: "graph.write_intent",
  graphCompile: "graph.compile",
  graphRun: "graph.run",
};

const channelFor: Record<GraphMethod, string> = {
  graphRead: "drogon:graphRead",
  graphWriteIntent: "drogon:graphWriteIntent",
  graphCompile: "drogon:graphCompile",
  graphRun: "drogon:graphRun",
};

const paramSchemas = {
  graphRead: graphReadParamsSchema,
  graphWriteIntent: graphWriteIntentParamsSchema,
  graphCompile: graphCompileParamsSchema,
  graphRun: graphCompileParamsSchema,
} as const;

const resultSchemasFor = {
  graphRead: graphResultSchema,
  graphWriteIntent: graphResultSchema,
  graphCompile: graphCompileResultSchema,
  graphRun: graphRunResultSchema,
} as const;

// Registered here rather than editing shared/result-validation.ts directly:
// identical precedent to main/mentu-bridge.ts / main/tasks-bridge.ts.
// native-client.ts validates EVERY daemon response through the shared map,
// so an unregistered method would fail every call with a false "does not
// match the expected contract".
for (const [method, schema] of Object.entries(resultSchemasFor)) {
  resultSchemas[
    {
      graphRead: "graph.read",
      graphWriteIntent: "graph.write_intent",
      graphCompile: "graph.compile",
      graphRun: "graph.run",
    }[method as keyof typeof resultSchemasFor]
  ] = schema;
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
export function registerGraphBridge(getWindow: () => BrowserWindow | null): void {
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
