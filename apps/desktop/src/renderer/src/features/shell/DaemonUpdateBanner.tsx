// MIT Copyright (c) 2026 Lovecast Inc.
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { DaemonUpdateState } from "../../../../shared/daemon-contract";

export function DaemonUpdateBanner({
  state,
  onRestarted,
}: {
  state: DaemonUpdateState;
  onRestarted: () => void;
}): null {
  const onRestartedRef = useRef(onRestarted);
  onRestartedRef.current = onRestarted;
  const revision = state.revision;
  const kind = state.kind;
  useEffect(() => {
    const id = `daemon-update-${revision ?? "unknown"}-${kind}`;
    let restarting = false;
    const restart = async (): Promise<void> => {
      if (restarting) return;
      restarting = true;
      try {
        const result = await window.drogon.daemon.restart();
        if (result.restarted) {
          onRestartedRef.current();
          return;
        }
        toast.error("Service restart pending", {
          description:
            result.reason ?? "The service could not be restarted from here.",
          closeButton: true,
        });
      } catch {
        toast.error("The service could not be restarted from here.", {
          closeButton: true,
        });
      } finally {
        restarting = false;
      }
    };
    toast.info(
      kind === "updated" ? "Drogon updated" : "Service update pending",
      {
        id,
        description:
          kind === "updated"
            ? "The background service now matches this install."
            : "You can keep working. Restart the service when you’re ready; active sessions will stop.",
        duration: kind === "updated" ? 6000 : Infinity,
        closeButton: true,
        dismissible: true,
        action:
          kind === "pending"
            ? { label: "Restart service", onClick: () => void restart() }
            : undefined,
      },
    );
    return () => {
      toast.dismiss(id);
    };
  }, [kind, revision]);
  return null;
}
