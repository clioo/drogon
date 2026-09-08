// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only; never edit the reference):
//   src/renderer/src/components/status-bar/UsageRosterPanel.tsx (consolidated
//     "Usage" popover: header + density picker + one row per agent + footer
//     actions, with its UsageRow/UsageMetric inner components),
//   src/renderer/src/components/status-bar/usage-roster-row-state.ts (row
//     state vocabulary; projections live in status-bar-copy.ts),
//   src/renderer/src/components/status-bar/usage-roster-formatting.ts
//     (usageTextColorClass; bar bands via this repo's status-bar-fill-*).
// Adapted: two providers (claude/codex) from window.drogon.usage, no i18n and
// no zustand — rows, copy, spacing and ARIA are the fork's verbatim; the
// density picker ports the fork's size="sm" equalWidth segmented control with
// native title tooltips (this repo's status-bar convention). Drogon has no
// usage-stats pane, so the fork's "Usage details & history" footer row has no
// honest target and is omitted; "Manage Accounts…" routes to the Agents
// settings pane, the closest Drogon pane to the fork's accounts page.
import React from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import { DropdownMenuItem } from "../ui/dropdown-menu";
import type { ProviderUsage } from "../../../../shared/usage-contract";
import {
  providerDisplayName,
  usageRosterMaxUsed,
  usageRosterResetLabel,
  usageRosterRowState,
  usageRosterTightest,
  usageRosterWindows,
  usageTextColorClass,
  type UsageRosterRowState,
} from "./status-bar-copy";
import { ClaudeIcon, OpenAIIcon } from "./provider-icons";

export type StatusBarUsageMode = "verbose" | "compact";

/** Fork UsageMetric: window label, 5px bar, colored percent. */
function UsageMetric({
  label,
  used,
  showBar = true,
}: {
  label: string;
  used: number;
  showBar?: boolean;
}): React.JSX.Element {
  return (
    <span data-usage-window={label} className="flex shrink-0 items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      {showBar ? (
        <span
          data-usage-bar
          className="h-[5px] w-7 overflow-hidden rounded-full bg-muted"
        >
          <span
            className={`status-bar-fill status-bar-fill-${
              used < 60 ? "low" : used < 80 ? "mid" : "high"
            }`}
            style={{ width: `${used}%` }}
          />
        </span>
      ) : null}
      <span className={`tabular-nums text-[11px] ${usageTextColorClass(used)}`}>
        {used}%
      </span>
    </span>
  );
}

