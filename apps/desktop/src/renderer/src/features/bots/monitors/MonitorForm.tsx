/* C10 bots monitors: create/edit/enable/run-check controls.
 * Original to this repo. A visible editor surface for the bounded
 * local-file digest monitor; evaluation itself stays in the daemon. */

import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
  MAX_MONITOR_FILE_BYTES,
  isMonitorFormReady,
} from "./monitor-model";
import type { MonitorFormValues } from "./monitor-model";

export function MonitorForm({
  form,
  busy,
  scopeLabel,
  submitLabel = "Save monitor",
  onChange,
  onCancel,
  onSubmit,
}: {
  form: MonitorFormValues;
  busy: boolean;
  scopeLabel: string;
  submitLabel?: string;
  onChange: (updates: Partial<MonitorFormValues>) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const ready = isMonitorFormReady(form);
  return (
    <form
      aria-label="Monitor editor"
      className="w-full space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && ready) onSubmit();
      }}
    >
      <div>
        <h3 className="text-sm font-semibold">File monitor</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Watch one project file for content changes. {scopeLabel}
        </p>
      </div>
      <fieldset disabled={busy} className="space-y-4">
        <label className="block space-y-1.5 text-xs font-medium">
          Name
          <Input
            aria-label="Monitor name"
            value={form.name}
            maxLength={160}
            onChange={(event) => onChange({ name: event.target.value })}
            placeholder="Status notes watcher"
          />
        </label>
        <label className="block space-y-1.5 text-xs font-medium">
          Project file
          <Input
            aria-label="Project file"
            value={form.resource}
            onChange={(event) => onChange({ resource: event.target.value })}
            placeholder="notes/status.md"
          />
          <span className="block font-normal text-muted-foreground">
            Project-relative path. Absolute paths and “..” are refused.
          </span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-xs font-medium">
            Size bound (bytes)
            <Input
              aria-label="Size bound in bytes"
              value={String(form.maxBytes)}
              inputMode="numeric"
              onChange={(event) => {
                const next = Number(event.target.value);
                onChange({ maxBytes: Number.isFinite(next) ? Math.floor(next) : form.maxBytes });
              }}
            />
            <span className="block font-normal text-muted-foreground">
              1–{MAX_MONITOR_FILE_BYTES}. Larger files report an error.
            </span>
          </label>
          <div className="space-y-1.5 text-xs font-medium">
            <span>Trigger</span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={form.trigger.kind === "manual" ? "default" : "outline"}
                size="sm"
                aria-pressed={form.trigger.kind === "manual"}
                onClick={() => onChange({ trigger: { kind: "manual" } })}
              >
                Manual
              </Button>
              <Button
                type="button"
                variant={form.trigger.kind === "scheduled" ? "default" : "outline"}
                size="sm"
                aria-pressed={form.trigger.kind === "scheduled"}
                onClick={() => onChange({ trigger: { kind: "scheduled", cron: "* * * * *" } })}
              >
                Scheduled
              </Button>
            </div>
            {form.trigger.kind === "scheduled" ? (
              <Input
                aria-label="Cron expression"
                value={form.trigger.cron}
                onChange={(event) =>
                  onChange({ trigger: { kind: "scheduled", cron: event.target.value } })
                }
                placeholder="* * * * *"
              />
            ) : null}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            aria-label="Monitor enabled"
            checked={form.enabled}
            onChange={(event) => onChange({ enabled: event.target.checked })}
          />
          Enabled
        </label>
      </fieldset>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !ready}>
          {busy ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

export default MonitorForm;
