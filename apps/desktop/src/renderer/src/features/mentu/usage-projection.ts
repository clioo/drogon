// MIT Copyright (c) 2026 Lovecast Inc.
// Renderer port of the daemon's observed usage projection
// (`crates/drogon-core/src/mentu/usage.rs`, `project_usage`). Every
// `steps[]` entry is one recorded attempt and carries that attempt's own
// token counts; the record has no aggregated run-level usage object, so
// summing each measured entry exactly once is the run total — there is no
// second, already-aggregated level to double-count. The projection is a
// pure function of the entries: refreshing or re-reading the same run
// cannot grow totals. Entries with no measured value stay unknown (never
// fabricated zeros), and recorded-but-rejected values are visibly marked.

import type {
  MentuStepRun,
  MentuUsageInvalidReason,
} from "../../../../shared/mentu-contract";

export type UsageTokenField = "inputTokens" | "outputTokens";

/** The run-record key a rejected value was recorded under, for matching
 *  a step usage `invalid` issue to its token field. */
const FIELD_RECORD_KEYS: Record<UsageTokenField, string> = {
  inputTokens: "input_tokens",
  outputTokens: "output_tokens",
};

export type UsageFieldProjection = {
  /** Sum of every measured entry value; null when nothing was measured. */
  total: number | null;
  /** Entries with no measured value: the key absent, an unreported zero
   *  (no `usageKnown: true`), or no usage object at all. */
  unknownCount: number;
  /** Recorded-but-rejected values; these also count as unknown. */
  invalidCount: number;
};

export type UsageProjection = {
  input: UsageFieldProjection;
  output: UsageFieldProjection;
};

/** How a usage card's value must be read. `not_applicable` is a shell-only
 *  run (no model, so no tokens or cost can exist); `not_reported` is an
 *  agent run whose record omits the field; `failed_to_parse` is a value the
 *  record carried but Drogon refused; `partial` is a real total that does
 *  not cover every entry. */
export type UsageCardKind =
  | "exact"
  | "partial"
  | "not_applicable"
  | "not_reported"
  | "failed_to_parse";

export const USAGE_CARD_BADGE: Record<UsageCardKind, string> = {
  exact: "Exact · run record",
  partial: "Unavailable",
  not_applicable: "Not applicable",
  not_reported: "Not reported",
  failed_to_parse: "Failed to parse",
};

/** True when any step is an agent step. A shell-only run has no model, so
 *  token and cost fields are not applicable rather than merely unreported. */
export function runHasAgentSteps(steps: MentuStepRun[]): boolean {
  return steps.some((step) => step.backend !== "shell");
}

/** Classifies a total card from its projection and whether the run has any
 *  agent step at all. */
export function usageCardKind(
  projection: UsageFieldProjection,
  hasAgentSteps: boolean,
): UsageCardKind {
  if (!hasAgentSteps) return "not_applicable";
  if (projection.invalidCount > 0) return "failed_to_parse";
  if (projection.total === null) return "not_reported";
  if (usageExact(projection)) return "exact";
  return "partial";
}

export function projectUsageField(
  steps: MentuStepRun[],
  field: UsageTokenField,
): UsageFieldProjection {
  const recordKey = FIELD_RECORD_KEYS[field];
  let total: number | null = null;
  let unknownCount = 0;
  let invalidCount = 0;
  for (const step of steps) {
    const usage = step.usage;
    const value = usage?.[field];
    if (typeof value === "number") {
      total = (total ?? 0) + value;
    } else {
      unknownCount += 1;
    }
    invalidCount +=
      usage?.invalid.filter((issue) => issue.field === recordKey).length ?? 0;
  }
  return { total, unknownCount, invalidCount };
}

export function projectUsage(steps: MentuStepRun[]): UsageProjection {
  return {
    input: projectUsageField(steps, "inputTokens"),
    output: projectUsageField(steps, "outputTokens"),
  };
}

/** Exact only when every entry measured this field and nothing was
 *  rejected; unknown or invalid entries keep the total from being exact. */
export function usageExact(projection: UsageFieldProjection): boolean {
  return (
    projection.total !== null &&
    projection.unknownCount === 0 &&
    projection.invalidCount === 0
  );
}

const numberFormatter = new Intl.NumberFormat("en-US");

/** Fork copy (`MetricsView`'s `tokenLabel`) with the three honest states:
 *  a shell-only run says `not applicable` (no model, no tokens), an agent
 *  run with no measurement says `not reported`, and a recorded-but-rejected
 *  value is always spelled out as `N failed to parse`. Nothing is ever
 *  estimated. */
export function formatUsageTotal(
  label: string,
  projection: UsageFieldProjection,
  applicability: "applicable" | "not_applicable" = "applicable",
): string {
  if (applicability === "not_applicable") {
    return `${label}: not applicable`;
  }
  let text = `${label}: ${
    projection.total === null
      ? "not reported"
      : numberFormatter.format(projection.total)
  }`;
  if (projection.total !== null && projection.unknownCount > 0) {
    text += ` + ${projection.unknownCount} not reported`;
  }
  if (projection.invalidCount > 0) {
    text += ` + ${projection.invalidCount} failed to parse`;
  }
  return text;
}

const REASON_LABELS: Record<MentuUsageInvalidReason, string> = {
  not_a_number: "not a number",
  not_an_integer: "not an integer",
  negative: "negative",
  not_finite: "not finite",
  out_of_range: "out of range",
};

/** One attempt row's value: measured values are exact, a shell step's
 *  fields are not applicable (there is no model), a recorded-but-rejected
 *  value says it failed to parse and why, and an applicable-but-absent
 *  value is honestly not reported. */
export function formatStepUsageValue(
  step: MentuStepRun,
  field: UsageTokenField,
): string {
  if (step.backend === "shell") {
    return "not applicable";
  }
  const value = step.usage?.[field];
  if (typeof value === "number") {
    return `${numberFormatter.format(value)} (exact)`;
  }
  const recordKey = FIELD_RECORD_KEYS[field];
  const issue = step.usage?.invalid.find(
    (candidate) => candidate.field === recordKey,
  );
  return issue
    ? `failed to parse (${REASON_LABELS[issue.reason]})`
    : "not reported";
}
