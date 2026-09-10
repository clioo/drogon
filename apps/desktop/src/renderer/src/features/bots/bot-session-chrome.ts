// MIT Copyright (c) 2026 Lovecast Inc.
// Pure presentation helpers for the Bot-scoped session chrome
// (bug-bot-a836b4ebf8be65505): the breadcrumb/header above the terminal
// and the "Bot session" right-sidebar inspector. No network/bridge calls
// here -- every value is derived from data the caller already has (a real
// Session and/or the identity the dispatched open-session turn echoed),
// never invented.
import type { HarnessId } from "../../../../shared/session-contract";
import { formatRowHarnessLabel } from "../shell/worktree-agent-rows";

/** Real vendor names for the admitted harness catalog -- factual, static
 *  labels (never per-session data), matching the inspector's "Harness"
 *  row shape ("Claude (Anthropic)"). */
const HARNESS_PROVIDER: Record<HarnessId, string> = {
  claude: "Anthropic",
  pi: "Pi Labs",
  opencode: "OpenCode",
  antigravity: "Antigravity",
  codex: "OpenAI",
};

export function harnessProviderLabel(harnessId: HarnessId | string): string {
  const provider = HARNESS_PROVIDER[harnessId as HarnessId];
  const name = formatRowHarnessLabel((harnessId as HarnessId) ?? null);
  return provider ? `${name} (${provider})` : name;
}

/** Tab strip / header title: "<Bot name> · <Harness>". */
export function botSessionTitle(
  displayName: string,
  harnessId: HarnessId | string,
): string {
  return `${displayName} · ${formatRowHarnessLabel(harnessId as HarnessId)}`;
}

/** Up to two initials from the display name's first two words, uppercased
 *  ("Arya Stark" -> "AS", "Watcher" -> "W"). Never invents a name: an
 *  empty/blank display name yields "". */
export function botInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

/** `@handle`, or `null` when the Bot has none -- callers render an honest
 *  empty state rather than inventing one. */
export function botHandleLabel(handle: string | null): string | null {
  if (!handle) return null;
  return handle.startsWith("@") ? handle : `@${handle}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** `HH:MM:SS` elapsed clock, floored at zero. */
export function formatElapsedClock(deltaMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(deltaMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

/** "Just now (00:04:12)" style label for the inspector's Started row --
 *  live-ticking (the caller re-renders on an interval and passes a fresh
 *  `nowMs`), coarse relative phrase plus the precise elapsed clock. */
/** Bot identity + harness/workspace facts the dispatched open-session turn
 *  actually echoed (App.tsx's `onOpenSession` handler) -- everything a
 *  session needs to render bot-scoped chrome, keyed by the real session id.
 *  Deliberately carries no liveness/timing fields: those come from the
 *  live `Session` (verdict, agentState, createdAt) and the periodic
 *  `bot.snapshot` pid projection, never duplicated/staled here. */
export type BotSessionMeta = {
  botId: string;
  incarnation: string;
  displayName: string;
  handle: string | null;
  title: string | null;
  harnessId: HarnessId;
  model: string | null;
  workspaceId: string;
  hostId: string;
};

export function formatBotSessionStarted(
  startedAtMs: number,
  nowMs: number,
): string {
  const deltaMs = Math.max(0, nowMs - startedAtMs);
  const minutes = Math.floor(deltaMs / 60_000);
  let relative: string;
  if (minutes < 1) relative = "Just now";
  else if (minutes < 60) relative = `${minutes}m ago`;
  else if (minutes < 60 * 24) relative = `${Math.floor(minutes / 60)}h ago`;
  else relative = `${Math.floor(minutes / (60 * 24))}d ago`;
  return `${relative} (${formatElapsedClock(deltaMs)})`;
}
