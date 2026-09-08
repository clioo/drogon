// MIT Copyright (c) 2026 Lovecast Inc.
// Status-bar composition ported from the Orca reference (read-only):
//   src/renderer/src/components/status-bar/StatusBarSurface.tsx (left meters,
//     refresh control, right resource segments, empty-usage CTA gate and the
//     roster-pill → Usage popover wiring),
//   src/renderer/src/components/status-bar/StatusBarProviderSegment.tsx
//     (per-provider states: pulsing "···" while loading, "--" when the
//     provider is signed out, alert + status label on failed refresh,
//     MiniBar + verbose windows when data exists, letter badge when
//     icon-only),
//   src/renderer/src/components/status-bar/UsageRosterPanel.tsx (popover
//     content; ported in full in UsageRosterPanel.tsx),
//   src/renderer/src/components/status-bar/StatusBarUsageEmptyCta.tsx
//     (empty-usage CTA; ported in StatusBarUsageEmptyCta.tsx),
//   src/renderer/src/components/status-bar/InlineProviderUsage.tsx (per-window
//     progress bars + percent labels),
//   src/renderer/src/components/status-bar/CaffeinateStatusSegment.tsx (awake
//     dropdown: On/Agent/Off radio group with descriptions, "Keep computer
//     awake" label with the live "mode · activity" status, coffee icon tint
//     and activity dot),
//   src/renderer/src/components/status-bar/resource-usage-status-trigger.tsx
//     and resource-manager-terminal-copy.ts (memory · terminal cluster, a
//     click target like the fork's trigger),
//   src/renderer/src/components/status-bar/PortsStatusSegment.tsx (plug icon +
//     port count, a click target like the fork's popover trigger),
//   src/renderer/src/components/status-bar/usage-error-copy.ts (status labels).
// Adapted: no zustand store; data comes from window.drogon.usage and terminal
// count from the shell's session list. Popover detail lives in the Usage
// roster dropdown and native titles (this repo's tooltip convention). Segment
// click targets (R16-AY2): the roster pill opens the Usage popover; the
// resource cluster opens Settings → Terminal (the session-behavior pane;
// Drogon has no Resource Manager page); ports opens the right-sidebar Ports
// panel (this repo's matching surface for the fork's ports popover).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CircleHelp, Coffee, MemoryStick, Plug, RefreshCw, Settings, Terminal } from "lucide-react";
import type {
  AwakeMode,
  ProviderUsage,
  UsageSnapshot,
} from "../../../../shared/usage-contract";
import type { SettingsSectionId } from "../../features/settings/settings-sections";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { ClaudeIcon, OpenAIIcon } from "./provider-icons";
import {
  UsageRosterPanel,
  type StatusBarUsageMode,
} from "./UsageRosterPanel";
import { StatusBarUsageEmptyCta } from "./StatusBarUsageEmptyCta";
// R16-M (coordinator-approved option A): the daemon connection segment owns
// its own monitor subscription; the bar only mounts it, leading the right
// group like the fork's host segment.
import { DaemonConnectionSegment } from "../../features/status-bar/DaemonConnectionSegment";
import {
  observeStatusBarContainer,
  statusBarCollapseForWidth,
} from "./status-bar-narrow";
import {
  agentAwakeModeLabel,
  AWAKE_MODE_DESCRIPTIONS,
  awakeStatusLabel,
  hasVisibleUsage,
  isUsageEmptyState,
  memoryBadge,
  portsLabel,
  portsAriaLabel,
  portsTitle,
  providerBadgeLetter,
  providerMeterRows,
  providerStatusLabel,
  providerTitle,
  REFRESH_RATE_LIMITS_LABEL,
  REFRESH_USAGE_DATA_TITLE,
  resourceManagerAriaLabel,
  resourceManagerTooltipLines,
} from "./status-bar-copy";

// Poll the cached snapshot every 5s: the IPC reads the main-side cache (real
// probes stay gated by the store's own 60s staleness check), so the awake dot
// follows Auto-mode transitions within one watcher poll instead of a minute —
// the fork's segment subscribes to pushed onChanged events, a channel this
// repo's preload contract does not carry (R16-AY2 adaptation).
const POLL_MS = 5_000;
const CLOCK_TICK_MS = 30_000;

