// MIT Copyright (c) 2026 Lovecast Inc.
// Ported literally from the read-only reference
// `src/renderer/src/components/mentu/RecipePane.tsx`: the wide Mentu tab
// composition. Only the props are adapted: this repo's tab descriptor
// carries the `MentuBridge` and workspace id instead of a worktree id.

import type { MentuBridge } from "../../../../shared/mentu-contract";
import type { FileBridge } from "../../../../shared/file-contract";
import type { MentuDispatchContext } from "./recipe-pane-controller";
import { RecipePaneContent } from "./RecipePaneContent";
import { RecipePaneHeader } from "./RecipePaneHeader";
import { useMentuPaneController } from "./use-recipe-pane-controller";

export function RecipePane({
  bridge,
  workspaceId,
  fileBridge = null,
  hostId = null,
  workspacePath = null,
  dispatchContext,
}: {
  bridge: MentuBridge;
  workspaceId: string;
  fileBridge?: FileBridge | null;
  hostId?: string | null;
  workspacePath?: string | null;
  dispatchContext?: MentuDispatchContext;
}): React.JSX.Element {
  const controller = useMentuPaneController(bridge, workspaceId, {
    fileBridge,
    hostId,
    workspacePath,
    dispatchContext,
  });
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background" data-testid="recipe-pane">
      <RecipePaneHeader controller={controller} />
      <RecipePaneContent controller={controller} />
    </div>
  );
}
