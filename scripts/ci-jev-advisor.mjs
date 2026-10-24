#!/usr/bin/env node
/**
 * TypeSafe (Jev) advisor for a Drogon pull request.
 *
 * Adapted from the astro-market advisor. Path rules cannot tell a comment
 * edit from a rewrite of session liveness or the Work board, so Jev answers
 * two per-file questions. Code turns those probabilities into attention
 * flags a reviewer can read in the job summary.
 *
 * Authority is one-sided. Jev can only ask for more attention:
 *
 *   - a likely user-flow change asks the reviewer to look at desktop acceptance
 *   - a likely daemon change asks the reviewer to look at session, work,
 *     worktree, gate, monitor, or automation tests
 *
 * It never skips foundation, journeys, cargo test, the desktop suite, or
 * packaged acceptance. A missing key, a fork PR, a timeout, an HTTP error,
 * or a malformed answer all resolve to "pay attention to both". Shadow mode
 * records the answers and still reports that fail-open pair. `CI_JEV_MODE=off`
 * does the same without a request.
 *
 * Data sent: changed runtime paths, line counts, and a bounded diff excerpt.
 * Credential-looking paths are sent as a path only. Docs, tests, scripts, and
 * workflow files are not sent.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const ADVISOR_MODES = ["enforce", "shadow", "off"];
export const DEFAULT_MODE = "enforce";
export const DEFAULT_BASE_URL = "https://api.typesafe.ai";
export const DEFAULT_MODEL = "jev-latest";
export const REQUEST_TIMEOUT_MS = 15_000;

/** Above this many runtime files, the diff is treated as needing attention. */
export const MAX_FILES = 40;
export const MAX_EXCERPT_CHARS = 1_200;
/** Jev's state budget is 32k tokens; stay well inside it. */
export const MAX_TOTAL_EXCERPT_CHARS = 48_000;

/**
 * Call attention only when Jev is near-certain. The merge is still gated by
 * the ordinary workflows, so a low score must not be read as a skipped check.
 * 0.85 is the astro-market user-flow threshold.
 */
export const ATTENTION_THRESHOLD = 0.85;

const DOCS_FILE = /(?:^docs\/|\.md$)/;
const TEST_FILE =
  /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|_tests\.rs$|(?:^|\/)(?:__tests__|__mocks__)\/|^test\/|^crates\/[^/]+\/tests\/)/;
const TOOLING_FILE = /^(?:scripts|\.github)\//;
const SENSITIVE_FILE = /(?:(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx|crt)$|secret|credential)/i;

const USER_FLOW_CRITERIA = {
  true: "It changes a desktop surface a person uses (projects, sessions, terminals, files, source control, tasks, the Work board, bots, automations, meetings, the Work Graph, or settings), the preload bridge behind one of those controls, or a drogon-cli command a person or agent runs to do that work.",
  false:
    "It only changes tests, documentation, comments, logging, type annotations, packaging or CI tooling, or code no window and no CLI command reaches.",
};

const DAEMON_CRITERIA = {
  true: "It can change a daemon guarantee: session liveness (live, unverifiable, or exited), PTY delivery, worktree paths, Work-board sync or prompt delivery, orchestration gates, bot monitors, or automation completion.",
  false:
    "It only changes desktop copy or layout, tests, documentation, or code that cannot change a stored session, ticket, worktree, gate, or automation row.",
};

/** The decision when Jev cannot be consulted: look at both surfaces. */
export const ATTEND_BOTH = Object.freeze({
  acceptanceAttention: true,
  daemonAttention: true,
});

/**
 * @param {Record<string, string | undefined>} env
 */
