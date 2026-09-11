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
  runHasAgentSteps,
  usageCardKind,
  USAGE_CARD_BADGE,
  type UsageCardKind,
} from "./usage-projection";

/** One total card, same DOM and classes as the pane's `MetricValue`. The
 *  badge distinguishes a measured total from a not-applicable (shell-only),
 *  not-reported (agent record omitted it) or failed-to-parse value. */
function MetricCard({ value, kind }: { value: string; kind: UsageCardKind }) {
  return (
    <div className="rounded-md border border-border bg-card p-3 text-xs">
      <p className="font-medium">{value}</p>
      <Badge variant="outline" className="mt-2 text-[10px]">
        {USAGE_CARD_BADGE[kind]}
      </Badge>
    </div>
  );
}

/** The input/output token total cards for a run's recorded step entries.
 *  A shell-only run has no model, so both fields read "not applicable"; an
 *  agent run whose record omits them reads "not reported". */
export function UsageTokenCards({ steps }: { steps: MentuStepRun[] }) {
  const { input, output } = projectUsage(steps);
  const hasAgentSteps = runHasAgentSteps(steps);
  const applicability = hasAgentSteps ? "applicable" : "not_applicable";
  return (
    <>
      <MetricCard
        value={formatUsageTotal("Input tokens", input, applicability)}
        kind={usageCardKind(input, hasAgentSteps)}
      />
      <MetricCard
        value={formatUsageTotal("Output tokens", output, applicability)}
        kind={usageCardKind(output, hasAgentSteps)}
      />
    </>
  );
}

/** One attempt row's usage spans: recorded model plus token values with
 *  honest not-applicable / not-reported / failed-to-parse marking. */
export function UsageStepMetrics({ step }: { step: MentuStepRun }) {
  return (
    <>
      <span>
        Model:{" "}
        {step.backend === "shell"
          ? "not applicable"
          : (step.model ?? "not reported")}
      </span>
      <span>Input tokens: {formatStepUsageValue(step, "inputTokens")}</span>
      <span>Output tokens: {formatStepUsageValue(step, "outputTokens")}</span>
    </>
  );
}
