// MIT Copyright (c) 2026 Lovecast Inc. Ported from the Orca reference
// (read-only)
// src/renderer/src/components/terminal-pane/SessionRestoredBanner.tsx.
// Adapted: `translate()` calls are plain English strings (Drogon has no i18n
// catalog) and `@/` imports are relative. Copy, classes and the
// `SessionRestoredBannerReason` vocabulary are unchanged — the reason exists
// because "resume-unavailable" must be said out loud: silence after a
// requested resume would read as a successful restore.
export const SESSION_RESTORED_BANNER_TEXT = "--- session restored ---";
export const SESSION_RESUME_UNAVAILABLE_BANNER_TEXT =
  "--- previous session unavailable, started fresh ---";

export type SessionRestoredBannerReason = "restored" | "resume-unavailable";

type SessionRestoredBannerProps = {
  visible: boolean;
  reason?: SessionRestoredBannerReason;
};

export function SessionRestoredBanner({
  visible,
  reason = "restored",
}: SessionRestoredBannerProps): React.JSX.Element | null {
  if (!visible) {
    return null;
  }

  return (
    <div className="session-restored-banner" data-session-restored-banner={reason}>
      {reason === "resume-unavailable"
        ? SESSION_RESUME_UNAVAILABLE_BANNER_TEXT
        : SESSION_RESTORED_BANNER_TEXT}
    </div>
  );
}
