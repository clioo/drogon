// Maps Chromium load failures to honest pane-facing messages.

/** Net-error codes that mean "unreachable", kept as a readable subset. */
const UNREACHABLE_CODES = new Set([
  -2, // FAILED (generic)
  -6, // FILE_NOT_FOUND
  -7, // TIMED_OUT
  -105, // NAME_NOT_RESOLVED
  -106, // INTERNET_DISCONNECTED
  -109, // ADDRESS_UNREACHABLE
  -118, // CONNECTION_TIMED_OUT
  -102, // CONNECTION_REFUSED
  -104, // CONNECTION_RESET
]);

/**
 * Turns a `did-fail-load` (errorCode, errorDescription, validatedURL) into
 * the message the pane shows. Aborts (-3) are caller-initiated stops, not
 * failures, so they map to null (no error state).
 */
export function mapGuestLoadError(input: {
  errorCode: number;
  errorDescription: string;
  validatedURL: string;
}): string | null {
  if (input.errorCode === -3) return null;
  if (input.errorCode === -20) return "Blocked: the page was blocked from loading.";
  if (UNREACHABLE_CODES.has(input.errorCode))
    return `Could not reach ${input.validatedURL || "the page"} (${input.errorDescription || `error ${input.errorCode}`}).`;
  if (input.errorCode === -501)
    return "Blocked: insecure content cannot load here.";
  return `The page failed to load (${input.errorDescription || `error ${input.errorCode}`}).`;
}
