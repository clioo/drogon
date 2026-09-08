// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/commit/use-discard-confirmation.ts
// (adapter: literal English copy, no i18n; the "unable to unstage" abort
// variant has no counterpart here — Drogon's discard path unstages nothing,
// so only the aggregated per-file failure toast is ported). Pure,
// unit-tested.
export type DiscardFailureToastCopy = {
  title: string;
  description: string;
};

export function getDiscardFailureToastCopy(
  failed: readonly string[],
  firstMessage?: string,
): DiscardFailureToastCopy {
  // Why: show only the first error + a sample of failed paths to avoid a
  // huge toast body on bulk failures.
  const sample = failed.slice(0, 3).join(", ");
  const more = failed.length > 3 ? `, +${failed.length - 3} more` : "";
  return {
    title: `Failed to discard ${failed.length} file${failed.length === 1 ? "" : "s"}`,
    description: firstMessage
      ? `${firstMessage} (e.g. ${sample}${more})`
      : `${sample}${more}`,
  };
}
