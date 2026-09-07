/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/SidebarNav.tsx (adapter: Orca's
   zustand view store becomes props; only Search/Tasks/Automations rows
   plus the live panel routes are kept). */
import { useState } from "react";
import {
  Bot,
  CalendarClock,
  Folder,
  GitCompareArrows,
  ListTodo,
  Search,
  TerminalSquare,
} from "lucide-react";
import { BOTS_ROUTE_ID } from "../../bots-mount";
import { CHANGES_ROUTE_ID } from "../../changes-mount";
import { FILES_ROUTE_ID } from "../../files-mount";

export type ShellPlaceholder = "tasks" | "automations" | null;

/**
 * Top nav rows: Search opens the existing command palette; Terminals /
 * Files / Bots switch the live panel routes; Tasks and Automations are
 * honest placeholders (journeys J6/J7 owners) that surface a "coming
 * soon" empty state instead of fake pages.
 */
export function SidebarNav({
  route,
  panelsDisabled,
  filesAvailable,
  changesAvailable,
  botsAvailable,
  onSelectRoute,
  onOpenPalette,
}: {
  route: string | null;
  panelsDisabled: boolean;
  filesAvailable: boolean;
  changesAvailable: boolean;
  botsAvailable: boolean;
  onSelectRoute: (route: string | null) => void;
  onOpenPalette: () => void;
}) {
  const [placeholder, setPlaceholder] = useState<ShellPlaceholder>(null);
  const row = (current: boolean) => ({
    className: "workspace-row",
    "data-current": current,
  });
  return (
    <div className="shell-nav">
      <button
        type="button"
        {...row(false)}
        aria-label="Search workspaces and sessions"
        onClick={() => {
          setPlaceholder(null);
          onOpenPalette();
        }}
      >
        <Search size={16} />
        <span>Search</span>
      </button>
      <button
        type="button"
        {...row(route === null)}
        aria-current={route === null ? "page" : undefined}
        disabled={panelsDisabled}
        onClick={() => {
          setPlaceholder(null);
          onSelectRoute(null);
        }}
      >
        <TerminalSquare size={16} />
        <span>Terminals</span>
      </button>
      <button
        type="button"
        {...row(route === FILES_ROUTE_ID)}
        aria-current={route === FILES_ROUTE_ID ? "page" : undefined}
        disabled={panelsDisabled || !filesAvailable}
        title={
          filesAvailable
            ? "Files"
            : "Files unavailable: service does not advertise files.v1"
        }
        onClick={() => {
          setPlaceholder(null);
          onSelectRoute(FILES_ROUTE_ID);
        }}
      >
        <Folder size={16} />
        <span>Files</span>
      </button>
      <button
        type="button"
        {...row(route === CHANGES_ROUTE_ID)}
        aria-current={route === CHANGES_ROUTE_ID ? "page" : undefined}
        disabled={panelsDisabled || !changesAvailable}
        title={
          changesAvailable
            ? "Changes"
            : "Changes unavailable: service does not advertise git.v1"
        }
        onClick={() => {
          setPlaceholder(null);
          onSelectRoute(CHANGES_ROUTE_ID);
        }}
      >
        <GitCompareArrows size={16} />
        <span>Changes</span>
      </button>
      <button
        type="button"
        {...row(route === BOTS_ROUTE_ID)}
        aria-current={route === BOTS_ROUTE_ID ? "page" : undefined}
        disabled={panelsDisabled || !botsAvailable}
        title={
          botsAvailable
            ? "Bots"
            : "Bots unavailable: service does not advertise bot.snapshot.v1"
        }
        onClick={() => {
          setPlaceholder(null);
          onSelectRoute(BOTS_ROUTE_ID);
        }}
      >
        <Bot size={16} />
        <span>Bots</span>
      </button>
      <button
        type="button"
        {...row(placeholder === "tasks")}
        aria-current={placeholder === "tasks" ? "page" : undefined}
        onClick={() =>
          setPlaceholder((value) => (value === "tasks" ? null : "tasks"))
        }
      >
        <ListTodo size={16} />
        <span>Tasks</span>
      </button>
      <button
        type="button"
        {...row(placeholder === "automations")}
        aria-current={placeholder === "automations" ? "page" : undefined}
        onClick={() =>
          setPlaceholder((value) =>
            value === "automations" ? null : "automations",
          )
        }
      >
        <CalendarClock size={16} />
        <span>Automations</span>
      </button>
      {placeholder !== null && (
        <p className="shell-coming-soon" role="status">
          {placeholder === "tasks"
            ? "Tasks are coming soon (journey J6): GitHub Issues with worktree sessions."
            : "Automations are coming soon (journey J7): scheduled agent runs with history."}
        </p>
      )}
    </div>
  );
}
