/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/SidebarTaskNavButton.tsx (adapter:
   props instead of the zustand store; availability probes instead of the
   fork's preflight/remote status; chip clicks park the source on the Tasks
   navigation seam and route, replacing openTaskPage({ taskSource }).
   Omissions vs the source, per #346: the hide-tasks ContextMenu wrapper
   (Drogon's tasksButtonVisible flag is written from the View > Appearance
   menu; no renderer write path exists outside coordinator-owned App) and
   the GitHub list prefetch (Drogon's page revalidates its own mount
   cache). Linear availability is the renderer-local fixture connection —
   the daemon has no Linear RPC, so the probe reads localStorage. */
import { useEffect, useState } from "react";
import { List } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import { cn } from "../../lib/utils";
import { windowSettingsBridge } from "../settings/settings-bridge";
import type { JiraBridge } from "../../../../shared/jira-contract";
import { requestTaskSourceNavigation } from "../tasks/task-source-navigation";
import { GithubIcon } from "../tasks/github-icon";
import { GitlabIcon, JiraIcon, LinearIcon } from "./task-nav-provider-icons";
import {
  filterAvailableTaskProviders,
  TASK_PROVIDERS,
  type TaskProvider,
  type TaskProviderAvailability,
} from "./sidebar-task-nav-providers";

export type TaskAvailabilityProbe = () => Promise<boolean>;

/** GitHub tasks need an installed, logged-in gh (source probe: settings). */
const defaultGitHubTasksProbe: TaskAvailabilityProbe = async () => {
  try {
    const result = await windowSettingsBridge()?.ghAuthStatus();
    return (
      result?.ok === true && result.result.available && result.result.loggedIn
    );
  } catch {
    return false;
  }
};

/** Linear tasks need the local fixture connection (no daemon RPC). */
const defaultLinearTasksProbe: TaskAvailabilityProbe = async () => {
  try {
    const { isLinearConnected } = await import(
      "../tasks/linear/linear-connection"
    );
    return isLinearConnected();
  } catch {
    return false;
  }
};

/** Jira tasks need a connected site (R17-A's jira.status RPC). */
const defaultJiraTasksProbe: TaskAvailabilityProbe = async () => {
  try {
    const bridge = (window as unknown as { drogon?: { jira?: JiraBridge } })
      .drogon?.jira;
    const result = await bridge?.jiraStatus();
    return result?.ok === true && result.result.connected;
  } catch {
    return false;
  }
};

function TaskProviderShortcut({
  label,
  onOpen,
  children,
}: {
  label: string;
  onOpen: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onOpen}
          className="rounded p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worktree-sidebar-ring"
          aria-label={label}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function SidebarTaskNavButton({
  active,
  onOpenTasks,
  probeGitHubTasksAvailable = defaultGitHubTasksProbe,
  probeLinearTasksAvailable = defaultLinearTasksProbe,
  probeJiraTasksAvailable = defaultJiraTasksProbe,
}: {
  active: boolean;
  onOpenTasks: () => void;
  /** Availability seams; tests stub these instead of the window bridges. */
  probeGitHubTasksAvailable?: TaskAvailabilityProbe;
  probeLinearTasksAvailable?: TaskAvailabilityProbe;
  probeJiraTasksAvailable?: TaskAvailabilityProbe;
}): React.JSX.Element {
  const [availability, setAvailability] = useState<TaskProviderAvailability>({
    githubConnected: false,
    gitlabInstalled: false,
    linearConnected: false,
    jiraConnected: false,
  });

  // Why: probes resolve after mount; each chip appears only when its
  // integration answers available, so a missing bridge never renders a
  // dead chip.
  useEffect(() => {
    let cancelled = false;
    const mark =
      (patch: Partial<TaskProviderAvailability>) => (available: boolean) => {
        if (!cancelled && available) {
          setAvailability((current) => ({ ...current, ...patch }));
        }
      };
    void probeGitHubTasksAvailable().then(mark({ githubConnected: true }));
    void probeLinearTasksAvailable().then(mark({ linearConnected: true }));
    void probeJiraTasksAvailable().then(mark({ jiraConnected: true }));
    return () => {
      cancelled = true;
    };
  }, [probeGitHubTasksAvailable, probeLinearTasksAvailable, probeJiraTasksAvailable]);

  const visibleTaskProviders = filterAvailableTaskProviders(
    TASK_PROVIDERS,
    availability,
  );

  // Why: one navigation gesture — park the source, then route — matching
  // the fork's single openTaskPage({ taskSource }) call.
  const openTasksWithSource = (source: TaskProvider) => () => {
    requestTaskSourceNavigation(source);
    onOpenTasks();
  };

  return (
    // Why: shortcuts sit beside the Tasks button, not inside it, so each
    // stays keyboard-reachable (source comment, kept verbatim).
    <div className="group relative">
      <button
        type="button"
        onClick={() => onOpenTasks()}
        aria-current={active ? "page" : undefined}
        data-contextual-tour-target="sidebar-tasks"
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors",
          active
            ? "bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground"
            : "text-worktree-sidebar-foreground/60 group-hover:bg-worktree-sidebar-foreground/8",
        )}
      >
        <List
          className={cn(
            "size-4 shrink-0",
            !active && "text-worktree-sidebar-foreground/30",
          )}
          strokeWidth={active ? 2.25 : 1.75}
        />
        <span className="flex-1">Tasks</span>
      </button>
      <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 can-hover:pointer-events-none can-hover:opacity-0 can-hover:group-hover:pointer-events-auto can-hover:group-hover:opacity-100 can-hover:group-focus-within:pointer-events-auto can-hover:group-focus-within:opacity-100">
        {visibleTaskProviders.includes("github") ? (
          <TaskProviderShortcut
            label="Open GitHub tasks"
            onOpen={openTasksWithSource("github")}
          >
            <GithubIcon className="size-3.5" />
          </TaskProviderShortcut>
        ) : null}
        {visibleTaskProviders.includes("gitlab") ? (
          <TaskProviderShortcut
            label="Open GitLab tasks"
            onOpen={openTasksWithSource("gitlab")}
          >
            <GitlabIcon className="size-3.5" />
          </TaskProviderShortcut>
        ) : null}
        {visibleTaskProviders.includes("linear") ? (
          <TaskProviderShortcut
            label="Open Linear tasks"
            onOpen={openTasksWithSource("linear")}
          >
            <LinearIcon className="size-3.5" />
          </TaskProviderShortcut>
        ) : null}
        {visibleTaskProviders.includes("jira") ? (
          <TaskProviderShortcut
            label="Open Jira tasks"
            onOpen={openTasksWithSource("jira")}
          >
            <JiraIcon className="size-3.5" />
          </TaskProviderShortcut>
        ) : null}
      </span>
    </div>
  );
}
