/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/tab-bar/tab-bar-surface.tsx (the "+" trigger
   and menu chrome), tab-bar-static-create-menu.tsx (default-order static
   entries: New Terminal, New Browser Tab, Mentu),
   TabBarCreateEntry.tsx / tab-create-entry-copy.ts (the search combobox)
   and use-tab-bar-create-menu-controller.ts (`launchAgentFromNewTabEntry`:
   an agent row launches immediately with the stored agent defaults — no
   per-launch dialog, exactly like the fork).
   Adapter: no dnd-kit, simulator/open-markdown entries (mobile is out of
   MVP scope and Open Markdown lives in the Explorer — see NOT_PORTED
   below), no
   open-tab/history/file/URL result routing (the combobox filters the
   menu's own entries; full omnibox routing is a follow-up);
   radix-ui primitives stand in for the shadcn menu, and harness icons are
   the source's brand glyphs (see TabCreateMenuIcons.tsx). The interrupted-
   launch "Retry" row is Drogon-specific (the fork has no recovery); it
   replays the exact stored input. */
import { useEffect, useMemo, useRef, useState } from "react";
import { FilePlus, Globe, Network, Plus, Settings as SettingsIcon, TerminalSquare } from "lucide-react";
import { DropdownMenu, Tooltip } from "radix-ui";
import type {
  Harness,
  HarnessLaunchInput,
} from "../../../../shared/session-contract";
import { buildImmediateHarnessLaunch } from "../../../../shared/agent-defaults";
import { Input } from "../../components/ui/input";
import {
  tabCreateMenuChord,
  type TabCreateMenuChordPlatform,
} from "./TabCreateMenuChords";
import { HarnessMenuIcon } from "./TabCreateMenuIcons";
import type { HarnessAgentDefault } from "../../settings-store";
import {
  clearPendingHarnessLaunch,
  loadPendingHarnessLaunch,
  savePendingHarnessLaunch,
} from "../../harness-launch-recovery";

/** Fork-exact omnibox copy (tab-create-entry-copy.ts). */
export const TAB_CREATE_SEARCH_PLACEHOLDER =
  "Search open tabs, history, files, URLs, agents…";

/** darwin vs other, mirroring the fork's shortcut-platform split. */
function menuChordPlatform(): TabCreateMenuChordPlatform {
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return userAgent.includes("Mac") ? "darwin" : "other";
}

/**
 * Entries deliberately not ported from the fork's create menu, and why:
 * - Open Markdown: Drogon opens markdown through the Explorer, not a menu
 *   file picker.
 * - New Mobile Emulator + promo card: mobile is out of the MVP; the fork
 *   renders the promo only conditionally, so omitting it matches the
 *   unconditional render.
 * - Gemini, Kimi, Hermes, OpenClaude, Claude Agent Teams: Drogon ships only
 *   the native Claude, Pi, OpenCode, Antigravity, and Codex harnesses.
 */
export const TAB_CREATE_MENU_NOT_PORTED: readonly string[] = [
  "Open Markdown...",
  "New Mobile Emulator",
  "Mobile Emulator promo card",
  "Gemini",
  "Kimi",
  "Hermes",
  "OpenClaude",
  "Claude Agent Teams",
];

const unavailableHint: Record<
  Exclude<Harness["availability"], "available">,
  string
> = {
  missing: "not found on this host",
  unsupported_launcher: "unsupported launcher",
};

const STATIC_ITEM_CLASS =
  "tab-create-item gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 font-medium";

/** Fork menu-option keywords (tab-create-menu-options.ts), trimmed to what Drogon renders. */
const STATIC_ENTRY_KEYWORDS: Record<
  "terminal" | "browser" | "mentu" | "markdown",
  string
> = {
  terminal: "terminal shell new terminal new shell",
  browser: "browser new browser browser tab web",
  mentu: "mentu recipe workflow run steps",
  markdown: "markdown new file untitled",
};

/** Every whitespace-separated query token must appear in the haystack. */
export function matchesTabCreateQuery(
  label: string,
  keywords: string,
  query: string,
): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = `${label} ${keywords}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

/**
 * Static-row chords resolve through the shared keybinding table, never a
 * hand-written constant: the host props below are a legacy fallback used
 * only when the table has no binding, so a stale App-level chord (see
 * #167) can never reach the menu again.
 */

/**
 * The tab strip "+" menu, in the fork's order: New Terminal, New Browser
 * Tab, Mentu, New Markdown, then one entry per harness (launching
 * immediately with the Settings → Agents defaults, like the fork), then
 * Agent settings. The trigger keeps the source's accessible name so the
 * palette's "Launch harness…" row can open the real menu.
 */
export function TabCreateMenu({
  workspaceId,
  hostId,
  harnesses,
  disabled,
  defaultHarnessId,
  launchDefaults,
  onOpenMentu,
  mentuAvailable,
  onOpenAgentSettings,
  onNewMarkdown,
  newTerminalShortcut,
  newBrowserShortcut,
  onCreateTerminal,
  onLaunch,
  onNewBrowserTab,
}: {
  workspaceId: string;
  /** The execution host this recovery record is scoped to; `null` while disconnected — recovery is a no-op without it. */
  hostId: string | null;
  harnesses: Harness[];
  disabled: boolean;
  /** Stored default harness (badged in the menu) and per-harness defaults a row click launches with. Read-only here; edited in Settings. */
  defaultHarnessId?: string;
  launchDefaults?: Record<string, HarnessAgentDefault>;
  /**
   * Legacy host-provided display chords, kept so App/TabBar keep compiling.
   * The menu renders the shared-table chord first and only falls back to
   * these when the table has no binding, so a stale host value never wins.
   */
  newTerminalShortcut: string;
  newBrowserShortcut: string;
  onCreateTerminal(): void;
  onLaunch(input: HarnessLaunchInput): Promise<boolean>;
  onNewBrowserTab(): void;
  /** R5-S: opens the wider Mentu tab for the selected workspace. Optional
   *  so existing callers/tests that predate Mentu keep compiling. */
  onOpenMentu?: () => void;
  mentuAvailable?: boolean;
  /** Opens Settings on the Agents section. Rendered only when provided —
   *  thread it from the shell (TabBar/App) to show the row. */
  onOpenAgentSettings?: () => void;
  /** Creates an untitled markdown file and opens it as an editor tab.
   *  Rendered only when provided — thread it from the shell to show the
   *  row (fork `onNewFileTab`). */
  onNewMarkdown?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Synchronous guard against a rapid double-invoke (e.g. two fast
  // keyboard-driven `onSelect`s) that `submitting` state alone might not
  // catch before its next render commits.
  const inFlight = useRef(false);
  // An unchanged retry must recover the original admission, not spawn twice.
  const lastAttempt = useRef<{ key: string; requestId: string } | null>(null);
  // Bumped after a save/clear to force the memo below to re-read storage.
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Derived at render time from the *current* props, not effect-set state —
  // avoids a stale-workspace/host value ever being visible in the gap
  // between a prop change committing and an effect running.
  const recoverable = useMemo(
    () =>
      menuOpen && hostId ? loadPendingHarnessLaunch(hostId, workspaceId) : null,
    [menuOpen, hostId, workspaceId, recoveryVersion],
  );

  // Fork parity (TabBarCreateEntry): the search box owns initial focus
  // while the menu is open.
  useEffect(() => {
    if (!menuOpen || typeof requestAnimationFrame === "undefined") return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [menuOpen]);

  const showMentu = !!onOpenMentu && !!mentuAvailable;
  const showAgentSettings = !!onOpenAgentSettings;
  const showNewMarkdown = !!onNewMarkdown;
  const chordPlatform = menuChordPlatform();
  const terminalShortcut =
    tabCreateMenuChord("tab.newTerminal", chordPlatform) || newTerminalShortcut;
  const browserShortcut =
    tabCreateMenuChord("tab.newBrowser", chordPlatform) || newBrowserShortcut;
  const markdownShortcut = tabCreateMenuChord("tab.newMarkdown", chordPlatform);

  const terminalVisible = matchesTabCreateQuery(
    "New Terminal",
    STATIC_ENTRY_KEYWORDS.terminal,
    query,
  );
  const browserVisible = matchesTabCreateQuery(
    "New Browser Tab",
    STATIC_ENTRY_KEYWORDS.browser,
    query,
  );
  const mentuVisible =
    showMentu &&
    matchesTabCreateQuery("Mentu", STATIC_ENTRY_KEYWORDS.mentu, query);
  const markdownVisible =
    showNewMarkdown &&
    matchesTabCreateQuery(
      "New Markdown",
      STATIC_ENTRY_KEYWORDS.markdown,
      query,
    );
  const visibleHarnesses = useMemo(
    () =>
      harnesses.filter((harness) =>
        matchesTabCreateQuery(
          harness.displayName,
          `${harness.harnessId} agent launch`,
          query,
        ),
      ),
    [harnesses, query],
  );
  const hasQuery = query.trim() !== "";
  const staticVisible =
    terminalVisible || browserVisible || mentuVisible || markdownVisible;
  const agentBlockVisible =
    visibleHarnesses.length > 0 || (showAgentSettings && !hasQuery);
  const noMatches = hasQuery && !staticVisible && visibleHarnesses.length === 0;

  const focusEdgeMenuItem = (edge: "first" | "last") => {
    const items = contentRef.current?.querySelectorAll(
      '[role="menuitem"]:not([data-disabled])',
    );
    if (!items || items.length === 0) return false;
    const target = edge === "first" ? items[0] : items[items.length - 1];
    (target as HTMLElement).focus();
    return true;
  };

  const activateFirstMatch = () => {
    if (terminalVisible) {
      onCreateTerminal();
      return;
    }
    if (browserVisible) {
      onNewBrowserTab();
      return;
    }
    if (mentuVisible) {
      onOpenMentu?.();
      return;
    }
    if (markdownVisible) {
      onNewMarkdown?.();
      return;
    }
    const first = visibleHarnesses[0];
    if (first && first.availability === "available") launchImmediately(first);
  };

  const launch = async (input: HarnessLaunchInput) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    if (hostId) savePendingHarnessLaunch(hostId, input);
    setSubmitting(true);
    try {
      const launched = await onLaunch(input);
      // A confirmed launch is complete. The next agent click is a NEW tab,
      // not an idempotent replay of the session we just created.
      if (launched) lastAttempt.current = null;
      // Only a *confirmed* launch clears the recovery record — an ambiguous
      // or refused attempt leaves the exact requestId+params recoverable.
      if (launched && hostId) {
        clearPendingHarnessLaunch(hostId, input);
        setRecoveryVersion((v) => v + 1);
      }
      return launched;
    } finally {
      setSubmitting(false);
      inFlight.current = false;
    }
  };

  // A harness row launches at once with the Settings → Agents defaults —
  // the fork's `launchAgentFromNewTabEntry` behavior. The menu closes on
  // select; the keyboard-first-match path closes it explicitly below.
  const launchImmediately = (harness: Harness) => {
    if (disabled || !hostId || harness.availability !== "available") return;
    const params = buildImmediateHarnessLaunch(
      workspaceId,
      harness.harnessId,
      launchDefaults ?? {},
    );
    const key = JSON.stringify(params);
    const requestId =
      lastAttempt.current?.key === key
        ? lastAttempt.current.requestId
        : crypto.randomUUID();
    lastAttempt.current = { key, requestId };
    setMenuOpen(false);
    void launch({ ...params, requestId });
  };

  const recover = async () => {
    // Re-validated at invocation, not just trusted from the memo above —
    // a recoverable intent for a workspace/host this menu is no longer
    // showing must never be replayed.
    if (
      !recoverable ||
      disabled ||
      !hostId ||
      recoverable.workspaceId !== workspaceId
    )
      return;
    await launch(recoverable);
  };

  return (
    <DropdownMenu.Root
      open={menuOpen}
      onOpenChange={(open) => {
        setMenuOpen(open);
        if (!open) setQuery("");
      }}
      modal={false}
    >
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className="ml-2 my-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-35"
                  title="New tab"
                  aria-label="New tab"
                  disabled={disabled}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </DropdownMenu.Trigger>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className="tooltip" sideOffset={4}>
                New tab
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              ref={contentRef}
              className="z-[70] w-72 max-w-[calc(100vw-1rem)] rounded-[11px] border border-border/80 bg-popover p-1 shadow-[0_16px_36px_rgba(0,0,0,0.24)]"
              align="start"
              sideOffset={6}
            >
              {recoverable && (
                <>
                  <DropdownMenu.Item
                    className={STATIC_ITEM_CLASS}
                    disabled={submitting || disabled}
                    onSelect={() => void recover()}
                  >
                    <span>
                      Retry interrupted{" "}
                      {harnesses.find(
                        (item) => item.harnessId === recoverable.harnessId,
                      )?.displayName ?? recoverable.harnessId}{" "}
                      launch
                    </span>
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="harness-menu-separator" />
                </>
              )}
              <div
                className="-mx-1 flex items-center px-3"
                data-tab-create-search=""
              >
                <Input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      event.stopPropagation();
                      focusEdgeMenuItem(
                        event.key === "ArrowDown" ? "first" : "last",
                      );
                      return;
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.stopPropagation();
                      activateFirstMatch();
                      return;
                    }
                    // Why: every other key (typing, arrows handled above)
                    // must reach the input, not Radix's menu typeahead.
                    // Escape still propagates so an empty query closes the
                    // menu instead of trapping focus in the box.
                    if (event.key === "Escape" && hasQuery) {
                      event.stopPropagation();
                      setQuery("");
                      return;
                    }
                    if (event.key !== "Escape") event.stopPropagation();
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  role="combobox"
                  aria-expanded={false}
                  aria-autocomplete="list"
                  aria-label={TAB_CREATE_SEARCH_PLACEHOLDER}
                  placeholder={TAB_CREATE_SEARCH_PLACEHOLDER}
                  className="h-9 rounded-none border-0 bg-transparent px-0 text-xs font-normal text-foreground shadow-none placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-0 focus-visible:ring-0 md:text-xs dark:bg-transparent"
                />
              </div>
              {/* Above the list like the source: the live region stays mounted
                  so a screen reader announces failures instead of missing
                  the insertion. */}
              <div role="status">
                {noMatches && (
                  <div className="flex min-h-6 items-center gap-1.5 rounded-[7px] px-2 text-[11px] leading-5 text-muted-foreground">
                    <span className="truncate">No matching entries</span>
                  </div>
                )}
              </div>
              <DropdownMenu.Separator className="harness-menu-separator" />
              {terminalVisible && (
                <DropdownMenu.Item
                  className={STATIC_ITEM_CLASS}
                  onSelect={onCreateTerminal}
                >
                  <TerminalSquare className="size-4 text-muted-foreground" />
                  New Terminal
                  {terminalShortcut && (
                    <span className="tab-create-shortcut">{terminalShortcut}</span>
                  )}
                </DropdownMenu.Item>
              )}
              {browserVisible && (
                <DropdownMenu.Item
                  className={STATIC_ITEM_CLASS}
                  onSelect={onNewBrowserTab}
                >
                  <Globe className="size-4 text-muted-foreground" />
                  New Browser Tab
                  {browserShortcut && (
                    <span className="tab-create-shortcut">{browserShortcut}</span>
                  )}
                </DropdownMenu.Item>
              )}
              {mentuVisible && (
                <DropdownMenu.Item
                  className={STATIC_ITEM_CLASS}
                  onSelect={() => onOpenMentu?.()}
                >
                  <Network className="size-4 text-muted-foreground" />
                  Mentu
                </DropdownMenu.Item>
              )}
              {markdownVisible && (
                <DropdownMenu.Item
                  className={STATIC_ITEM_CLASS}
                  onSelect={() => onNewMarkdown?.()}
                >
                  <FilePlus className="size-4 text-muted-foreground" />
                  New Markdown
                  {markdownShortcut && (
                    <span className="tab-create-shortcut">{markdownShortcut}</span>
                  )}
                </DropdownMenu.Item>
              )}
              {agentBlockVisible && (
                <DropdownMenu.Separator className="harness-menu-separator" />
              )}
              {visibleHarnesses.map((harness) => (
                <DropdownMenu.Item
                  key={harness.harnessId}
                  className={STATIC_ITEM_CLASS}
                  disabled={harness.availability !== "available"}
                  onSelect={() => launchImmediately(harness)}
                >
                  <HarnessMenuIcon
                    harnessId={harness.harnessId}
                    displayName={harness.displayName}
                    size={14}
                  />
                  <span className="flex-1">{harness.displayName}</span>
                  {harness.availability !== "available" ? (
                    <span className="tab-create-hint" aria-hidden="true">
                      {unavailableHint[harness.availability]}
                    </span>
                  ) : (
                    defaultHarnessId === harness.harnessId && (
                      <span className="tab-create-hint" aria-hidden="true">Default</span>
                    )
                  )}
                </DropdownMenu.Item>
              ))}
              {showAgentSettings && !hasQuery && (
                <DropdownMenu.Item
                  className={`${STATIC_ITEM_CLASS} text-muted-foreground`}
                  onSelect={() => onOpenAgentSettings?.()}
                >
                  <SettingsIcon className="size-4" />
                  Agent settings…
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
