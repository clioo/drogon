/* MIT Copyright (c) 2026 Lovecast Inc.
 * Ranking adapts the token-score approach from the read-only reference
 * `/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/cmd-j/palette-query-tokens.ts`
 * and `palette-results.ts` (exact > prefix > substring per token, plus a
 * coverage gate so multi-word queries must cover most of what was typed).
 * Rewritten standalone: no i18n, no settings/action split.
 */

import { getKeybindingDefinition } from "../../../../shared/keybindings/definitions";

/** Live App state a command's availability is derived from. */
export interface CommandContext {
  connected: boolean;
  busy: boolean;
  hasWorkspace: boolean;
  filesAvailable: boolean;
  botsAvailable: boolean;
  changesAvailable: boolean;
  harnessAvailable: boolean;
  /** The service advertises worktree.v1. */
  worktreesAvailable: boolean;
  /** A git project is targeted for worktree creation (else the reason says so). */
  canCreateWorktree: boolean;
}

export interface CommandDef {
  id: string;
  label: string;
  /**
   * Keybinding-table row that owns this command's title and chord hint;
   * the labels formatter renders the chord (⌘T on macOS, Ctrl+T elsewhere).
   */
  keybindingActionId?: string;
  /** Static hint for commands with no keybinding-table row. */
  hint?: string;
  keywords: string[];
  isEnabled(context: CommandContext): boolean;
  disabledReason(context: CommandContext): string | null;
}

function needsConnection(context: CommandContext): string | null {
  if (!context.connected) return "Service unavailable: start Drogon and retry";
  if (context.busy) return "Busy: try again when the current operation finishes";
  return null;
}

