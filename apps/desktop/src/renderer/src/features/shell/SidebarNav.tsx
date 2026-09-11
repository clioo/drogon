/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/SidebarNav.tsx (adapter: Orca's
   zustand view store becomes props; the Tasks row is the ported
   SidebarTaskNavButton with its hover-revealed provider shortcut chips;
   the setup-guide/agent-dashboard entries are out of MVP scope; the Mobile
   row stays in the code behind the product-mode gate, hidden).
   In the source Files and Changes live in the right-sidebar activity bar
   and Browser opens as a tab: they are not nav rows. Until that
   restructure lands, Sessions routes to the terminals view and
   Files/Changes/Browser stay reachable from the command palette. */
import {
  Bot,
  CalendarClock,
  CalendarDays,
  Search,
  Smartphone,
  SquareTerminal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BOTS_ROUTE_ID } from "../../bots-mount";
import { MEETINGS_ROUTE_ID } from "../../meetings-mount";
import { AUTOMATIONS_ROUTE_ID } from "../../automations-mount";
import { TASKS_ROUTE_ID } from "../../tasks-mount";
import { ShortcutKeyCombo } from "../../components/ShortcutKeyCombo";
import { useShortcutKeyComboDetails } from "../../components/shortcut-labels";
import { isDrogonProductSurfaceVisible } from "./product-mode";
import { SidebarTaskNavButton } from "./SidebarTaskNavButton";

function rowClass(active: boolean): string {
  return `flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors ${
    active
      ? "bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground"
      : "text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8"
  }`;
}

function rowIconClass(active: boolean): string {
  return `size-4 shrink-0${active ? "" : " text-worktree-sidebar-foreground/30"}`;
}

function ProductNavButton({
  label,
  active,
  icon: Icon,
  onClick,
}: {
  label: string;
  active: boolean;
  icon: LucideIcon;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={rowClass(active)}
    >
      <Icon
        className={rowIconClass(active)}
        strokeWidth={active ? 2.25 : 1.75}
      />
      <span className="flex-1">{label}</span>
    </button>
  );
}

export function SidebarNav({
  route,
  onSelectRoute,
  onOpenPalette,
  showTasksButton = true,
  showAutomationsButton = true,
}: {
  route: string | null;
  onSelectRoute: (route: string | null) => void;
  onOpenPalette: () => void;
  /** Appearance flags (source showTasksButton / showAutomationsButton, default-on). */
  showTasksButton?: boolean;
  showAutomationsButton?: boolean;
}): React.JSX.Element {
  // Hint labels come from the keybinding labels formatter (⌘J on macOS,
  // Ctrl+Shift+J elsewhere) — never a hardcoded glyph.
  const worktreePaletteShortcutCombos = useShortcutKeyComboDetails(
    "worktree.palette",
  );
  const sessionsActive = route === null;
  const botsActive = route === BOTS_ROUTE_ID;
  const tasksActive = route === TASKS_ROUTE_ID;
  const automationsActive = route === AUTOMATIONS_ROUTE_ID;
  return (
    <div className="flex flex-col gap-0.5 px-2 pt-2 pb-1">
      <button
        type="button"
        onClick={onOpenPalette}
        aria-label="Search worktrees and browser tabs"
        className="group flex w-full items-center gap-2 rounded-md bg-worktree-sidebar-foreground/5 px-2 py-1.5 text-left text-[13px] font-medium tracking-tight text-worktree-sidebar-foreground/60 transition-colors hover:bg-worktree-sidebar-foreground/8"
      >
        <Search
          className="size-4 shrink-0 text-worktree-sidebar-foreground/30"
          strokeWidth={1.75}
        />
        <span className="flex-1">Search</span>
        <span className="pointer-events-none hidden shrink-0 items-center gap-1 group-hover:flex group-focus-within:flex">
          {worktreePaletteShortcutCombos.map((combo) => (
            <ShortcutKeyCombo
              key={combo.keys.join("-")}
              keys={combo.keys}
              doubleTap={combo.doubleTap}
              className="inline-flex gap-0.5"
              keyCapClassName="min-w-4 border-worktree-sidebar-border/80 bg-worktree-sidebar-foreground/8 px-1 py-px text-[9px] text-worktree-sidebar-foreground/55 shadow-none"
              separatorClassName="text-[9px] text-worktree-sidebar-foreground/45"
            />
          ))}
        </span>
      </button>
      {isDrogonProductSurfaceVisible("sessions") ? (
        <div className="space-y-0.5">
          <ProductNavButton
            label="Sessions"
            active={sessionsActive}
            icon={SquareTerminal}
            onClick={() => onSelectRoute(null)}
          />
          {isDrogonProductSurfaceVisible("bots") ? (
            <ProductNavButton
              label="Bots"
              active={botsActive}
              icon={Bot}
              onClick={() => onSelectRoute(BOTS_ROUTE_ID)}
            />
          ) : null}
          {isDrogonProductSurfaceVisible("meetings") ? (
            <ProductNavButton
              label="Meetings"
              active={route === MEETINGS_ROUTE_ID}
              icon={CalendarDays}
              onClick={() => onSelectRoute(MEETINGS_ROUTE_ID)}
            />
          ) : null}
        </div>
      ) : null}
      {showTasksButton ? (
        <SidebarTaskNavButton
          active={tasksActive}
          onOpenTasks={() => onSelectRoute(TASKS_ROUTE_ID)}
        />
      ) : null}
      {showAutomationsButton ? (
        <ProductNavButton
          label="Automations"
          active={automationsActive}
          icon={CalendarClock}
          onClick={() => onSelectRoute(AUTOMATIONS_ROUTE_ID)}
        />
      ) : null}
      {isDrogonProductSurfaceVisible("mobile") ? (
        <ProductNavButton
          label="Drogon Mobile"
          active={route === "mobile"}
          icon={Smartphone}
          onClick={() => onSelectRoute("mobile")}
        />
      ) : null}
    </div>
  );
}
