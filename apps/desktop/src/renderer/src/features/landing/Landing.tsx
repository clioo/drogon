/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/Landing.tsx (adapter: props instead of the
   zustand store; the preflight banner needs Orca runtime and is omitted,
   not stubbed; the star button keeps local state only, see
   github-star.tsx). Shortcut keycaps render through the keybinding labels
   formatter like the source's useShortcutKeyDetails + ShortcutKeyCombo. */
import { FolderPlus, GitBranchPlus, SquarePen } from "lucide-react";
import { ShortcutKeyCombo } from "../../components/ShortcutKeyCombo";
import {
  useShortcutKeyDetails,
  type ShortcutKeyComboDetails,
} from "../../components/shortcut-labels";
import { GitHubStarButton } from "./github-star";
import logo from "./logo.svg";

type ShortcutItem = {
  id: string;
  shortcut: ShortcutKeyComboDetails;
  action: string;
};

function ShortcutRow({ action, shortcut }: ShortcutItem): React.JSX.Element {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3">
      <span className="text-sm text-muted-foreground">{action}</span>
      <ShortcutKeyCombo
        keys={shortcut.keys}
        doubleTap={shortcut.doubleTap}
        separatorClassName="mx-0.5 text-[10px] text-muted-foreground"
      />
    </div>
  );
}

export function Landing({
  hasProjects,
  hasWorkspaces = true,
  onAddProject,
  onCreateWorkspace,
  onNewSession,
}: {
  hasProjects: boolean;
  hasWorkspaces?: boolean;
  onAddProject: () => void;
  onCreateWorkspace: () => void;
  onNewSession?: () => void;
}): React.JSX.Element {
  // Source chord sources: workspace.create, worktree.navigateUp,
  // worktree.navigateDown (definitions-core-1.ts).
  const createShortcut = useShortcutKeyDetails("workspace.create");
  const upShortcut = useShortcutKeyDetails("worktree.navigateUp");
  const downShortcut = useShortcutKeyDetails("worktree.navigateDown");
  const shortcuts: ShortcutItem[] = [
    { id: "create", shortcut: createShortcut, action: "Create workspace" },
    { id: "up", shortcut: upShortcut, action: "Move up workspace" },
    { id: "down", shortcut: downShortcut, action: "Move down workspace" },
  ];
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
            {onNewSession && !hasProjects
              ? "Start a session, or add a project to work in a repository."
              : hasProjects
              ? hasWorkspaces
                ? "Select a workspace from the sidebar to begin."
                : "Create a workspace in one of your projects to get started."
              : "Add a project to get started."}
          </p>

          <div className="flex items-center justify-center gap-2.5 flex-wrap">
            {onNewSession && <button
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              onClick={onNewSession}
            ><SquarePen className="size-3.5" />New session</button>}
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
            {shortcuts.map((shortcut) => (
              <ShortcutRow key={shortcut.id} {...shortcut} />
            ))}
          </div>
        </div>
      </div>

      <div className="absolute bottom-6 left-0 right-0 flex justify-center">
        <GitHubStarButton />
      </div>
    </div>
  );
}
