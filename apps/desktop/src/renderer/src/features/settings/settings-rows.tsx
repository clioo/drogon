// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/settings/SettingsFormControls.tsx
//     (SettingsRow two-column grammar, switch-row control placement)
//   src/renderer/src/components/settings/SettingsSection.tsx
//     (section header + card-body containment)
// Adapted: no zustand store, no Tailwind cn() helper, no Radix Switch —
// plain monochrome primitives styled by the settings-surface CSS section in
// assets/main.css; every control is a controlled prop pair.
import type { ReactNode } from "react";

export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section id={id} aria-label={title} className="settings-section">
      <div className="settings-section-head">
        <h2 className="settings-section-title">{title}</h2>
        <p className="settings-section-description">{description}</p>
      </div>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  control,
  labelId,
}: {
  label: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  labelId?: string;
}): React.JSX.Element {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <span id={labelId} className="settings-row-label-text">
          {label}
        </span>
        {description ? (
          <span className="settings-row-description">{description}</span>
        ) : null}
      </div>
      <div className="settings-row-control">{control}</div>
    </div>
  );
}

export function SettingsSwitchRow({
  label,
  description,
  checked,
  onChange,
  ariaLabel,
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
}): React.JSX.Element {
  return (
    <SettingsRow
      label={label}
      description={description}
      control={
        <input
          type="checkbox"
          role="switch"
          className="settings-switch"
          aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
      }
    />
  );
}

export function SettingsSegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (next: T) => void;
  options: readonly { value: T; label: string }[];
  ariaLabel?: string;
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="settings-segmented"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={
            option.value === value
              ? "settings-segmented-option settings-segmented-option-active"
              : "settings-segmented-option"
          }
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
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
