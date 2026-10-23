import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ATTEND_BOTH,
  ATTENTION_THRESHOLD,
  MAX_EXCERPT_CHARS,
  MAX_FILES,
  MAX_TOTAL_EXCERPT_CHARS,
  buildAdvisorQuestions,
  buildAdvisorState,
  collectChangedFiles,
  formatSummary,
  isRuntimeFile,
  isSensitivePath,
  parseNumstat,
  requestAdvice,
  resolveAdvisorConfig,
  runAdvisor,
  runCli,
  summarizeAdvice,
} from "./ci-jev-advisor.mjs";

const FIXTURE_KEY = "fixture-typesafe-key";

function answersFor(count, userFlow, daemon) {
  const answers = {};
  for (let index = 0; index < count; index += 1) {
    answers[`user_flow_${index}`] = { type: "noul", noul: userFlow[index] };
    answers[`daemon_${index}`] = { type: "noul", noul: daemon[index] };
  }
  return answers;
}

function okFetch(body) {
  const calls = [];
  const fetchImpl = async (url, request) => {
    calls.push({ url, request });
    return { ok: true, status: 200, json: async () => body };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function gitRun(files, { fail = false } = {}) {
  return (command, args) => {
    assert.equal(command, "git");
    if (fail) return { status: 1, stdout: "" };
    if (args.includes("--numstat")) {
      const stdout = files
        .map((file) => `${file.additions}\t${file.deletions}\t${file.path}`)
        .join("\n");
      return { status: 0, stdout: stdout ? `${stdout}\n` : "" };
    }
    const path = args.at(-1);
    const file = files.find((item) => item.path === path);
    return { status: 0, stdout: file?.excerpt ?? "" };
  };
}

const pullEnv = {
  GITHUB_EVENT_NAME: "pull_request",
  TYPESAFE_API_KEY: FIXTURE_KEY,
  BASE_SHA: "base",
  HEAD_SHA: "head",
};

test("resolveAdvisorConfig defaults to enforce and accepts shadow and off", () => {
  assert.equal(resolveAdvisorConfig({}).mode, "enforce");
  assert.equal(resolveAdvisorConfig({ CI_JEV_MODE: "shadow" }).mode, "shadow");
  assert.equal(resolveAdvisorConfig({ CI_JEV_MODE: " OFF " }).mode, "off");
  assert.equal(resolveAdvisorConfig({ CI_JEV_MODE: "sometimes" }).mode, "enforce");
  assert.equal(resolveAdvisorConfig({ TYPESAFE_BASE_URL: "https://example.test///" }).baseUrl, "https://example.test");
});

test("runtime classification matches Drogon paths and withholds credential-looking paths", () => {
  assert.equal(isRuntimeFile("apps/desktop/src/renderer/src/features/work/WorkPage.tsx"), true);
  assert.equal(isRuntimeFile("crates/drogon-core/src/work/sync.rs"), true);
  assert.equal(isRuntimeFile("crates/drogon-core/src/session_output_tests.rs"), false);
  assert.equal(isRuntimeFile("crates/drogon-core/tests/work_jira_board.rs"), false);
  assert.equal(isRuntimeFile("apps/desktop/src/renderer/src/foo.test.tsx"), false);
  assert.equal(isRuntimeFile("docs/agents/typesafe.md"), false);
  assert.equal(isRuntimeFile("README.md"), false);
  assert.equal(isRuntimeFile("scripts/ci-jev-advisor.mjs"), false);
  assert.equal(isRuntimeFile(".github/workflows/foundation.yml"), false);
  assert.equal(isSensitivePath(".env"), true);
  assert.equal(isSensitivePath("crates/drogon-core/src/bot_secrets.rs"), true);
  assert.equal(isSensitivePath("apps/desktop/src/renderer/src/features/settings/Settings.tsx"), false);
});

test("excerpts are bounded, budgeted, and withheld for credential paths", () => {
  const long = "x".repeat(MAX_EXCERPT_CHARS + 10);
  const [file] = buildAdvisorState([
    { path: "apps/desktop/src/a.ts", additions: 3, deletions: 1, excerpt: long },
  ]).files;
  assert.equal(file.diff.startsWith("x".repeat(MAX_EXCERPT_CHARS)), true);
  assert.match(file.diff, /\[diff truncated\]$/);

  const count = Math.ceil(MAX_TOTAL_EXCERPT_CHARS / MAX_EXCERPT_CHARS) + 2;
  const state = buildAdvisorState(
    Array.from({ length: count }, (_, index) => ({
      path: `apps/desktop/src/f${index}.ts`,
      additions: 1,
      deletions: 0,
      excerpt: "y".repeat(MAX_EXCERPT_CHARS),
    })),
  );
  const sent = state.files.reduce(
    (sum, item) => sum + item.diff.replace(/\n\[diff truncated\]$/, "").length,
    0,
  );
  assert.equal(sent, MAX_TOTAL_EXCERPT_CHARS);

  const [secret] = buildAdvisorState([
    { path: ".env.example", additions: 1, deletions: 0, excerpt: `KEY=${FIXTURE_KEY}` },
  ]).files;
  assert.match(secret.diff, /withheld/);
  assert.equal(JSON.stringify(secret).includes(FIXTURE_KEY), false);
});

test("questions name the file index and stay Noul judgments", () => {
  const questions = buildAdvisorQuestions(2);
  assert.deepEqual(Object.keys(questions), ["user_flow_0", "daemon_0", "user_flow_1", "daemon_1"]);
  assert.equal(questions.user_flow_1.type, "noul");
  assert.match(questions.user_flow_1.instructions, /`files\[1\]`/);
  assert.match(questions.daemon_0.instructions, /daemon guarantee/);
});

test("requestAdvice posts the key only in the Authorization header", async () => {
  const questions = buildAdvisorQuestions(1);
  const fetchImpl = okFetch({ answers: answersFor(1, [0.9], [0.2]) });
  const result = await requestAdvice({
    config: resolveAdvisorConfig({ TYPESAFE_API_KEY: FIXTURE_KEY }),
    state: { files: [{ path: "a.rs", additions: 1, deletions: 0, diff: "diff" }] },
    questions,
    fetchImpl,
    timeoutMs: 1000,
  });
  assert.equal(result.ok, true);
  assert.equal(fetchImpl.calls[0].request.headers.Authorization, `Bearer ${FIXTURE_KEY}`);
  assert.equal(JSON.stringify(fetchImpl.calls[0].request.body).includes(FIXTURE_KEY), false);
  assert.equal(fetchImpl.calls[0].url.href, "https://api.typesafe.ai/v1/systemone");
});

test("requestAdvice fails closed on HTTP, timeout, and a missing answer", async () => {
  const config = resolveAdvisorConfig({ TYPESAFE_API_KEY: FIXTURE_KEY });
  const questions = buildAdvisorQuestions(1);
  const http = await requestAdvice({
    config,
    state: {},
    questions,
    fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: FIXTURE_KEY }) }),
    timeoutMs: 1000,
  });
  assert.deepEqual(http, { ok: false, error: "HTTP 429" });

  const timed = await requestAdvice({
    config,
    state: {},
    questions,
    fetchImpl: async () => {
      const error = new Error("slow");
      error.name = "TimeoutError";
      throw error;
    },
    timeoutMs: 1000,
  });
  assert.equal(timed.error, "request timed out");

  const malformed = await requestAdvice({
    config,
    state: {},
    questions,
    fetchImpl: okFetch({ answers: {} }),
    timeoutMs: 1000,
  });
  assert.equal(malformed.ok, false);
});