/** Fork UsageRow: icon box · name · status/reset/tightest, verbose bars below. */
export function UsageRow({
  provider,
  state,
  showSignInAction,
  now,
  mode = "verbose",
}: {
  provider: ProviderUsage;
  state: UsageRosterRowState;
  showSignInAction: boolean;
  now: number;
  mode?: StatusBarUsageMode;
}): React.JSX.Element {
  const windows = usageRosterWindows(provider);
  const hasUsage = windows.length > 0;
  const name = providerDisplayName(provider.provider);
  const reset = hasUsage ? usageRosterResetLabel(provider, now) : null;
  const tightest = mode === "compact" ? usageRosterTightest(provider, now) : null;
  return (
    <div data-usage-mode={mode} className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-2.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border bg-secondary">
          {provider.provider === "claude" ? <ClaudeIcon /> : <OpenAIIcon />}
        </span>
        <span className="min-w-0 shrink truncate text-[13px] font-medium text-foreground">
          {name}
        </span>
        {!hasUsage ? (
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">
            {state.statusLabel}
          </span>
        ) : null}
        {!hasUsage && showSignInAction ? (
          <span className="ml-auto shrink-0 rounded-md border border-border bg-secondary px-2.5 py-0.5 text-xs text-foreground">
            Sign in
          </span>
        ) : null}
        {hasUsage && tightest ? (
          <span className="ml-auto">
            <UsageMetric label={tightest.label} used={tightest.used} showBar={false} />
          </span>
        ) : hasUsage && reset ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">{reset}</span>
        ) : null}
      </div>
      {hasUsage && mode === "verbose" ? (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-[30px]">
          {windows.map((window) => (
            <UsageMetric key={window.key} label={window.label} used={window.used} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Consolidated "Usage" popover — one row per agent (icon · name · reset ·
 * per-window bars), opened from the status-bar roster pill. Deep per-agent
 * actions route to Settings via the callbacks (fork UsageRosterPanel).
 */
export function UsageRosterPanel({
  providers,
  now,
  usageMode,
  onUsageModeChange,
  isRefreshing,
  onRefresh,
  onOpenProvider,
  onManageAccounts,
}: {
  providers: ProviderUsage[];
  /** Shared countdown clock (fork useResetCountdownClock): one tick for all rows. */
  now: number;
  usageMode: StatusBarUsageMode;
  onUsageModeChange: (mode: StatusBarUsageMode) => void;
  isRefreshing: boolean;
  onRefresh: () => void;
  onOpenProvider: (provider: ProviderUsage["provider"]) => void;
  onManageAccounts: () => void;
}): React.JSX.Element {
  // Worst-first so the agent nearest a limit sits on top (fork sort).
  const sorted = [...providers].sort(
    (a, b) => usageRosterMaxUsed(b) - usageRosterMaxUsed(a),
  );
  return (
    <div className="w-[360px] text-xs">
      <div className="flex items-center justify-between px-3.5 pb-2 pt-3">
        <span className="text-[13px] font-semibold text-foreground">Usage</span>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="text-[11px]">all agents</span>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              onRefresh();
            }}
            aria-label="Refresh rate limits"
            className="size-5 justify-center p-0"
          >
            <RefreshCw size={12} className={isRefreshing ? "animate-spin" : ""} />
          </DropdownMenuItem>
        </div>
      </div>
      {/* Density picker lives at the top of the popover it controls
          (view-switcher pattern) so both modes are named and discoverable on
          first open. */}
      <div className="px-3.5 pb-2.5">
        <UsageDensityPicker value={usageMode} onChange={onUsageModeChange} />
      </div>
      <div className="border-t border-border/70" />
      {sorted.map((provider) => {
        const hasUsage = usageRosterWindows(provider).length > 0;
        const state = usageRosterRowState(provider, hasUsage);
        return (
          <DropdownMenuItem
            key={provider.provider}
            onSelect={() => onOpenProvider(provider.provider)}
            className="w-full cursor-pointer rounded-none px-3.5 py-2.5"
          >
            <UsageRow
              provider={provider}
              state={state}
              showSignInAction={state.kind === "sign-in"}
              now={now}
              mode={usageMode}
            />
          </DropdownMenuItem>
        );
      })}
      <div className="border-t border-border/70" />
      <DropdownMenuItem
        onSelect={onManageAccounts}
        className="w-full cursor-pointer justify-between rounded-none px-3.5 py-2.5 text-[13px] text-foreground"
      >
        Manage Accounts…
        <ChevronRight size={14} className="text-muted-foreground" />
      </DropdownMenuItem>
    </div>
  );
}

/**
 * Fork density picker (SettingsSegmentedControl size="sm" equalWidth with the
 * UsageRosterPanel option copy); native-title adaptation of the fork's
 * tooltip-wrapped options.
 */
function UsageDensityPicker({
  value,
  onChange,
}: {
  value: StatusBarUsageMode;
  onChange: (mode: StatusBarUsageMode) => void;
}): React.JSX.Element {
  const options: readonly {
    value: StatusBarUsageMode;
    label: string;
    title: string;
  }[] = [
    {
      value: "verbose",
      label: "Detailed",
      title: "Full usage with bars, labels, and percentages",
    },
    {
      value: "compact",
      label: "Compact",
      title: "Condensed usage: only the tightest window",
    },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Usage footer detail"
      className="inline-flex w-full items-center rounded-md border border-border bg-background/50 p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={`flex-1 rounded-sm px-2.5 py-0.5 text-center text-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
              active
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
