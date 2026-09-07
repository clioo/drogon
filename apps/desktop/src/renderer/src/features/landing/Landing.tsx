/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/Landing.tsx (adapter: props instead of the
   zustand store; the preflight banner needs Orca runtime and is omitted,
   not stubbed; the star button keeps local state only, see
   github-star.tsx). */
import { FolderPlus, GitBranchPlus } from "lucide-react";
import { GitHubStarButton } from "./github-star";
import logo from "./logo.svg";

function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" && navigator.userAgent.includes("Mac")
  );
}

function modLabel(): string {
  return isMacPlatform() ? "\u2318" : "Ctrl";
}

function ShortcutRow({
  action,
  keys,
}: {
  action: string;
  keys: string[];
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3">
      <span className="text-sm text-muted-foreground">{action}</span>
      <span className="inline-flex items-center gap-1">
        {keys.map((key) => (
          <kbd
            key={key}
            className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
          >
            {key}
          </kbd>
        ))}
      </span>
    </div>
  );
}

export function Landing({
  hasProjects,
  onAddProject,
  onCreateWorkspace,
}: {
  hasProjects: boolean;
  onAddProject: () => void;
  onCreateWorkspace: () => void;
}): React.JSX.Element {
  const mod = modLabel();
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background">
      <div className="w-full max-w-lg px-6">
        <div className="flex flex-col items-center gap-4 py-8">
          <div
            className="flex items-center justify-center size-20 rounded-2xl border border-border/80 shadow-lg shadow-black/40"
            style={{ backgroundColor: "#12181e" }}
          >
            <img src={logo} alt="Drogon logo" className="size-12" />
          </div>
          <h1 className="text-4xl font-bold text-foreground tracking-tight">
            Drogon
          </h1>

          <p className="text-sm text-muted-foreground text-center">
            {hasProjects
              ? "Select a workspace from the sidebar to begin."
              : "Add a project to get started."}
          </p>

          <div className="flex items-center justify-center gap-2.5 flex-wrap">
            <button
              className="inline-flex items-center gap-1.5 bg-secondary/70 border border-border/80 text-foreground font-medium text-sm px-4 py-2 rounded-md cursor-pointer hover:bg-accent transition-colors"
              onClick={onAddProject}
            >
              <FolderPlus className="size-3.5" />
              Add Project
            </button>

            <button
              className="inline-flex items-center gap-1.5 bg-secondary/70 border border-border/80 text-foreground font-medium text-sm px-4 py-2 rounded-md cursor-pointer hover:bg-accent transition-colors"
              onClick={onCreateWorkspace}
            >
              <GitBranchPlus className="size-3.5" />
              Create workspace
            </button>
          </div>

          <div className="mt-6 w-full max-w-xs space-y-2">
            <ShortcutRow action="Create workspace" keys={[mod, "N"]} />
            <ShortcutRow action="Move up workspace" keys={[mod, "Shift", "↑"]} />
            <ShortcutRow action="Move down workspace" keys={[mod, "Shift", "↓"]} />
          </div>
        </div>
      </div>

      <div className="absolute bottom-6 left-0 right-0 flex justify-center">
        <GitHubStarButton />
      </div>
    </div>
  );
}
