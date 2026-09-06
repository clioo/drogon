import { useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { DropdownMenu, Popover, Tooltip } from "radix-ui";
import type {
  Harness,
  HarnessLaunchInput,
} from "../../shared/session-contract";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import {
  emptyHarnessLaunchForm,
  normalizeHarnessLaunchInput,
  type HarnessLaunchFormValues,
} from "./harness-launch-form";
import {
  clearPendingHarnessLaunch,
  loadPendingHarnessLaunch,
  savePendingHarnessLaunch,
} from "./harness-launch-recovery";

const unavailableHint: Record<
  Exclude<Harness["availability"], "available">,
  string
> = {
  missing: "not found on this host",
  unsupported_launcher: "unsupported launcher",
};

// Action selection and launch settings use distinct, trigger-anchored surfaces.
export function HarnessLaunchMenu({
  workspaceId,
  hostId,
  harnesses,
  disabled,
  onCreateTerminal,
  onLaunch,
}: {
  workspaceId: string;
  /** The execution host this recovery record is scoped to; `null` while disconnected — recovery is a no-op without it. */
  hostId: string | null;
  harnesses: Harness[];
  disabled: boolean;
  onCreateTerminal(): void;
  onLaunch(input: HarnessLaunchInput): Promise<boolean>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState<Harness | null>(null);
  const [values, setValues] = useState<HarnessLaunchFormValues>(
    emptyHarnessLaunchForm(),
  );
  const [submitting, setSubmitting] = useState(false);
  // Synchronous guard against a rapid double-invoke (e.g. two fast
  // keyboard-driven `onSelect`s) that `submitting` state alone might not
  // catch before its next render commits.
  const inFlight = useRef(false);
  // An unchanged retry must recover the original admission, not spawn twice.
  const lastAttempt = useRef<{ key: string; requestId: string } | null>(null);
  // Bumped after a save/clear to force the memo below to re-read storage.
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  // Derived at render time from the *current* props, not effect-set state —
  // avoids a stale-workspace/host value ever being visible in the gap
  // between a prop change committing and an effect running.
  const recoverable = useMemo(
    () =>
      menuOpen && hostId ? loadPendingHarnessLaunch(hostId, workspaceId) : null,
    [menuOpen, hostId, workspaceId, recoveryVersion],
  );

  const closeForm = () => {
    setSelected(null);
    setValues(emptyHarnessLaunchForm());
    lastAttempt.current = null;
  };

  const launch = async (input: HarnessLaunchInput) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    if (hostId) savePendingHarnessLaunch(hostId, input);
    setSubmitting(true);
    try {
      const launched = await onLaunch(input);
      // Only a *confirmed* launch clears the recovery record — an ambiguous
      // or refused attempt leaves the exact requestId+params recoverable.
      if (launched && hostId) {
        clearPendingHarnessLaunch(hostId, input);
        setRecoveryVersion((v) => v + 1);
      }
      return launched;
    } finally {
      setSubmitting(false);
      inFlight.current = false;
    }
  };

  const submit = async () => {
    // A form's `onSubmit` fires on an Enter-key implicit submission
    // regardless of the (disabled) submit button's own attribute — this
    // must reject that path too, not just the visible button click.
    if (!selected || disabled || !hostId) return;
    const params = normalizeHarnessLaunchInput(
      workspaceId,
      selected.harnessId,
      values,
    );
    const key = JSON.stringify(params);
    const requestId =
      lastAttempt.current?.key === key
        ? lastAttempt.current.requestId
        : crypto.randomUUID();
    lastAttempt.current = { key, requestId };
    const launched = await launch({ ...params, requestId });
    if (launched) closeForm();
  };

  const recover = async () => {
    // Re-validated at invocation, not just trusted from the memo above —
    // a recoverable intent for a workspace/host this menu is no longer
    // showing must never be replayed.
    if (
      !recoverable ||
      disabled ||
      !hostId ||
      recoverable.workspaceId !== workspaceId
    )
      return;
    await launch(recoverable);
  };

  return (
    <Popover.Root
      open={selected !== null}
      onOpenChange={(open) => {
        if (!open) closeForm();
      }}
    >
      <Popover.Anchor>
        <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <DropdownMenu.Trigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="New terminal"
                  disabled={disabled}
                >
                  <Plus />
                </Button>
              </DropdownMenu.Trigger>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className="tooltip" sideOffset={4}>
                New terminal
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="harness-menu"
              align="start"
              sideOffset={4}
              onCloseAutoFocus={(event) => {
                if (selected) event.preventDefault();
              }}
            >
              {recoverable && (
                <>
                  <DropdownMenu.Item
                    className="harness-menu-item"
                    disabled={submitting || disabled}
                    onSelect={() => void recover()}
                  >
                    <span>
                      Retry interrupted{" "}
                      {harnesses.find(
                        (item) => item.harnessId === recoverable.harnessId,
                      )?.displayName ?? recoverable.harnessId}{" "}
                      launch
                    </span>
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="harness-menu-separator" />
                </>
              )}
              <DropdownMenu.Item
                className="harness-menu-item"
                onSelect={onCreateTerminal}
              >
                New terminal
              </DropdownMenu.Item>
              {harnesses.length > 0 && (
                <DropdownMenu.Separator className="harness-menu-separator" />
              )}
              {harnesses.map((harness) => (
                <DropdownMenu.Item
                  key={harness.harnessId}
                  className="harness-menu-item"
                  disabled={harness.availability !== "available"}
                  onSelect={() => setSelected(harness)}
                >
                  <span>{harness.displayName}</span>
                  {harness.availability !== "available" && (
                    <span className="harness-menu-hint">
                      {unavailableHint[harness.availability]}
                    </span>
                  )}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className="harness-launch-form"
          align="start"
          sideOffset={4}
          collisionPadding={8}
        >
          {selected && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <h2>{selected.displayName}</h2>
              <label>
                Model
                <Input
                  autoFocus
                  placeholder="Harness default"
                  value={values.model}
                  disabled={submitting}
                  onChange={(event) =>
                    setValues((v) => ({ ...v, model: event.target.value }))
                  }
                />
              </label>
              <label>
                Initial prompt (optional)
                <Input
                  value={values.prompt}
                  disabled={submitting}
                  onChange={(event) =>
                    setValues((v) => ({ ...v, prompt: event.target.value }))
                  }
                />
              </label>
              <details className="harness-advanced">
                <summary>Advanced</summary>
                {selected.harnessId === "pi" && (
                  <label>
                    Provider
                    <Input
                      value={values.provider}
                      disabled={submitting}
                      onChange={(event) =>
                        setValues((v) => ({
                          ...v,
                          provider: event.target.value,
                        }))
                      }
                    />
                  </label>
                )}
                <label>
                  Effort
                  <Input
                    value={values.effort}
                    disabled={submitting}
                    onChange={(event) =>
                      setValues((v) => ({ ...v, effort: event.target.value }))
                    }
                  />
                </label>
                <label className="harness-checkbox">
                  <input
                    type="checkbox"
                    checked={values.unattended}
                    disabled={submitting}
                    onChange={(event) =>
                      setValues((v) => ({
                        ...v,
                        unattended: event.target.checked,
                      }))
                    }
                  />
                  {selected.harnessId === "pi"
                    ? "Trust project files"
                    : "Skip permission prompts (unattended)"}
                </label>
              </details>
              <div className="form-actions">
                <Button
                  type="submit"
                  size="sm"
                  disabled={submitting || disabled}
                >
                  Launch
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={closeForm}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
