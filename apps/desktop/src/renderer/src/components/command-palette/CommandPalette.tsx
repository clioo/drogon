/* MIT Copyright (c) 2026 Lovecast Inc.
 * Palette host: owns the ⌘J/⌘P chords (keybindings/definitions.ts:
 * worktree.palette / worktree.quickOpen toggle or switch modes), focus
 * restore and mode state. The ⌘J surface is the source's jump palette
 * (features/jump-palette, ported from WorktreeJumpPalette.tsx and its
 * worktree-jump-palette-* rows in source order); ⌘P is the source's
 * quick open (features/quick-open). The Drogon-only command rows the
 * source does not have are no longer rendered here — their command ids
 * stay registered in the keybinding table and reachable via menus and
 * Settings. CommandDialog/surface copy ("Jump to...") follows the source.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { BrowserTabState } from "../../../../shared/browser-contract";
import type { FileBridge } from "../../../../shared/file-contract";
import type {
  Session,
  Workspace,
} from "../../../../shared/session-contract";
import type { Theme } from "../../settings-store";
import {
  contextFromTarget,
  createKeybindingRegistry,
  isEditableTarget,
  resolveKeybindingPlatform,
} from "../../keybindings";
import { resolvePaletteFocusRestoreTarget } from "./focus-restore";
import {
  JumpPalette,
  buildJumpBrowserTabs,
  buildJumpQuickActions,
  buildJumpTabs,
  buildJumpWorktrees,
  type JumpQuickActionId,
} from "../../features/jump-palette";
import { QuickOpen } from "../../features/quick-open";
import type { ProjectGroup } from "../../features/shell/project-adapter";

export type PaletteMode = "commands" | "quick";

export interface CommandPaletteHostProps {
  fileBridge: FileBridge;
  hostId: string | null;
  workspaceId: string;
  workspaces: Workspace[];
  sessions: Session[];
  activeSessionId: string;
  projectGroups: ProjectGroup[];
  browserTabs: BrowserTabState[];
  activeBrowserTabId: string | null;
  filesAvailable: boolean;
  botsAvailable: boolean;
  changesAvailable: boolean;
  harnessAvailable: boolean;
  worktreesAvailable: boolean;
  canCreateWorktree: boolean;
  onNewWorktree(): void;
  theme: Theme;
  connected: boolean;
  busy: boolean;
  onNewTerminal(): void;
  onNewBrowserTab(): void;
  onSelectWorkspace(id: string): void;
  onSelectSession(id: string): void;
  onSelectBrowserTab(tabId: string): void;
  onOpenFiles(): void;
  onOpenBots(): void;
  onToggleRightSidebar(): void;
  onToggleSidebar(): void;
  onShowExplorer(): void;
  onShowSourceControl(): void;
  onToggleInspector(): void;
  onOpenSettings(): void;
  onSetTheme(theme: Theme): void;
  onAddWorkspace(): void;
  onAddProject(): void;
  /** Routes to the Files panel for the path; the panel reveals the file. */
  onOpenFile(path: string): void;
}

