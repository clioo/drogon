#!/usr/bin/env node
// Smoke-check a configured TypeSafe key against two synthetic Noul questions.
// Sends no repository files, conversation, or customer data. A missing key
// skips. Never prints the key or a response body.
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONFIG_KEYS = ["TYPESAFE_API_KEY", "TYPESAFE_BASE_URL", "TYPESAFE_DEFAULT_MODEL"];

function readConfig(repoRoot, env) {
  // An explicitly empty inherited key disables validation, even if .env has one.
  if (env.TYPESAFE_API_KEY !== undefined && !env.TYPESAFE_API_KEY.trim()) return env;
  const config = {};
  try {
    const values = parseEnv(readFileSync(resolve(repoRoot, ".env"), "utf8"));
    for (const key of CONFIG_KEYS) {
      if (values[key] !== undefined) config[key] = values[key];
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const key of CONFIG_KEYS) {
    if (env[key] !== undefined) config[key] = env[key];
  }
  return config;
}

const failure = (message) => ({
  status: "failed",
  message: `TypeSafe validation failed: ${message}`,
});

const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

function isTransportFailure(error) {
  if (error === null || typeof error !== "object") return false;
  if (error.name === "TypeError") return true;
  if (typeof error.code === "string" && NETWORK_ERROR_CODES.has(error.code)) return true;
  if (isTransportFailure(error.cause)) return true;
  if (Array.isArray(error.errors) && error.errors.some((item) => isTransportFailure(item))) {
    return true;
  }
  return false;
}

function caughtFailureMessage(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "request timed out.";
  if (isTransportFailure(error)) return "the TypeSafe service could not be reached.";
  if (error?.name === "SyntaxError") return "response decoding failed.";
  return "request or response decoding failed.";
}

/**
 * Exercise the live typed API with public, synthetic inputs only. The 0.5 split is
 * a smoke assertion for these explicit examples, not a production policy threshold.
 */
export async function validateTypeSafe({
  env = process.env,
  repoRoot = REPO_ROOT,
  fetchImpl = fetch,
  timeoutMs = 15_000,
} = {}) {
  let config;
  try {
    config = readConfig(repoRoot, env);
  } catch {
    return failure("could not read local TypeSafe configuration.");
  }
  const apiKey = config.TYPESAFE_API_KEY?.trim();
  if (!apiKey) {
    return {
      status: "skipped",
      message: "TypeSafe validation skipped: TYPESAFE_API_KEY is absent or blank.",
    };
  }

  let endpoint;
  try {
    endpoint = new URL(
      `${(config.TYPESAFE_BASE_URL?.trim() || "https://api.typesafe.ai").replace(/\/+$/, "")}/v1/systemone`,
    );
    if (
      !["https:", "http:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    ) {
      return failure(
        "TYPESAFE_BASE_URL must be an HTTP(S) base URL without credentials, query, or fragment.",
      );
    }
  } catch {
    return failure("TYPESAFE_BASE_URL is not a valid URL.");
  }

  const questions = Object.fromEntries(
    ["positive", "negative"].map((id) => [
      id,
      {
        type: "noul",
        instructions: `Does the message in \`messages.${id}\` explicitly request urgent, immediate action?`,
        criteria: {
          true: "The message explicitly requests urgent, immediate action.",
          false: "The message explicitly says there is no urgency and action can wait.",
        },
      },
    ]),
  );
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: config.TYPESAFE_DEFAULT_MODEL?.trim() || "jev-latest",
        state: {
          messages: {
            positive: "This is urgent. Please act immediately, right now; it cannot wait.",
            negative:
              "There is no urgency. No immediate action is needed; this can wait until next month.",
          },
        },
        questions,
      }),
    });
    if (!response.ok) {
      return failure(`HTTP ${response.status}; check credentials, quota, and endpoint availability.`);
    }
    const body = await response.json();
    if (typeof body?.model !== "string" || !body.model.trim()) {
      return failure("response has no model identifier.");
    }
    for (const id of ["positive", "negative"]) {
      const answer = body.answers?.[id];
      if (
        answer?.type !== "noul" ||
        !Number.isFinite(answer.noul) ||
        answer.noul < 0 ||
        answer.noul > 1
      ) {
        return failure("response does not contain two typed Noul probabilities in [0, 1].");
      }
    }
    if (body.answers.positive.noul <= 0.5 || body.answers.negative.noul >= 0.5) {
      return failure("synthetic urgency answers did not match the positive and negative examples.");
    }
  } catch (error) {
    return failure(caughtFailureMessage(error));
  }
  return {
    status: "passed",
    message: "TypeSafe validation passed: live typed API and synthetic urgency checks.",
  };
}

/** Return output separately so tests can exercise exactly what each agent receives. */
export async function runCli({ args = [], input = "", ...options } = {}) {
  const hook = args.length === 1 && args[0] === "--hook";
  if (args.length && !hook) {
    return { exitCode: 1, output: "Usage: node scripts/typesafe-validate.mjs [--hook]", error: "" };
  }
  if (hook) {
    try {
      const payload = JSON.parse(input);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("Invalid payload");
      }
    } catch {
      const message = "TypeSafe validation failed: invalid Stop hook input.";
      return { exitCode: 0, output: JSON.stringify({ systemMessage: message }), error: message };
    }
  }
  const result = await validateTypeSafe(options);
  const failed = result.status === "failed";
  // Codex surfaces systemMessage as a warning, so a skip prints {}.
  // Failures stay on systemMessage. A model misjudgment of the synthetic sample
  // cannot be repaired by forcing another agent turn.
  const report = result.status === "skipped" ? {} : { systemMessage: result.message };
  return {
    exitCode: !hook && failed ? 1 : 0,
    output: hook ? JSON.stringify(report) : result.message,
    error: failed ? result.message : "",
  };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const result = await runCli({
    args,
    input: args.includes("--hook") ? readFileSync(0, "utf8") : "",
  });
  process.stdout.write(`${result.output}\n`);
  if (result.error) process.stderr.write(`${result.error}\n`);
  process.exitCode = result.exitCode;
}
