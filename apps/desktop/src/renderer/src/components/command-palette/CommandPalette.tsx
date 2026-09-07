import { useEffect, useMemo, useRef, useState } from "react";
import { Command } from "cmdk";
import type { FileBridge } from "../../../../shared/file-contract";
import type {
  Session,
  Workspace,
} from "../../../../shared/session-contract";
import type { Theme } from "../../settings-store";
import {
  createShortcutRegistry,
  guardHandler,
  PALETTE_SHORTCUTS,
} from "../../shortcuts";
import {
  COMMAND_DEFS,
  commandTokenScore,
  rankCommands,
  type CommandContext,
} from "./command-registry";
import {
  collectWorkspaceFiles,
  rankQuickOpenFiles,
  type QuickOpenFile,
} from "./quick-open-matches";
import { resolvePaletteFocusRestoreTarget } from "./focus-restore";
import { capPaletteSection } from "./render-cap";
import { loadRecentCommands, recordRecentCommand } from "./recent-commands";
import { openHarnessLaunchMenu } from "./harness-menu";

export type PaletteMode = "commands" | "quick";

export interface CommandPaletteHostProps {
  fileBridge: FileBridge;
  hostId: string | null;
  workspaceId: string;
  workspaces: Workspace[];
  sessions: Session[];
  activeSessionId: string;
  filesAvailable: boolean;
  botsAvailable: boolean;
  harnessAvailable: boolean;
  theme: Theme;
  connected: boolean;
  busy: boolean;
  onNewTerminal(): void;
  onSelectWorkspace(id: string): void;
  onSelectSession(id: string): void;
  onOpenFiles(): void;
  onOpenBots(): void;
  onToggleInspector(): void;
  onOpenSettings(): void;
  onSetTheme(theme: Theme): void;
  onAddWorkspace(): void;
  /** Routes to the Files panel for the path; the panel reveals the file. */
  onOpenFile(path: string): void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
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

