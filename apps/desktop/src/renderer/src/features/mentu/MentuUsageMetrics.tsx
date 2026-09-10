// MIT Copyright (c) 2026 Lovecast Inc.
// Observed-usage metrics for the Mentu Metrics view, ported from the
// reference's `recipe-pane-views.tsx` usage cards and per-attempt rows
// with the same DOM, Tailwind classes, copy and honesty rules: totals
// aggregate only values directly reported by the run record, measured
// values are labeled exact, and everything else stays "unavailable" —
// Drogon estimates nothing. Cost is not part of the runtime's evidence
// schema, so it is never rendered from this component.

import type { MentuStepRun } from "../../../../shared/mentu-contract";
import { Badge } from "../../components/ui/badge";
import {
  formatStepUsageValue,
  formatUsageTotal,
  projectUsage,
  usageExact,
} from "./usage-projection";

/** One total card, same DOM and classes as the pane's `MetricValue`. */
function MetricCard({ value, exact }: { value: string; exact: boolean }) {
  return (
    <div className="rounded-md border border-border bg-card p-3 text-xs">
      <p className="font-medium">{value}</p>
      <Badge variant="outline" className="mt-2 text-[10px]">
        {exact ? "Exact · run record" : "Unavailable"}
      </Badge>
    </div>
  );
}

/** The input/output token total cards for a run's recorded step entries. */
export function UsageTokenCards({ steps }: { steps: MentuStepRun[] }) {
  const { input, output } = projectUsage(steps);
  return (
    <>
      <MetricCard
        value={formatUsageTotal("Input tokens", input)}
        exact={usageExact(input)}
      />
      <MetricCard
        value={formatUsageTotal("Output tokens", output)}
        exact={usageExact(output)}
      />
    </>
  );
}

/** One attempt row's usage spans: recorded model plus token values with
 *  honest unavailable/invalid marking. */
export function UsageStepMetrics({ step }: { step: MentuStepRun }) {
  return (
    <>
      <span>Model: {step.model ?? "unavailable"}</span>
      <span>Input tokens: {formatStepUsageValue(step, "inputTokens")}</span>
      <span>Output tokens: {formatStepUsageValue(step, "outputTokens")}</span>
    </>
  );
}
