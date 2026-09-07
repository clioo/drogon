// Settings used to open as a native modal dialog; it is now a full page
// (features/settings/SettingsPage, route "settings"). This module stays as
// the redirect so any lingering caller lands on the page route instead of
// a dead dialog.
import { useEffect } from "react";
import type { SettingsSectionId } from "./features/settings/settings-sections";

/** Pure redirect step (tested without a DOM); the component runs it once. */
export function redirectSettingsToPage({
  onOpenPage,
  onClose,
  initialSection,
}: {
  onOpenPage: (initialSection?: SettingsSectionId) => void;
  onClose: () => void;
  initialSection?: SettingsSectionId;
}): void {
  onOpenPage(initialSection);
  onClose();
}

export function SettingsPanel({
  onOpenPage,
  onClose,
  initialSection,
}: {
  /** Navigate to the settings page (App stores the return route). */
  onOpenPage: (initialSection?: SettingsSectionId) => void;
  /** Dismiss the caller after the redirect (same contract as the old dialog). */
  onClose: () => void;
  initialSection?: SettingsSectionId;
}): null {
  useEffect(() => {
    redirectSettingsToPage({ onOpenPage, onClose, initialSection });
    // Runs once per mount: the redirect fires exactly once, then the
    // caller unmounts this component via onClose.
  }, []);
  return null;
}
