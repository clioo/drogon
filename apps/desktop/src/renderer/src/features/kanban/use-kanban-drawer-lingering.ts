/* MIT Copyright (c) 2026 Lovecast Inc. Ported verbatim from Orca
   src/renderer/src/components/sidebar/use-workspace-kanban-drawer-lingering.ts
   at pinned source c9790628 (clioo/drogon-orca). Only this header was added. */
import { useEffect, useState } from "react";

const WORKSPACE_BOARD_CLOSE_LINGER_MS = 300;

export function useWorkspaceKanbanDrawerLingering(open: boolean): boolean {
  const [lingering, setLingering] = useState(open);
  useEffect(() => {
    if (open) {
      setLingering(true);
      return;
    }
    const timer = window.setTimeout(
      () => setLingering(false),
      WORKSPACE_BOARD_CLOSE_LINGER_MS,
    );
    return () => window.clearTimeout(timer);
  }, [open]);
  return lingering;
}
