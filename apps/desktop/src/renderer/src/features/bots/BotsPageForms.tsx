/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/bots/BotsPageForms.tsx (`ResponsibilityFormCard`)
   onto the Card primitives the fork uses.
   Adapters for this repo: the source's trigger-type/reactive branch (event
   key, project id, RRULE/dtstart schedule builder) is omitted — this repo's
   `bot.responsibility_create` creates scheduled (cron) responsibilities
   only, and the cron field reuses the exact helper the Automations page
   uses (`previewCronFires`) so the form can never promise a schedule the
   daemon would not fire. The `data-testid` and `aria-label` hooks stay:
   the packaged probe and the contract tests address the form through them.
   `BotFormCard` stays owned by BotCreationForm. */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
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
    <Card
      className="mt-4"
      aria-label="Add responsibility"
      data-testid="responsibility-form"
    >
      <CardHeader className="border-b">
        <CardTitle className="text-sm">Add responsibility</CardTitle>
        <CardDescription>
          Scheduled work is persisted as a Bot-owned automation and uses the
          existing scheduler.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
        <label className="space-y-1.5 text-xs font-medium">
          Name
          <Input
            value={form.name}
            maxLength={128}
            placeholder="Review incoming work"
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </label>
        <label className="space-y-1.5 text-xs font-medium">
          Cron expression (UTC)
          <Input
            value={form.cron}
            className="font-mono"
            placeholder="* * * * *"
            onChange={(event) => onChange({ cron: event.target.value })}
          />
          <span className="block font-normal text-muted-foreground">
            Standard 5-field cron in UTC: minute hour day month weekday.
            Every minute is <span className="font-mono">* * * * *</span>.
          </span>
        </label>
        <div
          className="text-xs text-muted-foreground sm:col-span-2"
          data-testid="responsibility-cron-preview"
        >
          {preview === null ? (
            <span>Next runs: preview unavailable for this expression.</span>
          ) : (
            <span>
              Next runs:{" "}
              {preview.map((fire) => formatFireTime(fire)).join(" · ")}
            </span>
          )}
        </div>
        <label className="space-y-1.5 text-xs font-medium sm:col-span-2">
          Prompt
          <Textarea
            value={form.prompt}
            rows={4}
            placeholder="Describe the work to perform."
            onChange={(event) => onChange({ prompt: event.target.value })}
          />
        </label>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={busy || !ready}>
            {busy ? "Saving…" : "Save responsibility"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default ResponsibilityFormCard;
