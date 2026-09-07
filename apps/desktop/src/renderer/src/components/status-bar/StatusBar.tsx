// MIT Copyright (c) 2026 Lovecast Inc.
// Status-bar composition ported from the Orca reference (read-only):
//   src/renderer/src/components/status-bar/StatusBarSurface.tsx (left meters,
//     refresh control, right resource segments),
//   src/renderer/src/components/status-bar/InlineProviderUsage.tsx (per-window
//     progress bars + percent labels),
//   src/renderer/src/components/status-bar/CaffeinateStatusSegment.tsx (awake
//     toggle semantics),
//   src/renderer/src/components/status-bar/PortsStatusSegment.tsx (plug icon +
//     port count),
//   src/renderer/src/components/status-bar/ResourceUsageStatusSegment.tsx and
//   resource-memory-metric-copy.ts (memory segment semantics).
// Adapted: no zustand store, no popovers/menus; data comes from
// window.drogon.usage and terminal count from the shell's session list.
// Unavailable sources render "unavailable" with the reason as tooltip.
import { useCallback, useEffect, useState } from "react";
import {
  CircleHelp,
  Coffee,
  MemoryStick,
  Plug,
  RefreshCw,
  Settings,
  TerminalSquare,
} from "lucide-react";
import type { AwakeMode, UsageSnapshot } from "../../../../shared/usage-contract";
import { barColorClass } from "../../../../shared/usage-contract";
import { ClaudeIcon, OpenAIIcon } from "./provider-icons";
import {
  memoryLabel,
  memoryTitle,
  portsLabel,
  portsTitle,
  providerDisplayName,
  providerMeterRows,
  providerTitle,
  terminalsTitle,
} from "./status-bar-copy";
import type { ProviderUsage } from "../../../../shared/usage-contract";

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

function ProviderMeters({
  provider,
  now,
}: {
  provider: ProviderUsage;
  now: number;
}): React.JSX.Element {
  const rows = providerMeterRows(provider, now);
  const Icon = provider.provider === "claude" ? ClaudeIcon : OpenAIIcon;
  if (rows.length === 0) {
    return (
      <span className="status-bar-provider" title={providerTitle(provider, now)}>
        <Icon />
        <span className="status-bar-name">{providerDisplayName(provider.provider)}</span>
        <span className="status-bar-unavailable">unavailable</span>
      </span>
    );
  }
  return (
    <span className="status-bar-provider" title={providerTitle(provider, now)}>
      <Icon />
      <span className="status-bar-name">{providerDisplayName(provider.provider)}</span>
      {rows.map((row) => (
        <span key={row.key} className="status-bar-meter" title={row.title}>
          <span className="status-bar-track">
            <span
              className={`status-bar-fill ${barColorClass(row.used)}`}
              style={{ width: `${row.used}%` }}
            />
          </span>
          <span className="status-bar-meter-label">{row.label}</span>
        </span>
      ))}
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
  const awakeTitle = awake
    ? awake.supported
      ? `Keep awake ${awake.mode === "on" ? "On — holding caffeinate" : "Off — normal sleep"}`
      : "Keep awake is not supported on this platform"
    : "Awake state unavailable";

  return (
    <footer className="status-bar" aria-label="Status bar" data-testid="status-bar">
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
            <ProviderMeters provider={snapshot.claude} now={now} />
            <ProviderMeters provider={snapshot.codex} now={now} />
          </>
        ) : (
          <span className="status-bar-unavailable" title="Loading usage">
            loading usage…
          </span>
        )}
        <button
          type="button"
          className="status-bar-icon-button"
          title="Refresh usage data"
          aria-label="Refresh usage data"
          onClick={handleRefresh}
          disabled={fetching}
        >
          <RefreshCw size={11} className={fetching ? "animate-spin" : undefined} />
        </button>
      </div>

      <div className="status-bar-spacer" />

      <div className="status-bar-group">
        <button
          type="button"
          className="status-bar-toggle"
          title={awakeTitle}
          aria-label={awakeTitle}
          aria-pressed={awake?.mode === "on"}
          onClick={handleAwake}
          disabled={!awake}
        >
          <Coffee size={12} />
          <span>{awake ? (awake.mode === "on" ? "On" : "Off") : "…"}</span>
          <span
            aria-hidden
            className={`status-bar-dot${awake?.active ? " status-bar-dot-active" : ""}`}
          />
        </button>
        <span
          className="status-bar-segment"
          title={snapshot ? memoryTitle(snapshot.memory) : "Memory unavailable"}
        >
          <MemoryStick size={12} />
          <span>{snapshot ? memoryLabel(snapshot.memory.rssBytes) : "…"}</span>
        </span>
        <span className="status-bar-segment" title={terminalsTitle(terminalCount)}>
          <TerminalSquare size={12} />
          <span>{terminalCount}</span>
        </span>
        <span
          className="status-bar-segment"
          title={snapshot ? portsTitle(snapshot.ports) : "Ports unavailable"}
        >
          <Plug size={12} />
          <span>{snapshot ? portsLabel(snapshot.ports) : "…"}</span>
        </span>
      </div>
    </footer>
  );
}
