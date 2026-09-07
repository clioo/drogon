// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/settings/SettingsFormControls.tsx
//     (SettingsRow two-column grammar, switch row, radiogroup segmented
//      control with aria-disabled-not-disabled, subsection header)
// Adapted: no Radix Switch/Label/Tooltip and no cn() helper — the switch is
// a native checkbox with role="switch" (same keyboard contract), classes
// are plain strings.
import type { ReactNode } from "react";

export function SettingsSwitch({
  checked,
  onChange,
  ariaLabel,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel?: string;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <input
      type="checkbox"
      role="switch"
      className="settings-switch"
      checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

export function SettingsRow({
  label,
  description,
  control,
  labelId,
  alignTop,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  /** Optional id applied to the label so the control can reference it. */
  labelId?: string;
  /** When true, top-align label/description and control (tall controls). */
  alignTop?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={[
        "flex gap-4",
        description ? "py-3" : "py-2",
        alignTop ? "items-start" : "items-center justify-between",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className={
          description ? "min-w-0 flex-1 space-y-1" : "min-w-0 flex-1 space-y-0.5"
        }
      >
        <span id={labelId} className="select-text text-sm font-medium">
          {label}
        </span>
        {description ? (
          <p className="select-text text-xs text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export function SettingsSwitchRow({
  label,
  description,
  checked,
  onChange,
  className,
  ariaLabel,
  disabled,
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <SettingsRow
      label={label}
      description={description}
      className={className}
      control={
        <SettingsSwitch
          checked={checked}
          onChange={() => onChange(!checked)}
          disabled={disabled}
          ariaLabel={ariaLabel ?? (typeof label === "string" ? label : undefined)}
        />
      }
    />
  );
}

export type SettingsSegmentedOption<T extends string | number> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
};

/** Canonical segmented control for theme and other small option sets. */
export function SettingsSegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly SettingsSegmentedOption<T>[];
  ariaLabel?: string;
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center rounded-md border border-border bg-background/50 p-0.5"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.ariaLabel}
            // Why aria-disabled, not disabled: a native disabled button
            // leaves the tab order, so keyboard users can never focus it.
            // The click guard below keeps it inert.
            aria-disabled={opt.disabled}
            onClick={() => {
              if (!opt.disabled) onChange(opt.value);
            }}
            className={
              active
                ? "rounded-sm bg-accent px-3 py-1 text-center text-sm font-medium text-accent-foreground outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50"
                : opt.disabled
                  ? "cursor-not-allowed rounded-sm px-3 py-1 text-center text-sm text-muted-foreground/50 outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  : "rounded-sm px-3 py-1 text-center text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Consistent subsection header: h3 text-sm font-semibold + muted description. */
export function SettingsSubsectionHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={["flex items-start justify-between gap-3", className]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function SettingsFieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="settings-field-error">
      {message}
    </p>
  );
}
