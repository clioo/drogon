// Source provenance: Lovecast Inc. MIT source c97906287bb7a390b25e2025b600d9fb3c25d9c3,
// src/preload/close-active-tab-payload-admission.ts (SHA256 6a604e2b7e089645e1c4db026d79ca30701a8d137ce6b653ac741b601c68749f).

import type { CloseActiveTabPayload } from "../shared/ui-command-event-types";

export type AdmittedCloseActiveTabPayload =
  | { kind: "legacy" }
  | { kind: "source"; payload: CloseActiveTabPayload }
  | { kind: "invalid" };

export function admitCloseActiveTabPayload(
  value: unknown,
): AdmittedCloseActiveTabPayload {
  if (value === undefined) {
    return { kind: "legacy" };
  }
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).sourceId === "string" &&
    (value as Record<string, unknown>).sourceId !== ""
  ) {
    return {
      kind: "source",
      payload: {
        sourceId: (value as Record<string, unknown>).sourceId as string,
      },
    };
  }
  return { kind: "invalid" };
}
