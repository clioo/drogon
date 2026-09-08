import { FolderPlus, GitBranchPlus } from "lucide-react";
import { Button } from "../../components/ui/button";

/**
 * A routed shell page for features that need a workspace before they can
 * load their data. Keeping the route visible makes the left navigation
 * responsive even when the account has no projects yet.
 */
export function NoWorkspacePage({
  title,
  description,
  onAddProject,
  onCreateWorkspace,
}: {
  title: string;
  description: string;
  onAddProject: () => void;
  onCreateWorkspace: () => void;
}): React.JSX.Element {
  return (
    <main
      data-testid="no-workspace-page"
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      <header className="flex shrink-0 items-center border-b border-border px-5 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{title}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {description}
          </p>
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <p className="text-sm text-muted-foreground">
            Add a project or create a workspace to get started.
          </p>
          <div className="flex flex-wrap justify-center gap-2.5">
            <Button variant="secondary" onClick={onAddProject}>
              <FolderPlus />
              Add Project
            </Button>
            <Button variant="secondary" onClick={onCreateWorkspace}>
              <GitBranchPlus />
              Create workspace
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
