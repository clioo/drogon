/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/tab-bar/tab-bar-surface.tsx (the "+" trigger
   and menu chrome) and tab-bar-static-create-menu.tsx (default-order static
   entries: New Terminal, New Browser Tab). Adapter: no dnd-kit, no
   simulator/recipe/markdown entries (out of MVP scope); the per-harness
   entries open this repo's harness launch form (folded in from
   HarnessLaunchMenu, which this menu replaces), and radix-ui primitives
   stand in for the shadcn menu. */
import { useMemo, useRef, useState } from "react";
import { Globe, Plus, TerminalSquare } from "lucide-react";
import { DropdownMenu, Popover, Tooltip } from "radix-ui";
import type {
  Harness,
  HarnessLaunchInput,
} from "../../../../shared/session-contract";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  emptyHarnessLaunchForm,
  normalizeHarnessLaunchInput,
  type HarnessLaunchFormValues,
} from "../../harness-launch-form";
import {
  isPristineLaunchForm,
  resolveLaunchDefaults,
} from "../settings/agent-defaults";
import type { HarnessAgentDefault } from "../../settings-store";
import {
  clearPendingHarnessLaunch,
  loadPendingHarnessLaunch,
  savePendingHarnessLaunch,
} from "../../harness-launch-recovery";

const unavailableHint: Record<
  Exclude<Harness["availability"], "available">,
  string
> = {
  missing: "not found on this host",
  unsupported_launcher: "unsupported launcher",
};

const STATIC_ITEM_CLASS =
  "tab-create-item gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 font-medium";

/**
 * The tab strip "+" menu: New terminal, one entry per harness (opening the
 * launch form), New browser tab. The trigger keeps the source's accessible
 * name so the palette's "Launch harness…" row can open the real menu.
 */
export function TabCreateMenu({
  workspaceId,
  hostId,
  harnesses,
  disabled,
  defaultHarnessId,
  launchDefaults,
  onOpenMentu,
  mentuAvailable,
  newTerminalShortcut,
  newBrowserShortcut,
  onCreateTerminal,
  onLaunch,
  onNewBrowserTab,
}: {
  workspaceId: string;
  /** The execution host this recovery record is scoped to; `null` while disconnected — recovery is a no-op without it. */
  hostId: string | null;
  harnesses: Harness[];
  disabled: boolean;
  /** Stored default harness (badged in the menu) and per-harness field defaults used to pre-fill a pristine form. Read-only here; edited in Settings. */
  defaultHarnessId?: string;
  launchDefaults?: Record<string, HarnessAgentDefault>;
  /** Display chords for the static rows ("" hides the hint). */
  newTerminalShortcut: string;
  newBrowserShortcut: string;
  onCreateTerminal(): void;
  onLaunch(input: HarnessLaunchInput): Promise<boolean>;
  onNewBrowserTab(): void;
  /** R5-S: opens the wider Mentu tab for the selected workspace. Optional
   *  so existing callers/tests that predate Mentu keep compiling. */
  onOpenMentu?: () => void;
  mentuAvailable?: boolean;
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

  const openFormFor = (harness: Harness) => {
    setSelected(harness);
    // A pristine form inherits the stored per-harness defaults; any
    // user-typed value is never clobbered.
    setValues((prev) => {
      if (
        !isPristineLaunchForm({
          model: prev.model,
          effort: prev.effort,
          unattended: prev.unattended,
        })
      )
        return prev;
      const resolved = resolveLaunchDefaults(
        harness.harnessId,
        launchDefaults ?? {},
      );
      return {
        ...prev,
        model: resolved.model,
        effort: resolved.effort,
        unattended: resolved.unattended,
      };
    });
  };

  return (
    <Popover.Root
      open={selected !== null}
      onOpenChange={(open) => {
        if (!open) closeForm();
      }}
    >
      <Popover.Anchor>
        <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className="ml-2 my-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-35"
                  title="New tab"
                  aria-label="New tab"
                  disabled={disabled}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </DropdownMenu.Trigger>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className="tooltip" sideOffset={4}>
                New tab
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="z-[70] w-72 max-w-[calc(100vw-1rem)] rounded-[11px] border border-border/80 bg-popover p-1 shadow-[0_16px_36px_rgba(0,0,0,0.24)]"
              align="start"
              sideOffset={6}
              onCloseAutoFocus={(event) => {
                // Why: Radix restores focus to the "+" trigger on close, stealing it from a freshly-opened form.
                if (selected) event.preventDefault();
              }}
            >
              {recoverable && (
                <>
                  <DropdownMenu.Item
                    className={STATIC_ITEM_CLASS}
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
                className={STATIC_ITEM_CLASS}
                onSelect={onCreateTerminal}
              >
                <TerminalSquare className="size-4 text-muted-foreground" />
                New Terminal
                {newTerminalShortcut && (
                  <span className="tab-create-shortcut" aria-hidden="true">
                    {newTerminalShortcut}
                  </span>
                )}
              </DropdownMenu.Item>
              {harnesses.map((harness) => (
                <DropdownMenu.Item
                  key={harness.harnessId}
                  className={STATIC_ITEM_CLASS}
                  disabled={harness.availability !== "available"}
                  onSelect={() => openFormFor(harness)}
                >
                  <span>{harness.displayName}</span>
                  {harness.availability !== "available" ? (
                    <span className="tab-create-hint" aria-hidden="true">
                      {unavailableHint[harness.availability]}
                    </span>
                  ) : (
                    defaultHarnessId === harness.harnessId && (
                      <span className="tab-create-hint" aria-hidden="true">Default</span>
                    )
                  )}
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Item
                className={STATIC_ITEM_CLASS}
                onSelect={onNewBrowserTab}
              >
                <Globe className="size-4 text-muted-foreground" />
                New Browser Tab
                {newBrowserShortcut && (
                  <span className="tab-create-shortcut" aria-hidden="true">
                    {newBrowserShortcut}
                  </span>
                )}
              </DropdownMenu.Item>
              {onOpenMentu && mentuAvailable && (
                <>
                  <DropdownMenu.Separator className="harness-menu-separator" />
                  <DropdownMenu.Item
                    className={STATIC_ITEM_CLASS}
                    onSelect={onOpenMentu}
                  >
                    Open Mentu
                  </DropdownMenu.Item>
                </>
              )}
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