export function resolveAdvisorConfig(env) {
  const requested = env.CI_JEV_MODE?.trim().toLowerCase();
  const mode = ADVISOR_MODES.includes(requested) ? requested : DEFAULT_MODE;
  return {
    mode,
    apiKey: env.TYPESAFE_API_KEY?.trim() ?? "",
    baseUrl: (env.TYPESAFE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: env.TYPESAFE_DEFAULT_MODEL?.trim() || DEFAULT_MODEL,
  };
}

/** Runtime source is what Jev is asked about. Docs, tests, and tooling are not. */
export function isRuntimeFile(path) {
  return !DOCS_FILE.test(path) && !TEST_FILE.test(path) && !TOOLING_FILE.test(path);
}

export function isSensitivePath(path) {
  return SENSITIVE_FILE.test(path);
}

/**
 * @param {{ path: string, additions: number, deletions: number, excerpt: string }[]} files
 */
export function buildAdvisorState(files) {
  let budget = MAX_TOTAL_EXCERPT_CHARS;
  return {
    files: files.map(({ path, additions, deletions, excerpt }) => {
      let diff = "[diff withheld: path looks like a credential file]";
      if (!isSensitivePath(path)) {
        diff = excerpt.slice(0, Math.min(MAX_EXCERPT_CHARS, budget));
        budget -= diff.length;
        if (diff.length < excerpt.length) diff += "\n[diff truncated]";
      }
      return { path, additions, deletions, diff };
    }),
  };
}

/** One narrow question per file and judgment, so the answer never has to aggregate. */
export function buildAdvisorQuestions(fileCount) {
  const questions = {};
  for (let index = 0; index < fileCount; index += 1) {
    questions[`user_flow_${index}`] = {
      type: "noul",
      instructions: `Could the change shown in \`files[${index}]\` break or change how a person completes an existing flow in the Drogon desktop or drogon-cli?`,
      criteria: USER_FLOW_CRITERIA,
    };
    questions[`daemon_${index}`] = {
      type: "noul",
      instructions: `Could the change shown in \`files[${index}]\` break a Drogon daemon guarantee for sessions, worktrees, the Work board, orchestration, bot monitors, or automations?`,
      criteria: DAEMON_CRITERIA,
    };
  }
  return questions;
}

function isProbability(answer) {
  return (
    answer?.type === "noul" && Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1
  );
}

/**
 * @returns {Promise<{ ok: true, answers: Record<string, { noul: number }> } | { ok: false, error: string }>}
 */
export async function requestAdvice({ config, state, questions, fetchImpl, timeoutMs }) {
  let response;
  try {
    response = await fetchImpl(new URL(`${config.baseUrl}/v1/systemone`), {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ model: config.model, state, questions }),
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const body = await response.json();
    const answers = body?.answers;
    if (!Object.keys(questions).every((id) => isProbability(answers?.[id]))) {
      return { ok: false, error: "response did not contain a typed Noul for every question" };
    }
    return { ok: true, answers };
  } catch (error) {
    return {
      ok: false,
      error:
        error?.name === "TimeoutError" || error?.name === "AbortError"
          ? "request timed out"
          : "request or response decoding failed",
    };
  }
}

/**
 * @param {{ path: string }[]} files
 * @param {Record<string, { noul: number }>} answers
 */
export function summarizeAdvice(files, answers) {
  const perFile = files.map(({ path }, index) => ({
    path,
    userFlow: answers[`user_flow_${index}`].noul,
    daemon: answers[`daemon_${index}`].noul,
  }));
  const userFlowRisk = Math.max(0, ...perFile.map((file) => file.userFlow));
  const daemonRisk = Math.max(0, ...perFile.map((file) => file.daemon));
  return {
    perFile,
    userFlowRisk,
    daemonRisk,
    decisions: {
      acceptanceAttention: userFlowRisk >= ATTENTION_THRESHOLD,
      daemonAttention: daemonRisk >= ATTENTION_THRESHOLD,
    },
  };
}

/**
 * Parse `git diff --numstat`. Binary files report `-`.
 * @param {string} text
 */
export function parseNumstat(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [additions, deletions, ...rest] = line.split("\t");
      return {
        path: rest.join("\t"),
        additions: Number.parseInt(additions, 10) || 0,
        deletions: Number.parseInt(deletions, 10) || 0,
      };
    });
}

