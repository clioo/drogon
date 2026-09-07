/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/bots/BotCreationForm.tsx (adapter: harness
   picker restricted to the 4 real HarnessId values this repo's
   harness.start admits instead of the source's detected-agent list; no
   separate model field is enabled for a non-Pi harness (source behavior,
   unchanged); no responsibilities section (native creates a Bot with zero
   responsibilities by invariant -- added separately, out of this task's
   scope). Copy, layout and field order are ported as-is. */

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { BotCharacterPicker } from "./BotCharacterPicker";
import { botDisplayName } from "./bot-characters";
import {
  BOT_HARNESS_IDS,
  botHarnessLabel,
  isBotCreateFormReady,
} from "./bots-page-model";
import type { BotCreateFormValues } from "./bots-page-model";

export function BotCreationForm({
  form,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  form: BotCreateFormValues;
  busy: boolean;
  onChange: (updates: Partial<BotCreateFormValues>) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const ready = isBotCreateFormReady(form);
  return (
    <form
      aria-label="Create a Bot"
      className="mx-auto w-full max-w-xl space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && ready) onSubmit();
      }}
    >
      <div>
        <h2 className="text-base font-semibold">Create a Bot</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a character and give it a purpose.
        </p>
      </div>
      <fieldset className="space-y-5">
        <BotCharacterPicker
          value={form.preset}
          onChange={(preset) => onChange({ preset })}
        />
        <label className="block space-y-1.5 text-xs font-medium">
          Name{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
          <Input
            aria-label="Name (optional)"
            maxLength={160}
            placeholder={botDisplayName("", form.preset)}
            value={form.displayName}
            onChange={(event) => onChange({ displayName: event.target.value })}
          />
        </label>
        <label className="block space-y-1.5 text-xs font-medium">
          Purpose
          <textarea
            className="scrollbar-sleek min-h-16 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none placeholder:text-muted-foreground/60 md:text-sm"
            rows={3}
            placeholder="What should this Bot help you with?"
            value={form.instructions}
            onChange={(event) => onChange({ instructions: event.target.value })}
          />
        </label>
        <details className="group border-t border-border pt-3">
          <summary className="cursor-pointer rounded-sm text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">
            {`Advanced · ${botHarnessLabel(form.harnessId)}`}
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs font-medium">
              Agent
              <select
                aria-label="Agent"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                value={form.harnessId}
                onChange={(event) =>
                  onChange({
                    harnessId: event.target
                      .value as BotCreateFormValues["harnessId"],
                  })
                }
              >
                {BOT_HARNESS_IDS.map((harnessId) => (
                  <option key={harnessId} value={harnessId}>
                    {botHarnessLabel(harnessId)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-xs font-medium">
              Model
              <Input
                aria-label="Model"
                disabled={form.harnessId !== "pi"}
                placeholder="Agent default"
                value={form.model}
                onChange={(event) => onChange({ model: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium">
              Handle
              <Input
                placeholder="Optional"
                value={form.handle}
                onChange={(event) => onChange({ handle: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium">
              Title
              <Input
                placeholder="Optional"
                value={form.title}
                onChange={(event) => onChange({ title: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium sm:col-span-2">
              Memories
              <textarea
                className="scrollbar-sleek min-h-16 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none placeholder:text-muted-foreground/60 md:text-sm"
                placeholder="One fact per line"
                value={form.memories}
                onChange={(event) => onChange({ memories: event.target.value })}
              />
            </label>
          </div>
        </details>
      </fieldset>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !ready}>
          {busy ? "Creating…" : "Create Bot"}
        </Button>
      </div>
    </form>
  );
}

export default BotCreationForm;
