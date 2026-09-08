// MIT Copyright (c) 2026 Lovecast Inc.
// Status-bar composition ported from the Orca reference (read-only):
//   src/renderer/src/components/status-bar/StatusBarSurface.tsx (left meters,
//     refresh control, right resource segments),
//   src/renderer/src/components/status-bar/StatusBarProviderSegment.tsx
//     (per-provider states: pulsing "···" while loading, "--" when the
//     provider is signed out, alert + status label on failed refresh,
//     MiniBar + verbose windows when data exists, letter badge when
//     icon-only),
//   src/renderer/src/components/status-bar/InlineProviderUsage.tsx (per-window
//     progress bars + percent labels),
//   src/renderer/src/components/status-bar/CaffeinateStatusSegment.tsx (awake
//     toggle semantics and Off/On · Active/Inactive copy),
//   src/renderer/src/components/status-bar/resource-usage-status-trigger.tsx
//     and resource-manager-terminal-copy.ts (memory · terminal cluster),
//   src/renderer/src/components/status-bar/PortsStatusSegment.tsx (plug icon +
//     port count),
//   src/renderer/src/components/status-bar/usage-error-copy.ts (status labels).
// Adapted: no zustand store, no popovers/menus; data comes from
// window.drogon.usage and terminal count from the shell's session list, so
// each provider segment keeps its detail in the native tooltip instead of a
// Usage popover, and awake stays a plain Off/On toggle (Drogon has no Auto
// mode). Unavailable sources render the source's "--"/"···" forms.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CircleHelp, Coffee, MemoryStick, Plug, RefreshCw, Settings, Terminal } from "lucide-react";
import type {
  AwakeMode,
  ProviderUsage,
  UsageSnapshot,
} from "../../../../shared/usage-contract";
import { ClaudeIcon, OpenAIIcon } from "./provider-icons";
// R16-M (coordinator-approved option A): the daemon connection segment owns
// its own monitor subscription; the bar only mounts it, leading the right
// group like the fork's host segment.
import { DaemonConnectionSegment } from "../../features/status-bar/DaemonConnectionSegment";
import {
  observeStatusBarContainer,
  statusBarCollapseForWidth,
} from "./status-bar-narrow";
import {
  awakeStatusLabel,
  hasVisibleUsage,
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

const POLL_MS = 60_000;
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

export function StatusBar({
  terminalCount,
  onOpenSettings,
}: {
  terminalCount: number;
  onOpenSettings: () => void;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [fetching, setFetching] = useState(false);
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

  const handleAwake = useCallback(() => {
    const bridge = window.drogon?.usage;
    if (!bridge || !snapshot) return;
    const next: AwakeMode = snapshot.awake.mode === "on" ? "off" : "on";
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
  }, [snapshot]);

  const awake = snapshot?.awake;
  const awakeActive = awake?.active ?? false;
  const awakeModeLabel = awake ? (awake.mode === "on" ? "On" : "Off") : null;
  // Source form (CaffeinateStatusSegment): the accessible name and tooltip
  // carry the title plus "mode · activity", e.g.
  // "Keep computer awake, Off · Inactive".
  const awakeTitle = awake
    ? awake.supported
      ? awakeStatusLabel(awake.mode, awake.active)
      : "Keep computer awake is not supported on this platform"
    : "Awake state unavailable";

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
          onClick={onOpenSettings}
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
        {snapshot ? (
          <>
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
          </>
        ) : (
          <>
            <IdleProviderMeters provider="claude" />
            <IdleProviderMeters provider="codex" />
          </>
        )}
        {/* Source gate (StatusBarSurface anyVisible && !isEmptyUsageState):
        the refresh control renders only over non-empty usage. */}
        {snapshot && hasVisibleUsage([snapshot.claude, snapshot.codex], now) ? (
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
        {/* Source CaffeinateStatusSegment form: coffee icon, mode label,
        activity dot bright when the assertion is held. */}
        <button
          type="button"
          className="status-bar-toggle"
          title={awakeTitle}
          aria-label={awakeTitle}
          aria-pressed={awake?.mode === "on"}
          onClick={handleAwake}
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
        {/* Source resource-trigger form (resource-usage-status-trigger.tsx):
        memory icon, memory label, "·", terminal icon and the session count in
        one cluster; the separator lives and dies with the memory label, and an
        unmeasured figure degrades to the source's em dash. */}
        <span
          className="status-bar-segment"
          title={resourceManagerTooltipLines(
            snapshot ? memoryBadge(snapshot.memory.rssBytes) : null,
            terminalCount,
          ).join("\n")}
          aria-label={resourceManagerAriaLabel(terminalCount)}
          data-testid="resource-usage-segment"
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
        </span>
        {/* Source PortsStatusSegment form: icon-only keeps the count while
        any port exists. */}
        <span
          className="status-bar-segment"
          title={snapshot ? portsTitle(snapshot.ports) : "Ports unavailable"}
          aria-label={
            snapshot
              ? portsAriaLabel(snapshot.ports)
              : "Ports, 0 workspace ports"
          }
        >
          <Plug size={12} className="text-muted-foreground" />
          {collapse.iconOnly &&
          (snapshot?.ports.listening.length ?? 0) === 0 ? null : (
            <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
              {snapshot ? portsLabel(snapshot.ports) : "0"}
            </span>
          )}
        </span>
      </div>
    </footer>
  );
}