function git(run, cwd, args) {
  const result = run("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
  return String(result.stdout || "");
}

/** Changed runtime files between two SHAs, each with a bounded diff excerpt. */
export function collectChangedFiles({ baseSha, headSha, cwd, run }) {
  const stats = parseNumstat(
    git(run, cwd, ["diff", "--numstat", "--no-renames", baseSha, headSha]),
  );
  return stats
    .filter(({ path }) => isRuntimeFile(path))
    .map((file) => ({
      ...file,
      excerpt: isSensitivePath(file.path)
        ? ""
        : git(run, cwd, [
            "diff",
            "--no-color",
            "--no-renames",
            "--unified=1",
            baseSha,
            headSha,
            "--",
            file.path,
          ]).slice(0, MAX_EXCERPT_CHARS + 1),
    }));
}

/**
 * Decide, never throwing. Every branch that does not end in a valid answer
 * returns ATTEND_BOTH.
 */
export async function runAdvisor({
  env,
  cwd,
  run = spawnSync,
  fetchImpl = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  const config = resolveAdvisorConfig(env);
  const result = (status, extra = {}) => ({
    status,
    mode: config.mode,
    decisions: ATTEND_BOTH,
    ...extra,
  });

  if (config.mode === "off") return result("off");
  if (env.GITHUB_EVENT_NAME !== "pull_request") return result("not-applicable");
  if (!config.apiKey) return result("no-key");

  let files;
  try {
    files = collectChangedFiles({ baseSha: env.BASE_SHA, headSha: env.HEAD_SHA, cwd, run });
  } catch {
    return result("failed", { detail: "could not read the diff" });
  }

  if (files.length === 0) return result("no-runtime-files");
  if (files.length > MAX_FILES) {
    return result("too-large", { detail: `${files.length} runtime files (limit ${MAX_FILES})` });
  }

  const response = await requestAdvice({
    config,
    state: buildAdvisorState(files),
    questions: buildAdvisorQuestions(files.length),
    fetchImpl,
    timeoutMs,
  });
  if (!response.ok) return result("failed", { detail: response.error });

  const advice = summarizeAdvice(files, response.answers);
  return result("ok", {
    advice,
    decisions: config.mode === "enforce" ? advice.decisions : ATTEND_BOTH,
  });
}

const STATUS_TEXT = {
  ok: "Jev answered",
  off: "advisor disabled (`CI_JEV_MODE=off`)",
  "not-applicable": "not a pull_request event",
  "no-key": "`TYPESAFE_API_KEY` is absent or blank (fork PR or unconfigured)",
  "no-runtime-files": "no runtime files changed",
  "too-large": "diff too large to ask about",
  failed: "request failed",
};

export function formatSummary(outcome) {
  const lines = [
    "### TypeSafe CI advisor",
    "",
    "Required checks still run. These flags only say where a reviewer should look.",
    "",
    `- Status: ${STATUS_TEXT[outcome.status]}${outcome.detail ? ` — ${outcome.detail}` : ""}`,
    `- Mode: \`${outcome.mode}\``,
    `- Desktop acceptance deserves a look: \`${outcome.decisions.acceptanceAttention}\``,
    `- Daemon and Work tests deserve a look: \`${outcome.decisions.daemonAttention}\``,
  ];
  if (outcome.advice) {
    lines.push(
      `- Highest user-flow risk: \`${outcome.advice.userFlowRisk.toFixed(3)}\` (threshold ${ATTENTION_THRESHOLD})`,
      `- Highest daemon risk: \`${outcome.advice.daemonRisk.toFixed(3)}\` (threshold ${ATTENTION_THRESHOLD})`,
      "",
      "| File | User flow | Daemon |",
      "| --- | ---: | ---: |",
      ...[...outcome.advice.perFile]
        .sort((a, b) => b.userFlow - a.userFlow || b.daemon - a.daemon)
        .map(
          ({ path, userFlow, daemon }) =>
            `| \`${path}\` | ${userFlow.toFixed(3)} | ${daemon.toFixed(3)} |`,
        ),
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function runCli({
  env = process.env,
  cwd = process.cwd(),
  run = spawnSync,
  fetchImpl = fetch,
  appendFile = appendFileSync,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const outcome = await runAdvisor({ env, cwd, run, fetchImpl, timeoutMs });
  if (env.GITHUB_OUTPUT) {
    appendFile(
      env.GITHUB_OUTPUT,
      `status=${outcome.status}\nacceptance_attention=${outcome.decisions.acceptanceAttention}\ndaemon_attention=${outcome.decisions.daemonAttention}\n`,
      "utf8",
    );
  }
  if (env.GITHUB_STEP_SUMMARY) appendFile(env.GITHUB_STEP_SUMMARY, formatSummary(outcome), "utf8");
  return outcome;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