export function CommandPaletteHost(props: CommandPaletteHostProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PaletteMode>("commands");
  const [query, setQuery] = useState("");
  const openerRef = useRef<HTMLElement | null>(null);
  const stateRef = useRef({ open, mode });
  stateRef.current = { open, mode };
  const propsRef = useRef(props);
  propsRef.current = props;

  const openPalette = (nextMode: PaletteMode) => {
    if (!stateRef.current.open) {
      openerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    setMode(nextMode);
    setQuery("");
    setOpen(true);
  };
  const closePalette = () => {
    setOpen(false);
    setQuery("");
    resolvePaletteFocusRestoreTarget(openerRef.current)?.focus();
  };

  // Source-parity chords (keybindings/definitions.ts): worktree.palette /
  // worktree.quickOpen toggle or switch modes, tab travel moves across
  // sessions. Tab chords stay out of editable fields and out of the way
  // while the palette itself is open. Mod+K is terminal.clear, never the
  // palette; App owns every other id in the table.
  useEffect(() => {
    const uiPlatform = navigator.userAgent.includes("Mac")
      ? "darwin"
      : "other";
    const platform = resolveKeybindingPlatform(uiPlatform);
    const registry = createKeybindingRegistry();
    const current = () => propsRef.current;
    const state = () => stateRef.current;
    const selectSessionAt = (index: number) => {
      const session = current().sessions[index];
      if (session) current().onSelectSession(session.id);
    };
    const stepSession = (delta: 1 | -1) => {
      const { sessions, activeSessionId, onSelectSession } = current();
      if (sessions.length === 0) return;
      const at = sessions.findIndex((item) => item.id === activeSessionId);
      const next =
        (at < 0 ? (delta < 0 ? 0 : -1) : at + delta + sessions.length) %
        sessions.length;
      onSelectSession(sessions[next].id);
    };
    const handlers: Record<string, (digit: number | null) => void> = {
      "worktree.palette": () => {
        if (state().open && state().mode === "commands") closePalette();
        else openPalette("commands");
      },
      "worktree.quickOpen": () => {
        if (state().open && state().mode === "quick") closePalette();
        else openPalette("quick");
      },
      "tab.previousSameType": () => stepSession(-1),
      "tab.previousAllTypes": () => stepSession(-1),
      "tab.nextSameType": () => stepSession(1),
      "tab.nextAllTypes": () => stepSession(1),
      "tab.selectByIndex": (digit) => {
        if (digit !== null) selectSessionAt(digit);
      },
    };
    const keydown = (event: KeyboardEvent) => {
      const match = registry.match(
        {
          key: event.key,
          altKey: event.altKey,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
        },
        platform,
        contextFromTarget(event.target),
        { editableTarget: isEditableTarget(event.target) },
      );
      if (!match) return;
      const handler = handlers[match.id];
      if (!handler) return;
      // While open only the palette toggles tunnel through; tab travel
      // stays out of the way (editable targets already yield via the
      // registry's tabs-scope rule).
      if (
        state().open &&
        match.id !== "worktree.palette" &&
        match.id !== "worktree.quickOpen"
      )
        return;
      event.preventDefault();
      handler(match.digitIndex);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  if (!open) return null;
  if (mode === "quick") {
    return (
      <QuickOpen
        query={query}
        onQueryChange={setQuery}
        onClose={closePalette}
        fileBridge={props.fileBridge}
        hostId={props.hostId}
        workspaceId={props.workspaceId}
        filesAvailable={props.filesAvailable}
        onOpenFile={props.onOpenFile}
      />
    );
  }
  return (
    <JumpPaletteSurface
      query={query}
      onQueryChange={setQuery}
      onClose={closePalette}
      {...props}
    />
  );
}

function JumpPaletteSurface(
  props: CommandPaletteHostProps & {
    query: string;
    onQueryChange(query: string): void;
    onClose(): void;
  },
) {
  const tabs = useMemo(
    () => buildJumpTabs(props.sessions, props.activeSessionId),
    [props.sessions, props.activeSessionId],
  );
  const worktrees = useMemo(
    () =>
      buildJumpWorktrees(props.projectGroups, props.sessions, props.workspaceId),
    [props.projectGroups, props.sessions, props.workspaceId],
  );
  const browserTabs = useMemo(
    () => buildJumpBrowserTabs(props.browserTabs, props.activeBrowserTabId),
    [props.browserTabs, props.activeBrowserTabId],
  );
  const quickActions = useMemo(
    () =>
      buildJumpQuickActions({
        canCreateWorktree: props.canCreateWorktree,
        canNewTerminal:
          props.connected && !props.busy && props.workspaceId !== "",
        canNewBrowserTab:
          props.connected && !props.busy && props.workspaceId !== "",
        canAddProject: props.connected && !props.busy,
      }),
    [props.canCreateWorktree, props.connected, props.busy, props.workspaceId],
  );

  const onQuickAction = (id: JumpQuickActionId) => {
    switch (id) {
      case "worktree.new":
        props.onNewWorktree();
        break;
      case "terminal.new":
        props.onNewTerminal();
        break;
      case "browser.new":
        props.onNewBrowserTab();
        break;
      case "project.add":
        props.onAddProject();
        break;
      case "settings.open":
        props.onOpenSettings();
        break;
    }
  };

  return (
    <JumpPalette
      query={props.query}
      onQueryChange={props.onQueryChange}
      onClose={props.onClose}
      tabs={tabs}
      worktrees={worktrees}
      browserTabs={browserTabs}
      quickActions={quickActions}
      canCreateWorktree={props.canCreateWorktree}
      onSelectSession={props.onSelectSession}
      onSelectWorkspace={props.onSelectWorkspace}
      onSelectBrowserTab={props.onSelectBrowserTab}
      onQuickAction={onQuickAction}
      // The composer owns naming: the query-prefilled create row opens it
      // and the user confirms the name there.
      onCreateWorktree={() => props.onNewWorktree()}
    />
  );
}
