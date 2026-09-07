/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/bots/BotsPageForms.tsx (`ResponsibilityFormCard`).
   Adapters for this repo: the source's Card primitives do not exist here
   (components/ui has button/input only), so the card renders as a bordered
   section with admitted tokens; the trigger-type/reactive branch (event key,
   project id, RRULE/dtstart schedule builder) is omitted -- this repo's
   `bot.responsibility_create` creates scheduled (cron) responsibilities
   only, and the cron field reuses the exact helper the Automations page
   uses (`previewCronFires`) so the form can never promise a schedule the
   daemon would not fire. `BotFormCard` stays owned by BotCreationForm. */

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { previewCronFires } from "../automations/automation-cron-preview";
import type { ResponsibilityFormValues } from "./bots-page-model";
import { isResponsibilityFormReady } from "./bots-page-model";

function formatFireTime(fireMs: number): string {
  return new Date(fireMs).toISOString().replace(".000Z", "Z");
}

export function ResponsibilityFormCard({
  form,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  form: ResponsibilityFormValues;
  busy: boolean;
  onChange: (updates: Partial<ResponsibilityFormValues>) => void;
  onCancel: () => void;
  onSubmit: () => void;
}): React.JSX.Element {
  const preview = previewCronFires(form.cron, Date.now());
  const ready = isResponsibilityFormReady(form);
  return (
    <section
      aria-label="Add responsibility"
      data-testid="responsibility-form"
      className="mt-4 rounded-md border border-border bg-background p-4"
    >
      <h3 className="text-sm font-medium">Add responsibility</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Scheduled work is persisted as a Bot-owned automation and uses the
        existing scheduler.
      </p>
      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <Input
            value={form.name}
            maxLength={128}
            placeholder="Review incoming work"
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Cron expression (UTC)
          <Input
            value={form.cron}
            className="font-mono"
            placeholder="* * * * *"
            onChange={(event) => onChange({ cron: event.target.value })}
          />
          <span className="text-muted-foreground">
            Standard 5-field cron in UTC: minute hour day month weekday.
            Every minute is <span className="font-mono">* * * * *</span>.
          </span>
        </label>
        <div className="text-sm" data-testid="responsibility-cron-preview">
          {preview === null ? (
            <span className="text-muted-foreground">
              Next runs: preview unavailable for this expression.
            </span>
          ) : (
            <span>
              Next runs:{" "}
              {preview.map((fire) => formatFireTime(fire)).join(" · ")}
            </span>
          )}
        </div>
        <label className="flex flex-col gap-1 text-sm">
          Prompt
          <textarea
            className="rounded-md border border-input bg-background px-2 py-1"
            rows={4}
            value={form.prompt}
            placeholder="Describe the work to perform."
            onChange={(event) => onChange({ prompt: event.target.value })}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={busy || !ready}>
            {busy ? "Saving…" : "Save responsibility"}
          </Button>
        </div>
      </div>
    </section>
  );
}

export default ResponsibilityFormCard;
