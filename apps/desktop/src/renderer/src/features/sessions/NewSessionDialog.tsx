import { useState } from "react";
import type { Harness, HarnessId } from "../../../../shared/session-contract";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import { HarnessMenuIcon } from "../shell/TabCreateMenuIcons";

export function NewSessionDialog({
  harnesses,
  defaultHarnessId,
  onClose,
  onCreate,
}: {
  harnesses: Harness[];
  defaultHarnessId: string | null;
  onClose: () => void;
  onCreate: (name: string, harnessId: HarnessId) => Promise<string | null>;
}) {
  const available = harnesses.filter(
    (item) => item.availability === "available",
  );
  const [picked, setPicked] = useState<HarnessId | null>(null);
  const selected =
    available.find((item) => item.harnessId === picked) ??
    available.find((item) => item.harnessId === defaultHarnessId) ??
    available[0];
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New session</DialogTitle>
          <DialogDescription>
            Start in a private folder managed by Drogon. No project or Git
            worktree needed.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!selected || busy) return;
            setBusy(true);
            setError(null);
            try {
              const failure = await onCreate(
                name.trim() || `${selected.displayName} session`,
                selected.harnessId,
              );
              if (failure) setError(failure);
              else onClose();
            } catch {
              setError(
                "Could not start the session. Check the connection and try again.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="flex flex-col gap-2 text-sm">
            Name (optional)
            <input
              className="rounded-md border border-input bg-background px-3 py-2"
              value={name}
              maxLength={128}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <fieldset disabled={busy} className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Harness</legend>
            {available.map((harness) => (
              <label
                key={harness.harnessId}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <input
                  type="radio"
                  name="harness"
                  value={harness.harnessId}
                  checked={selected?.harnessId === harness.harnessId}
                  onChange={() => setPicked(harness.harnessId)}
                />
                <HarnessMenuIcon
                  harnessId={harness.harnessId}
                  displayName={harness.displayName}
                />
                {harness.displayName}
              </label>
            ))}
            {available.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No enabled harness is available. Install and enable one in
                Settings → Agents.
              </p>
            )}
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !selected}>
              {busy ? "Starting…" : "Start session"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
