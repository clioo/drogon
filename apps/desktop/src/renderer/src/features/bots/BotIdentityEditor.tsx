/* C04 additive editor: identity/instructions editing for an existing Bot
 * over the fields the record already carries (displayIdentity +
 * instructions -- meanings unchanged). Presentational + local draft
 * state, this repo's Bots data-layer convention: the save is emitted as
 * an explicit expected-version request through the caller's bridge-backed
 * callback, and the excluded BotsPanel/controller mount wires it to the
 * reviewed `bot.update` bridge method (checkpoint msg_068595e02641).
 * Normalization (trim, `@` strip, empty dropped) stays native-side, in
 * `crates/drogon-core/src/bots/identity.rs`. */

import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { mintMemoryRequestId } from "./bot-memory-draft";
import type { VersionConflict } from "./bot-memory-draft";

export type BotIdentitySaveRequest = {
  requestId: string;
  botId: string;
  expectedIdentityVersion: number;
  provenance: { origin: "user"; requestId: string };
  displayIdentity: {
    displayName: string;
    handle: string | null;
    title: string | null;
  };
  instructions: string;
};

export type BotIdentityEditorProps = {
  botId: string;
  /** The identity version this form read; the save carries it as
   *  `expectedIdentityVersion` so a concurrent edit conflicts instead of
   *  silently overwriting. */
  identityVersion: number;
  identity: {
    displayName: string;
    handle: string | null;
    title: string | null;
    instructions: string;
  };
  busy: boolean;
  error: string | null;
  conflict: VersionConflict | null;
  onSave: (request: BotIdentitySaveRequest) => void | Promise<void>;
  onCancel: () => void;
};

export function BotIdentityEditor({
  botId,
  identityVersion,
  identity,
  busy,
  error,
  conflict,
  onSave,
  onCancel,
}: BotIdentityEditorProps) {
  const [displayName, setDisplayName] = useState(identity.displayName);
  const [handle, setHandle] = useState(identity.handle ?? "");
  const [title, setTitle] = useState(identity.title ?? "");
  const [instructions, setInstructions] = useState(identity.instructions);

  const nameMissing = !displayName.trim();
  const unchanged =
    displayName === identity.displayName &&
    handle === (identity.handle ?? "") &&
    title === (identity.title ?? "") &&
    instructions === identity.instructions;

  const submit = () => {
    if (busy || nameMissing) {
      return;
    }
    const requestId = mintMemoryRequestId("bot-identity");
    void Promise.resolve(
      onSave({
        requestId,
        botId,
        expectedIdentityVersion: identityVersion,
        provenance: { origin: "user", requestId },
        displayIdentity: {
          displayName,
          handle: handle.trim() ? handle : null,
          title: title.trim() ? title : null,
        },
        instructions,
      }),
    );
  };

  return (
    <form
      data-testid="bot-identity-editor"
      aria-label="Edit Bot identity"
      className="mx-auto w-full max-w-xl space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div>
        <h2 className="text-base font-semibold">Edit identity</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Changes apply to the Bot&apos;s next turn; running turns keep the
          identity they started with.
        </p>
      </div>
      {conflict ? (
        <div
          role="alert"
          data-testid="bot-identity-conflict"
          className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-foreground"
        >
          This identity changed elsewhere: you expected version{" "}
          {conflict.expectedVersion}, but it is now version{" "}
          {conflict.currentVersion}. Refresh and retry to keep the other change.
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          data-testid="bot-identity-error"
          className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}
      <fieldset disabled={busy} className="space-y-5">
        <label className="block space-y-1.5 text-xs font-medium">
          Name
          <Input
            aria-label="Name"
            data-testid="bot-identity-name"
            value={displayName}
            maxLength={160}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-xs font-medium">
            Handle
            <Input
              aria-label="Handle"
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className="space-y-1.5 text-xs font-medium">
            Title
            <Input
              aria-label="Title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Optional"
            />
          </label>
        </div>
        <label className="block space-y-1.5 text-xs font-medium">
          Purpose
          <Textarea
            aria-label="Purpose"
            value={instructions}
            rows={3}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="What should this Bot help you with?"
          />
        </label>
      </fieldset>
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
          data-testid="bot-identity-save"
          disabled={busy || nameMissing || unchanged}
        >
          {busy ? "Saving…" : "Save identity"}
        </Button>
      </div>
    </form>
  );
}

export default BotIdentityEditor;
