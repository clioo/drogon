/* MIT Copyright (c) 2026 Lovecast Inc.
   Ported literally from Orca's
   src/renderer/src/components/new-workspace/DrogonQuickSession.tsx.
   The surrounding composer supplies Drogon's daemon-owned scratch-project
   callback; button copy, order, disabled state and accessibility stay exact. */
import React from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "../../components/ui/button";

export type DrogonQuickSessionProps = {
  disabled?: boolean;
  creating?: boolean;
  onCreate: () => void;
};

export function DrogonQuickSession({
  disabled = false,
  creating = false,
  onCreate,
}: DrogonQuickSessionProps): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="text-xs text-muted-foreground"
      onClick={onCreate}
      disabled={disabled || creating}
      title="Start the selected harness in an Orca-owned scratch folder"
      aria-label="Start Quick Session"
      data-secondary-action="quick-session"
    >
      {creating ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
      Quick Session
    </Button>
  );
}

export default DrogonQuickSession;
