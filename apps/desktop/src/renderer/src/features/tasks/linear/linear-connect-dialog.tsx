/* MIT Copyright (c) 2026 Lovecast Inc.
   Linear connect dialog (fixture loopback): stores the API key locally and
   seeds the fixture collection. No endpoint is ever contacted — the note
   under the field says so. */
import { useId, useLayoutEffect, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { connectLinear } from "./linear-connection";

export function TaskPageLinearConnectDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: () => void;
}): React.JSX.Element {
  const keyId = useId();
  const errorId = useId();
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    setApiKey("");
    setError(null);
  }, [open ]);

  const submit = () => {
    const connected = connectLinear(apiKey);
    if (!connected) {
      setError("Enter an API key to connect.");
      return;
    }
    onOpenChange(false);
    onConnected?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={error ? errorId : undefined}>
        <DialogHeader>
          <DialogTitle>Connect Linear</DialogTitle>
          <DialogDescription>
            Paste a personal API key. It stays on this machine and is only
            used to label the local fixture workspace — nothing is sent to
            Linear.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor={keyId}>API key</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={keyId}
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
              placeholder="lin_api_…"
              className="pl-8"
            />
          </div>
          {error ? (
            <p id={errorId} role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={apiKey.trim() === ""}>
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
