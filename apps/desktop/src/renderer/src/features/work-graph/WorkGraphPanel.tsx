import { ExternalLink, Network } from "lucide-react";
import { Button } from "../../components/ui/button";

// Keep the persisted tab/event identity compatible with existing workspaces.
export const MENTU_OPEN_TAB_EVENT = "drogon:open-mentu-tab";

export function WorkGraphPanel({ workspaceId }: { workspaceId: string }) {
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="work-graph-panel">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <Network className="size-4" aria-hidden />
        Work Graph
      </h2>
      <p className="text-sm text-muted-foreground">
        Configure your task, approved harnesses and models, fallback, and
        optional adversarial testing.
      </p>
      <Button
        variant="outline"
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent(MENTU_OPEN_TAB_EVENT, { detail: { workspaceId } }),
          )
        }
      >
        <ExternalLink className="size-4" aria-hidden />
        Open Work Graph
      </Button>
    </div>
  );
}