  // Global chords: Cmd+K / Cmd+P toggle or switch modes, Cmd+1..9 select a
  // tab, Cmd+Shift+[ / ] move across tabs. Tab chords stay out of editable
  // fields and out of the way while the palette itself is open.
  useEffect(() => {
    const platform = navigator.userAgent.includes("Mac") ? "darwin" : "other";
    const registry = createShortcutRegistry();
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
    const handlers: Record<string, () => void> = {
      "palette.openCommands": () => {
        if (state().open && state().mode === "commands") closePalette();
        else openPalette("commands");
      },
      "palette.openQuickOpen": () => {
        if (state().open && state().mode === "quick") closePalette();
        else openPalette("quick");
      },
      "tabs.prev": () => stepSession(-1),
      "tabs.next": () => stepSession(1),
    };
    for (const def of PALETTE_SHORTCUTS) {
      if (def.id.startsWith("tabs.select")) {
        const index = Number(def.id.slice("tabs.select".length)) - 1;
        registry.register({
          ...def,
          handler: guardHandler(() => selectSessionAt(index), () =>
            state().open,
          ),
        });
      } else {
        const handler = handlers[def.id];
        if (!handler) continue;
        registry.register({
          ...def,
          handler: guardHandler(handler, () =>
            def.id.startsWith("tabs.")
              ? state().open
              : false,
          ),
        });
      }
    }
    const keydown = (event: KeyboardEvent) => {
      const action = registry.matchKeyEvent(event, platform);
      if (!action) return;
      if (
        action.id.startsWith("tabs.") &&
        (state().open || isEditableTarget(event.target))
      )
        return;
      event.preventDefault();
      action.handler();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  if (!open) return null;
  return (
    <PaletteDialog
      mode={mode}
      query={query}
      onQueryChange={setQuery}
      onClose={closePalette}
      {...props}
    />
  );
}

type DialogProps = CommandPaletteHostProps & {
  mode: PaletteMode;
  query: string;
  onQueryChange(query: string): void;
  onClose(): void;
};

function PaletteDialog(props: DialogProps) {
  const { mode, query, onQueryChange, onClose } = props;
  const context: CommandContext = {
    connected: props.connected,
    busy: props.busy,
    hasWorkspace: props.workspaceId !== "",
    filesAvailable: props.filesAvailable,
    botsAvailable: props.botsAvailable,
    harnessAvailable: props.harnessAvailable,
  };
  const [recentIds, setRecentIds] = useState<string[]>(() =>
    loadRecentCommands(window.localStorage),
  );
  const runStaticCommand = (id: string) => {
    switch (id) {
      case "terminal.new":
        props.onNewTerminal();
        break;
      case "harness.launch":
        openHarnessLaunchMenu();
        break;
      case "panel.files":
        props.onOpenFiles();
        break;
      case "panel.bots":
        props.onOpenBots();
        break;
      case "inspector.toggle":
        props.onToggleInspector();
        break;
      case "settings.open":
        props.onOpenSettings();
        break;
      case "theme.light":
        props.onSetTheme("light");
        break;
      case "theme.dark":
        props.onSetTheme("dark");
        break;
      case "theme.system":
        props.onSetTheme("system");
        break;
      case "workspace.add":
        props.onAddWorkspace();
        break;
      default:
        return;
    }
    setRecentIds(recordRecentCommand(window.localStorage, id));
    onClose();
  };

  return (
    <div
      className="command-palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <Command
        label={mode === "commands" ? "Command palette" : "Quick open"}
        shouldFilter={false}
        className="command-palette"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <Command.Input
          autoFocus
          value={query}
          onValueChange={onQueryChange}
          placeholder={
            mode === "commands" ? "Type a command…" : "Type a file name…"
          }
          className="command-palette-input"
        />
        <Command.List className="command-palette-list">
          {mode === "commands" ? (
            <CommandRows
              {...props}
              context={context}
              recentIds={recentIds}
              onRunStatic={runStaticCommand}
              onClose={onClose}
            />
          ) : (
            <QuickOpenRows {...props} onClose={onClose} />
          )}
        </Command.List>
        <div className="command-palette-footer">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </Command>
    </div>
  );
}

function CommandRows(
  props: DialogProps & {
    context: CommandContext;
    recentIds: string[];
    onRunStatic(id: string): void;
  },
) {
  const { query, context, recentIds } = props;
  const ranked = useMemo(
    () =>
      rankCommands({ defs: COMMAND_DEFS, query, context, recentIds }),
    [query, context, recentIds],
  );
  const normalized = query.trim().toLowerCase();
  const queryTokens = useMemo(
    () => [...new Set(normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean))],
    [normalized],
  );
  const workspaceMatches = useMemo(() => {
    if (props.workspaces.length === 0) return [];
    if (!normalized)
      return props.workspaces.map((workspace) => ({ workspace, score: 0 }));
    return props.workspaces
      .map((workspace) => ({
        workspace,
        score: commandTokenScore(queryTokens, [
          workspace.name,
          workspace.path,
        ]),
      }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [props.workspaces, normalized, queryTokens]);
  const sessionMatches = useMemo(() => {
    if (props.sessions.length === 0) return [];
    if (!normalized)
      return props.sessions.map((session) => ({ session, score: 0 }));
    return props.sessions
      .map((session) => ({
        session,
        score: commandTokenScore(queryTokens, [
          session.command,
          session.id,
        ]),
      }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [props.sessions, normalized, queryTokens]);

  const commands = capPaletteSection(ranked);
  const workspaces = capPaletteSection(workspaceMatches);
  const sessions = capPaletteSection(sessionMatches);
  const empty =
    commands.visible.length === 0 &&
    workspaces.visible.length === 0 &&
    sessions.visible.length === 0;

  return (
    <>
      {empty && (
        <div className="command-palette-empty" role="status">
          No matching commands.
        </div>
      )}
      {commands.visible.length > 0 && (
        <Command.Group heading="Commands" className="command-palette-section">
          {commands.visible.map((row) => (
            <Command.Item
              key={row.def.id}
              value={row.def.id}
              disabled={!row.enabled}
              onSelect={() => {
                if (row.enabled) props.onRunStatic(row.def.id);
              }}
              className="jump-palette-item command-palette-row"
            >
              <span className="command-palette-label">{row.def.label}</span>
              {row.recent && (
                <span className="command-palette-badge">recent</span>
              )}
              {row.enabled ? (
                row.def.hint && (
                  <kbd className="command-palette-hint">{row.def.hint}</kbd>
                )
              ) : (
                <span className="command-palette-disabled-reason">
                  {row.disabledReason}
                </span>
              )}
            </Command.Item>
          ))}
          {commands.overflowCount > 0 && (
            <OverflowHint count={commands.overflowCount} />
          )}
        </Command.Group>
      )}
      {workspaces.visible.length > 0 && (
        <Command.Group
          heading="Switch workspace"
          className="command-palette-section"
        >
          {workspaces.visible.map(({ workspace }) => (
            <Command.Item
              key={`workspace:${workspace.id}`}
              value={`workspace:${workspace.id}`}
              onSelect={() => {
                props.onSelectWorkspace(workspace.id);
                props.onClose();
              }}
              className="jump-palette-item command-palette-row"
            >
              <span className="command-palette-label">{workspace.name}</span>
              <span className="command-palette-path">{workspace.path}</span>
            </Command.Item>
          ))}
          {workspaces.overflowCount > 0 && (
            <OverflowHint count={workspaces.overflowCount} />
          )}
        </Command.Group>
      )}
      {sessions.visible.length > 0 && (
        <Command.Group
          heading="Switch session"
          className="command-palette-section"
        >
          {sessions.visible.map(({ session }) => (
            <Command.Item
              key={`session:${session.id}`}
              value={`session:${session.id}`}
              onSelect={() => {
                props.onSelectSession(session.id);
                props.onClose();
              }}
              className="jump-palette-item command-palette-row"
            >
              <span className="command-palette-label">
                {session.command || session.id}
              </span>
              <span className="command-palette-path">{session.verdict}</span>
            </Command.Item>
          ))}
          {sessions.overflowCount > 0 && (
            <OverflowHint count={sessions.overflowCount} />
          )}
        </Command.Group>
      )}
    </>
  );
}

function OverflowHint({ count }: { count: number }) {
  return (
    <div className="command-palette-overflow" role="status">
      +{count} more — keep typing to narrow
    </div>
  );
}

function QuickOpenRows(
  props: DialogProps,
) {
  const { query, fileBridge, hostId, workspaceId, filesAvailable } = props;
  const [files, setFiles] = useState<QuickOpenFile[] | null>(null);
  const [walkError, setWalkError] = useState("");
  const [walkTruncated, setWalkTruncated] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    if (!filesAvailable || hostId === null || workspaceId === "") {
      setFiles([]);
      setWalkError(
        filesAvailable
          ? "No workspace selected."
          : "Files unavailable: service does not advertise files.v1",
      );
      return;
    }
    const current = ++generation.current;
    setFiles(null);
    setWalkError("");
    setWalkTruncated(false);
    void collectWorkspaceFiles({
      bridge: fileBridge,
      scope: { hostId, workspaceId },
    }).then(
      (result) => {
        if (generation.current !== current) return;
        setFiles(result.files);
        setWalkTruncated(result.truncated);
      },
      (failure: unknown) => {
        if (generation.current !== current) return;
        setFiles([]);
        setWalkError(
          failure instanceof Error ? failure.message : "Could not list files.",
        );
      },
    );
  }, [fileBridge, hostId, workspaceId, filesAvailable]);

  const matches = useMemo(
    () => (files === null ? [] : rankQuickOpenFiles(files, query)),
    [files, query],
  );
  const capped = capPaletteSection(matches);

  if (files === null) {
    return (
      <div className="command-palette-empty" role="status">
        Listing files…
      </div>
    );
  }
  if (walkError) {
    return (
      <div className="command-palette-empty" role="alert">
        {walkError}
      </div>
    );
  }
  if (capped.visible.length === 0) {
    return (
      <div className="command-palette-empty" role="status">
        No matching files.
      </div>
    );
  }
  return (
    <>
      {walkTruncated && (
        <div className="command-palette-overflow" role="status">
          Listing truncated at service limits — keep typing to narrow
        </div>
      )}
      {capped.visible.map((match) => (
        <Command.Item
          key={`file:${match.path}`}
          value={`file:${match.path}`}
          onSelect={() => {
            props.onOpenFile(match.path);
            props.onClose();
          }}
          className="jump-palette-item command-palette-row"
        >
          <span className="command-palette-label">{match.name}</span>
          <span className="command-palette-path">{match.path}</span>
        </Command.Item>
      ))}
      {capped.overflowCount > 0 && (
        <OverflowHint count={capped.overflowCount} />
      )}
    </>
  );
}