function loadSnapshot(): Promise<UsageSnapshot | null> {
  try {
    const bridge = window.drogon?.usage;
    if (!bridge) return Promise.resolve(null);
    return bridge
      .snapshot()
      .then((result) => (result.ok ? result.result : null))
      .catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

function providerIcon(provider: ProviderUsage["provider"]): React.JSX.Element {
  return provider === "claude" ? <ClaudeIcon /> : <OpenAIIcon />;
}

/**
 * One provider segment, state-for-state from the source
 * StatusBarProviderSegment.ProviderSegment:
 *   idle / fetching without data → icon + pulsing "···"
 *   unavailable (signed out)     → dimmed icon + "--"
 *   error without data           → icon + alert + status label
 *   data (ok, stale or refetch)  → icon + minibar + verbose windows
 *                                  (+ trailing alert when stale)
 * The icon-only tier swaps the data state for the source's letter badge.
 */
function ProviderMeters({
  provider,
  now,
  compact,
  iconOnly,
}: {
  provider: ProviderUsage;
  now: number;
  compact: boolean;
  iconOnly: boolean;
}): React.JSX.Element {
  const rows = providerMeterRows(provider, now);
  const title = providerTitle(provider, now);
  const statusLabel = providerStatusLabel(provider);

  if (rows.length === 0) {
    // Idle / initial load.
    if (provider.status === "idle" || provider.status === "fetching") {
      return (
        <span
          className="inline-flex items-center gap-1 text-muted-foreground"
          title={title}
          data-provider-segment={provider.provider}
        >
          {providerIcon(provider.provider)}
          <span className="animate-pulse">···</span>
        </span>
      );
    }
    // Unavailable (provider not signed in).
    if (provider.status === "unavailable") {
      return (
        <span
          className="inline-flex items-center gap-1 text-muted-foreground/50"
          title={title}
          data-provider-segment={provider.provider}
        >
          {providerIcon(provider.provider)} --
        </span>
      );
    }
    // Error with no data.
    return (
      <span
        className="inline-flex items-center gap-1 text-muted-foreground"
        title={title}
        data-provider-segment={provider.provider}
      >
        {providerIcon(provider.provider)}
        {statusLabel ? (
          <AlertTriangle size={11} className="text-muted-foreground/80" />
        ) : null}
        {!compact && statusLabel ? (
          <span className="text-[11px] font-medium">{statusLabel}</span>
        ) : null}
      </span>
    );
  }

  // Icon-only tier: the source's letter badge replaces the verbose form.
  if (iconOnly) {
    return (
      <span
        className="inline-flex items-center gap-1 text-muted-foreground"
        title={title}
        data-provider-segment={provider.provider}
      >
        <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/60" />
        {providerBadgeLetter(provider.provider)}
      </span>
    );
  }

  const tightest = rows.reduce((current, candidate) =>
    candidate.used > current.used ? candidate : current,
  );
  const stale = provider.status === "error";
  // Compact priority (status-bar-narrow.ts): the tightest window is the
  // binding constraint, so it is the one label that survives; the rest
  // stay one hover away in the tooltip.
  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-muted-foreground"
        title={title}
        data-provider-segment={provider.provider}
      >
        {providerIcon(provider.provider)}
        <span className="tabular-nums" title={tightest.title}>
          {tightest.label}
        </span>
        {stale ? (
          <AlertTriangle size={11} className="text-muted-foreground/80" />
        ) : null}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 text-muted-foreground"
      title={title}
      data-provider-segment={provider.provider}
    >
      {providerIcon(provider.provider)}
      {/* Source MiniBar: quiet muted fill; urgency lives in the labels. */}
      <span
        data-usage-bar
        className="h-[6px] w-[48px] flex-shrink-0 overflow-hidden rounded-full bg-muted"
      >
        <span
          className="block h-full rounded-full bg-muted-foreground/40 transition-all duration-300"
          style={{ width: `${tightest.used}%` }}
        />
      </span>
      {rows.map((row, index) => (
        <React.Fragment key={row.key}>
          {index > 0 ? <span className="text-muted-foreground">·</span> : null}
          <span className="tabular-nums" title={row.title}>
            {row.label}
          </span>
        </React.Fragment>
      ))}
      {stale ? (
        <AlertTriangle size={11} className="text-muted-foreground/80" />
      ) : null}
    </span>
  );
}

/** Idle placeholder used before the first snapshot arrives (source idle form). */
function IdleProviderMeters({ provider }: { provider: "claude" | "codex" }) {
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      {providerIcon(provider)}
      <span className="animate-pulse">···</span>
    </span>
  );
}