// Titles come verbatim from the keybinding definitions table (the single
// source; Drogon keybindings/definitions.ts ported from the Orca
// definitions-core files): tab.newTerminal "New terminal tab",
// workspace.create "Create worktree", sidebar.left.toggle "Toggle Sidebar",
// sidebar.right.toggle "Toggle Right Sidebar", sidebar.explorer.toggle
// "Show Explorer", sidebar.sourceControl.toggle "Show Source Control",
// app.settings "Open Settings". Chord hints render through the keybinding
// labels formatter; rows without a table entry keep their own wording.
export const COMMAND_DEFS: readonly CommandDef[] = [
  {
    id: "terminal.new",
    label: getKeybindingDefinition("tab.newTerminal")?.title ?? "New terminal",
    keybindingActionId: "tab.newTerminal",
    keywords: ["new terminal", "new terminal tab", "create terminal", "open terminal", "shell"],
    isEnabled: (context) =>
      context.connected && !context.busy && context.hasWorkspace,
    disabledReason: (context) => {
      if (!context.connected || context.busy) return needsConnection(context);
      return "No workspace selected: add a workspace first";
    },
  },
  {
    id: "harness.launch",
    label: "Launch harness…",
    keywords: [
      "launch harness",
      "new agent session",
      "claude",
      "opencode",
      "pi",
      "codex",
    ],
    isEnabled: (context) =>
      context.connected &&
      !context.busy &&
      context.hasWorkspace &&
      context.harnessAvailable,
    disabledReason: (context) => {
      if (!context.connected || context.busy) return needsConnection(context);
      if (!context.hasWorkspace)
        return "No workspace selected: add a workspace first";
      return "Harness launch is not advertised by the service";
    },
  },
  {
    id: "panel.files",
    label: "Open Files panel",
    keywords: ["open files", "files panel", "explorer", "browse files"],
    isEnabled: (context) =>
      context.connected && !context.busy && context.filesAvailable,
    disabledReason: (context) => {
      if (!context.connected || context.busy) return needsConnection(context);
      return "Files unavailable: service does not advertise files.v1";
    },
  },
  {
    id: "panel.bots",
    label: "Open Bots panel",
    keywords: ["open bots", "bots panel"],
    isEnabled: (context) =>
      context.connected && !context.busy && context.botsAvailable,
    disabledReason: (context) => {
      if (!context.connected || context.busy) return needsConnection(context);
      return "Bots unavailable: service does not advertise bot.snapshot.v1";
    },
  },
  // Sidebar toggles per the source keybinding registry
  // (src/shared/keybindings/definitions-core-1.ts: sidebar.left.toggle on
  // Mod+B, sidebar.right.toggle on Mod+L, sidebar.explorer.toggle on
  // Mod+Shift+E, sidebar.sourceControl.toggle on Mod+Shift+G).
  {
    id: "sidebar.left.toggle",
    label:
      getKeybindingDefinition("sidebar.left.toggle")?.title ?? "Toggle Sidebar",
    keybindingActionId: "sidebar.left.toggle",
    keywords: [
      "toggle sidebar",
      "hide sidebar",
      "show sidebar",
      "left sidebar",
      "projects sidebar",
    ],
    isEnabled: () => true,
    disabledReason: () => null,
  },
  {
    id: "sidebar.right.toggle",
    label:
      getKeybindingDefinition("sidebar.right.toggle")?.title ??
      "Toggle Right Sidebar",
    keybindingActionId: "sidebar.right.toggle",
    keywords: [
      "toggle right sidebar",
      "sidebar right",
      "hide sidebar",
      "show sidebar",
    ],
    isEnabled: () => true,
    disabledReason: () => null,
  },
  {
    id: "sidebar.explorer.toggle",
    label:
      getKeybindingDefinition("sidebar.explorer.toggle")?.title ?? "Show Explorer",
    keybindingActionId: "sidebar.explorer.toggle",
    keywords: ["show explorer", "files panel", "explorer", "browse files"],
    isEnabled: (context) =>
      context.connected && !context.busy && context.filesAvailable,
    disabledReason: (context) => {
      if (!context.connected || context.busy) return needsConnection(context);
      return "Files unavailable: service does not advertise files.v1";
    },
  },
  {
    id: "sidebar.sourceControl.toggle",
    label:
      getKeybindingDefinition("sidebar.sourceControl.toggle")?.title ??
      "Show Source Control",
    keybindingActionId: "sidebar.sourceControl.toggle",
    keywords: [
      "show source control",
      "changes",
      "git",
      "source control",
      "commit",
    ],
    isEnabled: (context) =>
      context.connected && !context.busy && context.changesAvailable,
    disabledReason: (context) => {
      if (!context.connected || context.busy) return needsConnection(context);
      return "Changes unavailable: service does not advertise git.v1";
    },
  },
  {
    id: "inspector.toggle",
    label: "Toggle inspector",
    keywords: ["toggle inspector", "session details", "hide inspector", "show inspector"],
    isEnabled: () => true,
    disabledReason: () => null,
  },
  {
    id: "settings.open",
    label: getKeybindingDefinition("app.settings")?.title ?? "Open Settings",
    keybindingActionId: "app.settings",
    keywords: ["open settings", "preferences", "options"],
    isEnabled: () => true,
    disabledReason: () => null,
  },
  {
    id: "theme.light",
    label: "Theme: Light",
    keywords: ["theme light", "appearance light mode"],
    isEnabled: () => true,
    disabledReason: () => null,
  },
  {
    id: "theme.dark",
    label: "Theme: Dark",
    keywords: ["theme dark", "appearance dark mode"],
    isEnabled: () => true,
    disabledReason: () => null,
  },
  {
    id: "theme.system",
    label: "Theme: System",
    keywords: ["theme system", "appearance follow system", "auto theme"],
    isEnabled: () => true,
    disabledReason: () => null,
  },
  {
    id: "workspace.add",
    label: "Add Project",
    keywords: ["add project", "add workspace", "open folder", "new workspace", "add folder"],
    isEnabled: (context) => context.connected && !context.busy,
    disabledReason: (context) => needsConnection(context),
  },
  {
    id: "worktree.new",
    label: getKeybindingDefinition("workspace.create")?.title ?? "Create worktree",
    keybindingActionId: "workspace.create",
    keywords: ["new worktree", "create worktree", "branch", "git worktree"],
    isEnabled: (context) =>
      context.connected &&
      !context.busy &&
      context.worktreesAvailable &&
      context.canCreateWorktree,
    disabledReason: (context) => {
      if (!context.connected || context.busy) return needsConnection(context);
      if (!context.worktreesAvailable)
        return "Worktrees unavailable: service does not advertise worktree.v1";
      return "No git project selected: add a repository project first";
    },
  },
];

