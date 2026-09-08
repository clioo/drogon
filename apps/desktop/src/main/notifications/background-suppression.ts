/**
 * Native notification banners are suppressed for test instances launched
 * with DROGON_BACKGROUND_WINDOW=1: they would surface on the user's screen
 * (titled after the dev binary) while the app itself stays out of the way.
 * The needs_input delivery log line is unaffected, so harness checks that
 * read the main log keep working.
 */
export function nativeNotificationsSuppressed(
  env: { DROGON_BACKGROUND_WINDOW?: string },
): boolean {
  return env.DROGON_BACKGROUND_WINDOW === "1";
}