test("summarizeAdvice uses the per-file maximum against the attention threshold", () => {
  const advice = summarizeAdvice(
    [{ path: "a.rs" }, { path: "b.tsx" }],
    answersFor(2, [0.1, 0.9], [0.95, 0.2]),
  );
  assert.equal(advice.userFlowRisk, 0.9);
  assert.equal(advice.daemonRisk, 0.95);
  assert.equal(advice.decisions.acceptanceAttention, 0.9 >= ATTENTION_THRESHOLD);
  assert.equal(advice.decisions.daemonAttention, true);
});

test("parseNumstat keeps a path that contains a tab and treats binary counts as zero", () => {
  const rows = parseNumstat("-\t-\tassets/icon.png\n2\t1\tdir/a\tb.rs\n");
  assert.deepEqual(rows, [
    { path: "assets/icon.png", additions: 0, deletions: 0 },
    { path: "dir/a\tb.rs", additions: 2, deletions: 1 },
  ]);
});

test("collectChangedFiles asks only about runtime files and skips sensitive excerpts", () => {
  const files = [
    { path: "crates/drogon-core/src/session.rs", additions: 4, deletions: 1, excerpt: "live" },
    { path: "docs/agents/typesafe.md", additions: 10, deletions: 0, excerpt: "docs" },
    { path: "crates/drogon-core/src/bot_secrets.rs", additions: 1, deletions: 0, excerpt: FIXTURE_KEY },
  ];
  const collected = collectChangedFiles({
    baseSha: "base",
    headSha: "head",
    cwd: "/repo",
    run: gitRun(files),
  });
  assert.deepEqual(
    collected.map((file) => file.path),
    ["crates/drogon-core/src/session.rs", "crates/drogon-core/src/bot_secrets.rs"],
  );
  assert.equal(collected[1].excerpt, "");
});

