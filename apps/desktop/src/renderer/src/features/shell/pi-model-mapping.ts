/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/lib/launch-drogon-bot-session.ts (the Pi Model field
   takes an exact `provider/model-id`, blank means the harness default, and
   anything else fails with "Use an exact provider/model ID with Pi, or keep
   the agent default."). Adapter: the desktop launch dialog keeps its own
   Model textbox plus the Advanced Provider field, so this resolves the two
   raw strings into the provider/model pair the daemon's `harness.start`
   expects (`pi --provider <p> --model <m>`, both flags verified against the
   real `pi --help`). A flags string pasted into Model (`--provider P
   --model M`, either order, `--flag=value` or quoted values) is parsed,
   never passed through as a model id the daemon would reject. Pure
   functions, unit-tested. */
import type { HarnessId } from "../../../../shared/session-contract";

/** Fork-exact Pi model error (launch-drogon-bot-session.ts). */
export const PI_MODEL_ERROR =
  "Use an exact provider/model ID with Pi, or keep the agent default.";

/** The QA-documented local model id, used in helper copy as the example. */
export const PI_MODEL_EXAMPLE = "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4";

/**
 * Fork-exact Pi model helper (BotCreationForm.tsx: "Use an exact Pi
 * provider/model ID. Blank uses Pi settings."), with the documented
 * example appended so the `provider/model` shape is concrete (#221).
 */
export const PI_MODEL_HELPER = `Use an exact Pi provider/model ID, e.g. ${PI_MODEL_EXAMPLE}. Blank uses Pi settings.`;

/** Fork-exact Pi model shape (launch-drogon-bot-session.ts). */
const PI_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/:+-]*$/;

/** Backend `plan_launch` (crates/drogon-harness/src/launch.rs) limits. */
const MAX_FIELD_LENGTH = 512;

export type PiModelMapping =
  | { provider?: string; model?: string }
  | { error: string };

function fieldError(name: string, value: string): string | null {
  if (value.length > MAX_FIELD_LENGTH) return `Invalid ${name}`;
  if ([...value].some((char) => char <= "\u001f" || char === "\u007f"))
    return `Invalid ${name}`;
  if (value.startsWith("-")) return `Invalid ${name}`;
  return null;
}

/** Splits `--flag value`, `--flag=value`, single/double-quoted values. */
function tokenizeFlagsText(text: string): string[] | null {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  // A quote character outside a matched group means unbalanced input.
  const stripped = text.replace(/"[^"]*"|'[^']*'|\S+/g, "");
  if (stripped.trim() !== "") return null;
  while ((match = pattern.exec(text)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

function parseModelFlagsText(text: string): PiModelMapping {
  const tokens = tokenizeFlagsText(text);
  if (!tokens) return { error: PI_MODEL_ERROR };
  let provider: string | undefined;
  let model: string | undefined;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    let flag: string | null = null;
    let inline: string | undefined;
    if (token.startsWith("--")) {
      const equals = token.indexOf("=");
      if (equals === -1) flag = token;
      else {
        flag = token.slice(0, equals);
        inline = token.slice(equals + 1);
      }
    }
    // A positional (or single-dash) token is not a model id at all —
    // the backend would refuse it as "Invalid model", so say that here.
    if (flag === null) return { error: "Invalid model" };
    if (flag !== "--provider" && flag !== "--model") {
      return {
        error: `Unsupported flag ${JSON.stringify(flag)} in the Model field.`,
      };
    }
    let value = inline !== undefined ? inline : (tokens[(index += 1)] ?? "");
    // `--flag="quoted value"` tokenizes whole, so shed one quote layer.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (value === "" || value.startsWith("-")) {
      return { error: `Invalid ${flag.slice(2)}` };
    }
    if (flag === "--provider") provider = value;
    else model = value;
  }
  if (provider === undefined && model === undefined)
    return { error: PI_MODEL_ERROR };
  return { provider, model };
}

/**
 * Resolves the launch form's raw Model/Provider strings into the
 * provider/model pair for `harness.start`. Never drops input: a value that
 * cannot map returns `{ error }` with the fork's copy, and the caller must
 * show it instead of launching. `provider` is Pi-only (the normalizer
 * drops it for every other harness); a flags-shaped Model on a non-Pi
 * harness is an error, since only Pi documents `--provider`/`--model`.
 */
export function resolvePiModelField(input: {
  harnessId: HarnessId;
  model: string;
  provider: string;
}): PiModelMapping {
  const rawModel = input.model.trim();
  const rawProvider = input.provider.trim();
  if (input.harnessId !== "pi") {
    if (rawModel === "") return {};
    if (/(^|\s)--[A-Za-z]/.test(rawModel) || rawModel.startsWith("-")) {
      return {
        error:
          "The Model field takes a bare model id; provider selection is available only for Pi.",
      };
    }
    const invalid = fieldError("model", rawModel);
    if (invalid) return { error: invalid };
    return { model: rawModel };
  }
  const providerError =
    rawProvider === "" ? null : fieldError("provider", rawProvider);
  if (providerError) return { error: providerError };
  const explicitProvider = rawProvider === "" ? undefined : rawProvider;
  if (rawModel === "") {
    return explicitProvider ? { provider: explicitProvider } : {};
  }
  const looksLikeFlags =
    rawModel.startsWith("-") || /(^|\s)--[A-Za-z]/.test(rawModel);
  if (looksLikeFlags) {
    const parsed = parseModelFlagsText(rawModel);
    if ("error" in parsed) return parsed;
    if (
      parsed.provider !== undefined &&
      explicitProvider !== undefined &&
      parsed.provider !== explicitProvider
    ) {
      return {
        error: `The provider ${JSON.stringify(parsed.provider)} in the Model field disagrees with the Provider field ${JSON.stringify(explicitProvider)}.`,
      };
    }
    const provider = parsed.provider ?? explicitProvider;
    const modelError =
      parsed.model === undefined ? null : fieldError("model", parsed.model);
    if (modelError) return { error: modelError };
    if (
      parsed.model !== undefined &&
      !PI_MODEL_PATTERN.test(parsed.model)
    ) {
      return { error: PI_MODEL_ERROR };
    }
    const mapped: { provider?: string; model?: string } = {};
    if (provider !== undefined) mapped.provider = provider;
    if (parsed.model !== undefined) mapped.model = parsed.model;
    return mapped;
  }
  if (!PI_MODEL_PATTERN.test(rawModel)) return { error: PI_MODEL_ERROR };
  const mapped: { provider?: string; model?: string } = { model: rawModel };
  if (explicitProvider !== undefined) mapped.provider = explicitProvider;
  return mapped;
}
