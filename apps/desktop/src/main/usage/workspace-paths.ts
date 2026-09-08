// Workspace paths for port attribution, read from the daemon's
// workspace.list. Lives apart from store.ts so the store keeps no
// transport imports; callNative is plain Node (no Electron).
import { z } from "zod";
import { callNative } from "../native-client";
import type {
  NamedWorkspacePortProbe,
  WorkspacePortProbe,
} from "./workspace-ports";

/** Owner evidence attached to workspace-attributed port rows (R13-B). */
export type WorkspacePortOwnerInfo = {
  workspaceId: string;
  displayName: string;
  confidence: "cwd" | "command";
};

const workspaceListResultSchema = z.object({
  workspaces: z.array(
    z.object({
      id: z.string(),
      path: z.string(),
      // R13-B: the Ports panel shows the owner's display name.
      name: z.string().min(1).max(256).optional(),
    }),
  ),
});

/** Best-effort: a daemon that will not answer yields no probes, never a throw. */
export async function readWorkspaceProbes(): Promise<NamedWorkspacePortProbe[]> {
  try {
    const result = await callNative("workspace.list", {});
    if (!result.ok) return [];
    const parsed = workspaceListResultSchema.safeParse(result.result);
    if (!parsed.success) return [];
    return parsed.data.workspaces.map((workspace) => ({
      id: workspace.id,
      path: workspace.path,
      // Display name: the daemon's workspace.name when present, else the
      // path basename like the workspace cards.
      name:
        workspace.name ??
        (workspace.path.split("/").filter(Boolean).pop() || workspace.path),
    }));
  } catch {
    return [];
  }
}