function normalizeQuery(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(value: string): string[] {
  return normalizeQuery(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

// Navigation filler carries no intent ("open files panel" means "files
// panel"), so an unmatched filler word must not count against coverage.
const QUERY_FILLER_TOKENS = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "go",
  "goto",
  "in",
  "into",
  "me",
  "my",
  "of",
  "on",
  "open",
  "please",
  "show",
  "the",
  "to",
  "view",
  "with",
]);

/** Per-token best tier: exact 3, prefix 2, substring 1, else 0. */
export function commandTokenScore(
  queryTokens: readonly string[],
  values: readonly string[],
): number {
  const candidateTokens = values.flatMap(tokenize);
  if (candidateTokens.length === 0) return 0;
  let score = 0;
  let meaningful = 0;
  let covered = 0;
  for (const queryToken of queryTokens) {
    let best = 0;
    for (const candidateToken of candidateTokens) {
      if (candidateToken === queryToken) best = Math.max(best, 3);
      else if (candidateToken.startsWith(queryToken)) best = Math.max(best, 2);
      else if (candidateToken.includes(queryToken)) best = Math.max(best, 1);
    }
    score += best;
    if (QUERY_FILLER_TOKENS.has(queryToken)) continue;
    meaningful += 1;
    if (best > 0) covered += 1;
  }
  // A candidate must cover most of what was typed, not just one word of it.
  if (meaningful > 0 && covered * 2 <= meaningful) return 0;
  return score;
}

export interface RankedCommand {
  def: CommandDef;
  score: number;
  enabled: boolean;
  disabledReason: string | null;
  recent: boolean;
}

/**
 * Ranks command defs against a query. Empty query returns every command in
 * definition order (recents first when provided); disabled commands are kept
 * with their reason — never dropped, never faked as runnable.
 */
export function rankCommands(input: {
  defs: readonly CommandDef[];
  query: string;
  context: CommandContext;
  recentIds?: readonly string[];
}): RankedCommand[] {
  const { defs, query, context, recentIds = [] } = input;
  const recentOrder = new Map(recentIds.map((id, index) => [id, index]));
  const normalized = normalizeQuery(query);
  const rows = defs.map((def) => {
    const enabled = def.isEnabled(context);
    return {
      def,
      enabled,
      disabledReason: enabled ? null : def.disabledReason(context),
      recent: recentOrder.has(def.id),
      score: 0,
    };
  });
  if (!normalized) {
    return rows.sort((a, b) => {
      const aRecent = a.recent ? 0 : 1;
      const bRecent = b.recent ? 0 : 1;
      if (aRecent !== bRecent) return aRecent - bRecent;
      if (a.recent && b.recent)
        return (
          (recentOrder.get(a.def.id) ?? 0) - (recentOrder.get(b.def.id) ?? 0)
        );
      return 0;
    });
  }
  const queryTokens = [...new Set(tokenize(normalized))];
  if (queryTokens.length === 0) return rows;
  const scored = rows
    .map((row) => ({
      ...row,
      score: commandTokenScore(queryTokens, [
        row.def.label,
        ...row.def.keywords,
      ]),
    }))
    .filter((row) => row.score > 0);
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.recent !== b.recent) return a.recent ? -1 : 1;
    return a.def.label.localeCompare(b.def.label);
  });
  return scored;
}