const AWAKE_MODES: readonly AwakeMode[] = ["on", "auto", "off"];

export function StatusBar({
  terminalCount,
  onOpenSettings,
  onOpenPorts,
}: {
  terminalCount: number;
  /** Opens the settings page; a section id preselects the pane (fork
      openSettingsTarget + openSettingsPage collapsed to one callback). */
  onOpenSettings: (section?: SettingsSectionId) => void;
  /** Opens the right-sidebar Ports panel (the fork's ports popover surface). */
  onOpenPorts: () => void;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [fetching, setFetching] = useState(false);
  const [usageMenuOpen, setUsageMenuOpen] = useState(false);
  // Fork's persisted statusBarUsageMode, session-scoped here: Drogon has no
  // settings key for it yet (coordinator-owned settings store).
  const [usageMode, setUsageMode] = useState<StatusBarUsageMode>("verbose");
  const [now, setNow] = useState(() => Date.now());
  // Narrow tiers (status-bar-narrow.ts, fork use-status-bar-controller
  // thresholds): the bar measures its own width so segments collapse to
  // icons or hide by priority instead of scrolling horizontally.
  const [containerWidth, setContainerWidth] = useState(900);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const containerRefCallback = useCallback((node: HTMLElement | null) => {
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
    if (node) {
      resizeObserverRef.current = observeStatusBarContainer(
        node,
        setContainerWidth,
      );
      setContainerWidth(node.getBoundingClientRect().width);
    }
  }, []);
  useEffect(
    () => () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    },
    [],
  );
  const collapse = statusBarCollapseForWidth(containerWidth);

  useEffect(() => {
    let mounted = true;
    setFetching(true);
    // First paint wants real numbers, so force a probe; the poll below then
    // coasts on the cached snapshot (which self-refreshes when stale).
    const bridge = window.drogon?.usage;
    const initial = bridge
      ? bridge
          .refresh()
          .then((result) => (result.ok ? result.result : null))
          .catch(() => null)
      : Promise.resolve(null);
    void initial.then((next) => {
      if (mounted) {
        setSnapshot(next);
        setFetching(false);
      }
    });
    const poll = window.setInterval(() => {
      void loadSnapshot().then((next) => {
        if (mounted && next) setSnapshot(next);
      });
    }, POLL_MS);
    const clock = window.setInterval(() => {
      if (mounted) setNow(Date.now());
    }, CLOCK_TICK_MS);
    return () => {
      mounted = false;
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, []);

  const handleRefresh = useCallback(() => {
    const bridge = window.drogon?.usage;
    if (!bridge || fetching) return;
    setFetching(true);
    void bridge
      .refresh()
      .then((result) => {
        if (result.ok) setSnapshot(result.result);
      })
      .catch(() => {})
      .finally(() => setFetching(false));
  }, [fetching]);

  // Fork CaffeinateStatusSegment setMode: the dropdown's radio group.
  const handleAwakeMode = useCallback((next: AwakeMode) => {
    const bridge = window.drogon?.usage;
    if (!bridge) return;
    void bridge
      .setAwake(next)
      .then((result) => {
        if (result.ok) {
          setSnapshot((prev) =>
            prev ? { ...prev, awake: result.result } : prev,
          );
        }
      })
      .catch(() => {});
  }, []);

  const providers =
    snapshot !== null ? [snapshot.claude, snapshot.codex] : [];
  // Source gate (StatusBarSurface): the empty-usage CTA replaces the meters
  // while every provider reports itself unconfigured; pending snapshots
  // (null) keep the idle "···" placeholders instead.
  const emptyUsage = snapshot !== null && isUsageEmptyState(providers);
  const showMeters = snapshot !== null && !emptyUsage;

  const awake = snapshot?.awake;
  const awakeActive = awake?.active ?? false;
  const awakeModeLabel = awake ? agentAwakeModeLabel(awake.mode) : null;
  // Source form (CaffeinateStatusSegment): the accessible name and tooltip
  // carry the title plus "mode · activity", e.g.
  // "Keep computer awake, Off · Inactive".
  const awakeTitle = awake
    ? awake.supported
      ? awakeStatusLabel(awake.mode, awake.active)
      : "Keep computer awake is not supported on this platform"
    : "Awake state unavailable";
  const awakeStatusText = awake
    ? `${awakeModeLabel} · ${awakeActive ? "Active" : "Inactive"}`
    : "…";

  return (
    <footer
      ref={containerRefCallback}
      className="flex items-center h-6 min-h-[24px] px-3 gap-4 border-t border-border bg-[var(--bg-titlebar,var(--card))] text-xs select-none shrink-0 relative"
      aria-label="Status bar"
      data-testid="status-bar"
    >
      <div className="status-bar-group">
        <button
          type="button"
          className="status-bar-icon-button"
          title="Settings"
          aria-label="Settings"
          onClick={() => onOpenSettings()}
        >
          <Settings size={12} />
        </button>
        <span
          className="status-bar-icon"
          title="Drogon desktop: provider usage, awake, memory, terminals and ports at a glance"
          aria-label="Help"
        >
          <CircleHelp size={12} />
        </span>
      </div>

      <div className="status-bar-group status-bar-meters">
        {snapshot === null ? (
          <>
            <IdleProviderMeters provider="claude" />
            <IdleProviderMeters provider="codex" />
          </>
        ) : emptyUsage ? (
          // Source empty state: name the surface and route to the accounts
          // pane (StatusBarUsageEmptyCta); nothing else is rendered here.
          <StatusBarUsageEmptyCta onOpenSettings={() => onOpenSettings("agents")} />
        ) : (
          // Consolidated roster pill → opens the all-agents Usage popover.
          <DropdownMenu
            open={usageMenuOpen}
            onOpenChange={setUsageMenuOpen}
            modal={false}
          >
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-3 rounded px-1 py-0.5 hover:bg-accent/70"
                aria-label="Usage"
                data-testid="usage-roster-trigger"
              >
                <ProviderMeters
                  provider={snapshot.claude}
                  now={now}
                  compact={collapse.compact}
                  iconOnly={collapse.iconOnly}
                />
                <ProviderMeters
                  provider={snapshot.codex}
                  now={now}
                  compact={collapse.compact}
                  iconOnly={collapse.iconOnly}
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              sideOffset={8}
              // Keep the popover above the status bar instead of overlapping
              // it — bottom padding ≈ footer height (fork collisionPadding).
              collisionPadding={{ top: 8, bottom: 32, left: 8, right: 8 }}
              className="w-[360px] p-0"
            >
              <UsageRosterPanel
                providers={providers}
                now={now}
                usageMode={usageMode}
                onUsageModeChange={setUsageMode}
                isRefreshing={fetching}
                onRefresh={handleRefresh}
                onOpenProvider={() => {
                  setUsageMenuOpen(false);
                  onOpenSettings("agents");
                }}
                onManageAccounts={() => {
                  setUsageMenuOpen(false);
                  onOpenSettings("agents");
                }}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {/* Source gate (StatusBarSurface anyVisible && !isEmptyUsageState):
        the refresh control renders only over non-empty usage. */}
        {showMeters && hasVisibleUsage(providers, now) ? (
          <button
            type="button"
            className="status-bar-icon-button"
            title={REFRESH_USAGE_DATA_TITLE}
            aria-label={REFRESH_RATE_LIMITS_LABEL}
            onClick={handleRefresh}
            disabled={fetching}
          >
            <RefreshCw
              size={11}
              className={fetching ? "animate-spin" : undefined}
            />
          </button>
        ) : null}
      </div>

      <div className="status-bar-spacer" />

      <div className="status-bar-group">
        <DaemonConnectionSegment
          compact={collapse.compact}
          iconOnly={collapse.iconOnly}
        />
        {/* Source CaffeinateStatusSegment: a dropdown trigger (coffee icon,
        mode label, activity dot) over an On/Agent/Off radio group with the
        live status in the menu label. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="status-bar-toggle"
              title={awakeTitle}
              aria-label={awakeTitle}
              aria-haspopup="menu"
              data-testid="awake-segment"
              disabled={!awake}
            >
              <Coffee
                size={12}
                className={awakeActive ? "text-foreground" : undefined}
              />
              {collapse.showAwakeLabel ? (
                <span className="text-[11px] font-medium">
                  {awakeModeLabel ?? "…"}
                </span>
              ) : null}
              <span
                aria-hidden
                className={`status-bar-dot${awakeActive ? " status-bar-dot-active" : ""}`}
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-64">
            <DropdownMenuLabel className="flex items-center justify-between gap-3">
              <span>Keep computer awake</span>
              <span className="font-normal text-muted-foreground">
                {awakeStatusText}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={awake?.mode ?? "off"}
              onValueChange={(next) => handleAwakeMode(next as AwakeMode)}
            >
              {AWAKE_MODES.map((mode) => (
                <DropdownMenuRadioItem key={mode} value={mode} className="py-1.5">
                  <span className="flex flex-col">
                    <span>{agentAwakeModeLabel(mode)}</span>
                    <span className="text-[11px] font-normal text-muted-foreground">
                      {AWAKE_MODE_DESCRIPTIONS[mode]}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Source resource-trigger form (resource-usage-status-trigger.tsx):
        memory icon, memory label, "·", terminal icon and the session count in
        one cluster; the separator lives and dies with the memory label, and an
        unmeasured figure degrades to the source's em dash. The fork's trigger
        opens the Resource Manager; Drogon's matching pane is Settings →
        Terminal (session behavior). */}
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-accent/70"
          title={resourceManagerTooltipLines(
            snapshot ? memoryBadge(snapshot.memory.rssBytes) : null,
            terminalCount,
          ).join("\n")}
          aria-label={resourceManagerAriaLabel(terminalCount)}
          data-testid="resource-usage-segment"
          onClick={() => onOpenSettings("terminal")}
        >
          <MemoryStick size={12} className="text-muted-foreground" />
          {collapse.showMemoryLabel ? (
            <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
              {memoryBadge(snapshot?.memory.rssBytes ?? null)}
            </span>
          ) : null}
          {collapse.showMemoryLabel ? (
            <span className="text-muted-foreground/50" aria-hidden>
              ·
            </span>
          ) : null}
          <Terminal size={12} className="text-muted-foreground" />
          {/* Source resource-trigger form: the session count stays while any
          session exists, even icon-only. */}
          {collapse.iconOnly && terminalCount === 0 ? null : (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {terminalCount}
            </span>
          )}
        </button>
        {/* Source PortsStatusSegment form: icon-only keeps the count while
        any port exists. The fork's trigger opens the ports popover; Drogon's
        matching surface is the right-sidebar Ports panel. */}
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-accent/70"
          title={snapshot ? portsTitle(snapshot.ports) : "Ports unavailable"}
          aria-label={
            snapshot
              ? portsAriaLabel(snapshot.ports)
              : "Ports, 0 workspace ports"
          }
          data-testid="ports-segment"
          onClick={onOpenPorts}
        >
          <Plug size={12} className="text-muted-foreground" />
          {collapse.iconOnly &&
          (snapshot?.ports.listening.length ?? 0) === 0 ? null : (
            <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
              {snapshot ? portsLabel(snapshot.ports) : "0"}
            </span>
          )}
        </button>
      </div>
    </footer>
  );
}
