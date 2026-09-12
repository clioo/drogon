// MIT Copyright (c) 2026 Lovecast Inc.
// Install-resilience P5/P4: the honest update card. A detached daemon
// survives app-bundle replaces, so launch compares the installed bundle's
// `drogond` against the running service and either restarts it (never
// silently — this card says what happened and why) or, when the daemon
// cannot quiesce (live sessions, a run in flight), stays attached to the
// old service and says exactly that, with the restart action the user
// chooses. Card structure, tokens and role wiring follow the ported
// DaemonConnectionBanner (same slot, same card anatomy).
import { useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import type { DaemonUpdateState } from "../../../../shared/daemon-contract";

export function DaemonUpdateBanner({
  state,
  onRestarted,
}: {
  state: DaemonUpdateState;
  /** Reconnect hook after a user-chosen restart (App `refresh`). */
  onRestarted: () => void;
}): React.JSX.Element {
  const [restarting, setRestarting] = useState(false);
  const [restartFailure, setRestartFailure] = useState<string | null>(null);
  const restart = async (): Promise<void> => {
    setRestarting(true);
    setRestartFailure(null);
    try {
      const result = await window.drogon.daemon.restart();
      if (result.restarted) {
        onRestarted();
        return;
      }
      setRestartFailure(
        result.reason ?? "The service could not be restarted from here.",
      );
    } catch {
      setRestartFailure("The service could not be restarted from here.");
    } finally {
      setRestarting(false);
    }
  };

  const updated = state.kind === "updated";
  return (
    <div
      className="daemon-update-banner"
      data-daemon-update-banner={state.kind}
    >
      <div
        className="pointer-events-auto flex w-full items-center gap-3 rounded-md border border-border bg-card/95 px-3 py-3 text-card-foreground shadow-xs backdrop-blur-[1px]"
        role="status"
        aria-live="polite"
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
          {updated ? (
            <RefreshCw className="size-4" aria-hidden />
          ) : (
            <AlertTriangle className="size-4" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {updated
              ? state.note
              : `Drogon updated${
                  state.revision ? ` to ${state.revision}` : ""
                } — update pending`}
          </div>
          <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {updated
              ? "The background service now matches this install."
              : `${state.reason} Close any open dialog, stop sessions, then use Restart service.`}
            {restartFailure ? ` ${restartFailure}` : ""}
          </div>
        </div>
        {!updated ? (
          <Button size="sm" disabled={restarting} onClick={() => void restart()}>
            Restart service
          </Button>
        ) : null}
      </div>
    </div>
  );
}
