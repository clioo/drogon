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
import type { Session, Workspace } from "../../../../shared/session-contract";
import type { Theme } from "../../settings-store";
import {
  contextFromTarget,
  createKeybindingRegistry,
  isEditableTarget,
  resolveKeybindingPlatform,
} from "../../../../shared/keybindings";
import { resolvePaletteFocusRestoreTarget } from "./focus-restore";
import {
  JumpPalette,
  buildJumpBrowserTabs,
  buildJumpEditorTabs,
  buildJumpQuickActions,
  buildJumpTabs,
  buildJumpWorktrees,
  type JumpQuickActionId,
} from "../../features/jump-palette";
import type { EditorTabState } from "../../features/shell/editor-tab";
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
  /** Current workspace's open files for the jump palette's editor rows. */
  editorTabs: EditorTabState[];
  activeEditorTabId: string | null;
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
  onSelectEditorTab(tabId: string): void;
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
  // worktree.quickOpen toggle or switch modes, tab travel moves across the
  // unified terminal/browser/editor strip. Tab chords stay out of editable
  // fields and out of the way while the palette itself is open. Mod+K is
  // terminal.clear, never the palette; App owns every other id in the table.
  useEffect(() => {
    const uiPlatform = navigator.userAgent.includes("Mac") ? "darwin" : "other";
    const platform = resolveKeybindingPlatform(uiPlatform);
    const registry = createKeybindingRegistry();
    const current = () => propsRef.current;
    const state = () => stateRef.current;
    type StripEntry =
      | { kind: "session"; id: string }
      | { kind: "browser"; id: string }
      | { kind: "editor"; id: string };
    const stripEntries = (): StripEntry[] => {
      const props = current();
      return [
        ...props.sessions.map((session) => ({
          kind: "session" as const,
          id: session.id,
        })),
        ...props.browserTabs.map((tab) => ({
          kind: "browser" as const,
          id: tab.tabId,
        })),
        ...props.editorTabs.map((tab) => ({
          kind: "editor" as const,
          id: tab.tabId,
        })),
      ];
    };
    const activeStripEntry = (): StripEntry | null => {
      const props = current();
      const id =
        props.activeEditorTabId ??
        props.activeBrowserTabId ??
        props.activeSessionId;
      return stripEntries().find((entry) => entry.id === id) ?? null;
    };
    const selectEntry = (entry: StripEntry | undefined) => {
      if (!entry) return;
      const props = current();
      if (entry.kind === "session") props.onSelectSession(entry.id);
      else if (entry.kind === "browser") props.onSelectBrowserTab(entry.id);
      else props.onSelectEditorTab(entry.id);
    };
    const selectTabAt = (index: number) => selectEntry(stripEntries()[index]);
    const stepTabs = (
      delta: 1 | -1,
      sameType: boolean,
      onlyKind?: StripEntry["kind"],
    ) => {
      const entries = stripEntries();
      if (entries.length === 0) return;
      const active = activeStripEntry();
      const candidates = onlyKind
        ? entries.filter((entry) => entry.kind === onlyKind)
        : sameType && active
          ? entries.filter((entry) => entry.kind === active.kind)
          : entries;
      if (candidates.length === 0) return;
      const at = active
        ? candidates.findIndex((entry) => entry.id === active.id)
        : -1;
      const next =
        (at < 0 ? (delta < 0 ? 0 : -1) : at + delta + candidates.length) %
        candidates.length;
      selectEntry(candidates[next]);
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
      "tab.previousSameType": () => stepTabs(-1, true),
      "tab.previousAllTypes": () => stepTabs(-1, false),
      "tab.nextSameType": () => stepTabs(1, true),
      "tab.nextAllTypes": () => stepTabs(1, false),
      "tab.previousRecent": () => stepTabs(-1, false),
      "tab.nextTerminal": () => stepTabs(1, false, "session"),
      "tab.previousTerminal": () => stepTabs(-1, false, "session"),
      "tab.selectByIndex": (digit) => {
        if (digit !== null) selectTabAt(digit);
      },
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat || event.defaultPrevented) return;
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
  const editorTabs = useMemo(
    () => buildJumpEditorTabs(props.editorTabs, props.activeEditorTabId),
    [props.editorTabs, props.activeEditorTabId],
  );
  const worktrees = useMemo(
    () =>
      buildJumpWorktrees(
        props.projectGroups,
        props.sessions,
        props.workspaceId,
      ),
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
      editorTabs={editorTabs}
      worktrees={worktrees}
      browserTabs={browserTabs}
      quickActions={quickActions}
      canCreateWorktree={props.canCreateWorktree}
      onSelectSession={props.onSelectSession}
      onSelectEditorTab={props.onSelectEditorTab}
      onSelectWorkspace={props.onSelectWorkspace}
      onSelectBrowserTab={props.onSelectBrowserTab}
      onQuickAction={onQuickAction}
      // The composer owns naming: the query-prefilled create row opens it
      // and the user confirms the name there.
      onCreateWorktree={() => props.onNewWorktree()}
    />
  );
}
