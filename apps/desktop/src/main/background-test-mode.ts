/**
 * Test instances run with DROGON_BACKGROUND_WINDOW=1 (background window,
 * accessory activation policy). Anything that would put a window of ANOTHER
 * app in front of the user — the system browser, Finder, a native file
 * dialog — is suppressed there and logged, so harness runs never take the
 * user's focus. Product behaviour is untouched outside test mode.
 */
export function isBackgroundTestMode(
  env: { DROGON_BACKGROUND_WINDOW?: string } = process.env,
): boolean {
  return env.DROGON_BACKGROUND_WINDOW === "1";
}

/** True when the side effect was suppressed (and logged) for test mode. */
export function suppressForegroundSideEffect(
  operation: string,
  target: string,
  env: { DROGON_BACKGROUND_WINDOW?: string } = process.env,
  log: (line: string) => void = (line) => console.log(line),
): boolean {
  if (!isBackgroundTestMode(env)) return false;
  log(`[background] suppressed ${operation}: ${target}`);
  return true;
}
