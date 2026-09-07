// Pure URL normalization for the embedded browser pane.

import { MAX_BROWSER_URL_CHARS } from "../../shared/browser-contract";

export type NormalizedUrl =
  | { kind: "load"; url: string }
  | { kind: "blocked"; reason: string };

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Normalizes renderer-supplied address-bar input into a loadable URL.
 * Bare hosts gain `https://`; only http(s) loads — anything else (file:,
 * javascript:, data:, custom protocols, schemeless garbage) is blocked
 * with an honest reason, never passed to the guest.
 */
export function normalizeBrowserUrl(raw: string): NormalizedUrl {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "blocked", reason: "Enter a URL." };
  if (trimmed.length > MAX_BROWSER_URL_CHARS)
    return { kind: "blocked", reason: "URL is too long." };
  if (/^javascript:/i.test(trimmed))
    return { kind: "blocked", reason: "Blocked: script URLs cannot load." };
  const candidate =
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("about:blank")
      ? trimmed
      : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { kind: "blocked", reason: "URL could not be parsed." };
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol.toLowerCase()))
    return {
      kind: "blocked",
      reason: `Blocked: "${parsed.protocol}" URLs cannot load in the pane.`,
    };
  if (parsed.hostname === "") return { kind: "blocked", reason: "URL has no host." };
  return { kind: "load", url: parsed.toString() };
}