test("enforce applies answers and every failure mode asks for both kinds of attention", async () => {
  const runtime = [
    { path: "apps/desktop/src/renderer/src/features/work/WorkPage.tsx", additions: 2, deletions: 0, excerpt: "toast" },
  ];
  const low = await runAdvisor({
    env: { ...pullEnv, CI_JEV_MODE: "enforce" },
    cwd: "/repo",
    run: gitRun(runtime),
    fetchImpl: okFetch({ answers: answersFor(1, [0.1], [0.2]) }),
  });
  assert.equal(low.status, "ok");
  assert.deepEqual(low.decisions, { acceptanceAttention: false, daemonAttention: false });

  const shadow = await runAdvisor({
    env: { ...pullEnv, CI_JEV_MODE: "shadow" },
    cwd: "/repo",
    run: gitRun(runtime),
    fetchImpl: okFetch({ answers: answersFor(1, [0.1], [0.2]) }),
  });
  assert.equal(shadow.status, "ok");
  assert.deepEqual(shadow.decisions, ATTEND_BOTH);
  assert.equal(shadow.advice.userFlowRisk, 0.1);

  const noKey = await runAdvisor({
    env: { ...pullEnv, TYPESAFE_API_KEY: "" },
    cwd: "/repo",
    run: gitRun(runtime),
    fetchImpl: okFetch({}),
  });
  assert.equal(noKey.status, "no-key");
  assert.deepEqual(noKey.decisions, ATTEND_BOTH);

  const docsOnly = await runAdvisor({
    env: pullEnv,
    cwd: "/repo",
    run: gitRun([{ path: "README.md", additions: 1, deletions: 0, excerpt: "doc" }]),
    fetchImpl: okFetch({}),
  });
  assert.equal(docsOnly.status, "no-runtime-files");

  const tooLarge = await runAdvisor({
    env: pullEnv,
    cwd: "/repo",
    run: gitRun(
      Array.from({ length: MAX_FILES + 1 }, (_, index) => ({
        path: `crates/drogon-core/src/f${index}.rs`,
        additions: 1,
        deletions: 0,
        excerpt: "x",
      })),
    ),
    fetchImpl: okFetch({}),
  });
  assert.equal(tooLarge.status, "too-large");
  assert.deepEqual(tooLarge.decisions, ATTEND_BOTH);

  const broken = await runAdvisor({
    env: pullEnv,
    cwd: "/repo",
    run: gitRun(runtime, { fail: true }),
    fetchImpl: okFetch({}),
  });
  assert.equal(broken.status, "failed");
  assert.equal(broken.detail, "could not read the diff");
});

test("the summary and GitHub outputs never include the key and do not claim a check was skipped", async () => {
  const dir = mkdtempSync(join(tmpdir(), "drogon-advisor-"));
  const output = join(dir, "output");
  const summary = join(dir, "summary");
  const outcome = await runCli({
    env: {
      ...pullEnv,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
    },
    cwd: "/repo",
    run: gitRun([
      { path: "crates/drogon-core/src/session.rs", additions: 1, deletions: 0, excerpt: "idle" },
    ]),
    fetchImpl: okFetch({ answers: answersFor(1, [0.91], [0.1]) }),
    appendFile: (await import("node:fs")).appendFileSync,
  });
  assert.equal(outcome.decisions.acceptanceAttention, true);
  assert.equal(outcome.decisions.daemonAttention, false);
  const text = readFileSync(summary, "utf8");
  assert.match(text, /Required checks still run/);
  assert.match(text, /session\.rs/);
  assert.equal(text.includes(FIXTURE_KEY), false);
  assert.match(readFileSync(output, "utf8"), /acceptance_attention=true\ndaemon_attention=false/);
  assert.match(formatSummary({ status: "off", mode: "off", decisions: ATTEND_BOTH }), /advisor disabled/);
  rmSync(dir, { recursive: true, force: true });
});

test("the advisor workflow runs the script and does not gate foundation", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/typesafe-advisor.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /node scripts\/ci-jev-advisor\.mjs/);
  assert.match(workflow, /node --test scripts\/typesafe-validate\.test\.mjs scripts\/ci-jev-advisor\.test\.mjs/);
  assert.equal(/^\s*- run: cargo /m.test(workflow), false);
  assert.equal(workflow.includes("workflows/foundation"), false);
  assert.match(workflow, /secrets\.TYPESAFE_API_KEY/);
});
