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

/** Fork copy (`MetricsView`'s `tokenLabel`): totals say "unavailable" when
 *  nothing was measured, and count unknown entries only alongside a real
 *  total. Invalid values are always spelled out, total or not. */
export function formatUsageTotal(
  label: string,
  projection: UsageFieldProjection,
): string {
  let text = `${label}: ${
    projection.total === null
      ? "unavailable"
      : numberFormatter.format(projection.total)
  }`;
  if (projection.total !== null && projection.unknownCount > 0) {
    text += ` + ${projection.unknownCount} unknown`;
  }
  if (projection.invalidCount > 0) {
    text += ` + ${projection.invalidCount} invalid`;
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

/** One attempt row's value: measured values are exact, rejected values
 *  say why, everything else is honestly unavailable. */
export function formatStepUsageValue(
  step: MentuStepRun,
  field: UsageTokenField,
): string {
  const value = step.usage?.[field];
  if (typeof value === "number") {
    return `${numberFormatter.format(value)} (exact)`;
  }
  const recordKey = FIELD_RECORD_KEYS[field];
  const issue = step.usage?.invalid.find(
    (candidate) => candidate.field === recordKey,
  );
  return issue ? `unavailable (${REASON_LABELS[issue.reason]})` : "unavailable";
}
