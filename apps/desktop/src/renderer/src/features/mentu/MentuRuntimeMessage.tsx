// MIT Copyright (c) 2026 Lovecast Inc.
// Ported literally from the read-only reference
// `src/renderer/src/components/mentu/MentuRuntimeMessage.tsx`: the labeled
// runtime status line. Only the import path is adapted (this repo's ui
// primitives live under `components/ui`).

import { Button } from "../../components/ui/button";

// Mirrors the reference's `MentuRuntimeMessageKind` in
// `src/shared/mentu-pane-types.ts` (`'unavailable' | 'invalid' |
// 'conflict' | 'execution-failed'`); kept here because the shared
// extraction only carries `MentuPaneMode`.
export type MentuRuntimeMessageKind =
  | "unavailable"
  | "invalid"
  | "conflict"
  | "execution-failed";

const LABELS: Record<MentuRuntimeMessageKind, string> = {
  unavailable: "Mentu Recipes unavailable:",
  invalid: "Recipe source invalid:",
  conflict: "Recipe changed on disk:",
  "execution-failed": "Recipe execution failed:",
};

export function MentuRuntimeMessage({
  kind,
  message,
  onOpenEvidence,
}: {
  kind: MentuRuntimeMessageKind;
  message: string;
  onOpenEvidence: () => void;
}): React.JSX.Element {
  return (
    <div className="min-w-0 break-words">
      <span className="font-medium text-foreground">{LABELS[kind]}</span> {message}
      {kind === "execution-failed" ? (
        <div className="mt-2">
          <Button size="xs" variant="outline" onClick={onOpenEvidence}>
            View evidence
          </Button>
        </div>
      ) : null}
    </div>
  );
}
