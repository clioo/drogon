/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/bots/BotCreationForm.tsx (`BotFormCard`).
   Adapters for this repo: the source's detected-agent list
   (`harnesses: readonly TuiAgent[]`, discovered via preflight at load) is
   the five real harness ids this repo's harness.start admits
   (`BOT_HARNESS_IDS` — the daemon has no agent-detection RPC, so the list
   is static and the empty-harness branch below is unreachable in
   production but kept verbatim for the validation copy); `getAgentLabel`
   is the local botHarnessLabel; responsibilities are never part of the
   create payload (native creates a Bot with zero responsibilities by
   invariant). Copy, layout, field order, validation gating and the
   fieldset-busy rule are the source's verbatim. */

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { BotCharacterPicker } from "./BotCharacterPicker";
import { botDisplayName } from "./bot-characters";
import {
  BOT_HARNESS_IDS,
  applyBotCharacterPreset,
  botHarnessLabel,
} from "./bots-page-model";
import type {
  BotCreateFormValues,
  BotHarnessId,
} from "./bots-page-model";

export function BotCreationForm({
  form,
  harnesses = BOT_HARNESS_IDS,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  form: BotCreateFormValues;
  harnesses?: readonly BotHarnessId[];
  busy: boolean;
  onChange: (updates: Partial<BotCreateFormValues>) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const name = botDisplayName(form.displayName, form.preset);
  return (
    <form
      aria-label="Create a Bot"
      className="mx-auto w-full max-w-xl space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && name && harnesses.length) {
          onSubmit();
        }
      }}
    >
      <div>
        <h2 className="text-base font-semibold">Create a Bot</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a character and give it a purpose.
        </p>
      </div>
      <fieldset disabled={busy} className="space-y-5">
        <BotCharacterPicker
          value={form.preset}
          onChange={(preset) => onChange(applyBotCharacterPreset(form, preset))}
        />
        <label className="block space-y-1.5 text-xs font-medium">
          Name <span className="font-normal text-muted-foreground">(optional)</span>
          <Input
            aria-label="Name (optional)"
            value={form.displayName}
            maxLength={160}
            onChange={(event) => onChange({ displayName: event.target.value })}
            placeholder={botDisplayName("", form.preset)}
          />
        </label>
        <label className="block space-y-1.5 text-xs font-medium">
          Purpose
          <Textarea
            value={form.instructions}
            rows={3}
            onChange={(event) => onChange({ instructions: event.target.value })}
            placeholder="What should this Bot help you with?"
          />
        </label>
        <details className="group border-t border-border pt-3">
          <summary className="cursor-pointer rounded-sm text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">
            Advanced · {botHarnessLabel(form.harnessId)}
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs font-medium">
              Agent
              <select
                aria-label="Agent"
                value={form.harnessId}
                disabled={!harnesses.length}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                onChange={(event) =>
                  onChange({
                    harnessId: event.target.value as BotHarnessId,
                    model: "",
                  })
                }
              >
                {harnesses.length ? (
                  harnesses.map((harness) => (
                    <option key={harness} value={harness}>
                      {botHarnessLabel(harness)}
                    </option>
                  ))
                ) : (
                  <option value={form.harnessId}>No agent detected</option>
                )}
              </select>
            </label>
            <label className="space-y-1.5 text-xs font-medium">
              Model
              <Input
                aria-label="Model"
                value={form.model}
                disabled={form.harnessId !== "pi"}
                onChange={(event) => onChange({ model: event.target.value })}
                placeholder={
                  form.harnessId === "pi" ? "provider/model-id" : "Agent default"
                }
              />
              {form.harnessId === "pi" ? (
                <span className="block font-normal text-muted-foreground">
                  Use an exact Pi provider/model ID. Blank uses Pi settings.
                </span>
              ) : null}
            </label>
            <label className="space-y-1.5 text-xs font-medium">
              Handle
              <Input
                value={form.handle}
                onChange={(event) => onChange({ handle: event.target.value })}
                placeholder="Optional"
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium">
              Title
              <Input
                value={form.title}
                onChange={(event) => onChange({ title: event.target.value })}
                placeholder="Optional"
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium sm:col-span-2">
              Memories
              <Textarea
                value={form.memories}
                onChange={(event) => onChange({ memories: event.target.value })}
                placeholder="One fact per line"
              />
            </label>
          </div>
        </details>
      </fieldset>
      {!harnesses.length ? (
        <p role="status" className="text-sm text-muted-foreground">
          Install or refresh a supported agent before creating a Bot.
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={busy || !name || !harnesses.includes(form.harnessId)}
        >
          {busy ? "Creating…" : "Create Bot"}
        </Button>
      </div>
    </form>
  );
}

export default BotCreationForm;
