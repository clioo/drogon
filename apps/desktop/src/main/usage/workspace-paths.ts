// Workspace paths for port attribution, read from the daemon's
// workspace.list. Lives apart from store.ts so the store keeps no
// transport imports; callNative is plain Node (no Electron).
import { z } from "zod";
import { callNative } from "../native-client";
import type { WorkspacePortProbe } from "./workspace-ports";

const workspaceListResultSchema = z.object({
  workspaces: z.array(
    z.object({ id: z.string(), path: z.string() }).passthrough(),
  ),
});

/** Best-effort: a daemon that will not answer yields no probes, never a throw. */
export async function readWorkspaceProbes(): Promise<WorkspacePortProbe[]> {
  try {
    const result = await callNative("workspace.list", {});
    if (!result.ok) return [];
    const parsed = workspaceListResultSchema.safeParse(result.result);
    if (!parsed.success) return [];
    return parsed.data.workspaces.map((workspace) => ({
      id: workspace.id,
      path: workspace.path,
    }));
  } catch {
    return [];
  }
}
