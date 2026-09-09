// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from components/settings/AgentAwakeSetting.tsx and agent-awake-copy.ts.
import { useEffect, useState } from "react";
import { Label } from "../../components/ui/label";
import { SettingsSegmentedControl } from "./SettingsFormControls";
import type { AwakeMode } from "../../../../shared/usage-contract";
export function AgentAwakeSetting() {
  const [mode, setMode] = useState<AwakeMode>("off");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const response = await window.drogon.usage.snapshot();
        if (cancelled) return;
        if (!response.ok) throw new Error(response.error.message);
        setMode(response.result.awake.mode);
        setReady(response.result.awake.supported);
      } catch {
        if (!cancelled) setError("Could not read the power setting.");
      }
    };
    void read();
    const timer = setInterval(() => void read(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  const description =
    typeof navigator !== "undefined" && navigator.userAgent.includes("Windows")
      ? "Choose On, Agent, or Off. Agent mode stays awake while agents are working; lid-close behavior follows this device's power settings."
      : "Choose On, Agent, or Off. Agent mode stays awake while agents are working. Drogon also asks this device to stay awake when the lid is closed, subject to its power policy.";
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-4 py-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <Label>Keep computer awake</Label>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <SettingsSegmentedControl<AwakeMode>
          value={mode}
          ariaLabel="Keep computer awake"
          size="sm"
          options={[
            { value: "on", label: "On", disabled: !ready },
            { value: "auto", label: "Agent", disabled: !ready },
            { value: "off", label: "Off", disabled: !ready },
          ]}
          onChange={(next) => {
            void window.drogon.usage
              .setAwake(next)
              .then((result) => {
                if (!result.ok) {
                  setError(result.error.message);
                  return;
                }
                setMode(result.result.mode);
                setError(null);
              })
              .catch(() => setError("Could not change the power setting."));
          }}
        />
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
