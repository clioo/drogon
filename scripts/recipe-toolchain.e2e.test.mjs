// MIT Copyright (c) 2026 Lovecast Inc.
//
// Isolated end-to-end proof for the recipe toolchain fix, driven through the
// real `mentu-recipes` runner in throwaway fixture repositories:
//   A) the original clean-checkout contract (run_20260910064001_ADB6B84E)
//      under a PATH with no pnpm must fail visibly with exit 127 while the
//      raw error and the pending downstream steps are preserved; and
//   B) the fixed contract — the real recipe's clean-checkout step, verbatim —
//      must resolve the packageManager-pinned pnpm project-locally and go
//      green, with downstream steps executing and the tree staying clean.
// No app, daemon or global tooling is touched: fixtures live in tmpdir and
// every spawned process is a synchronous child that is reaped before return.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const toolchainScript = readFileSync(path.join(repoRoot, 'scripts/recipe-toolchain.sh'), 'utf8');
const realRecipe = JSON.parse(
  readFileSync(path.join(repoRoot, '.mentu/recipes/rewrite-foundation-verification.json'), 'utf8'),
);
const NODE24_BIN = path.join(
  process.env.HOME,
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin',
);
const AMBIENT_NODE_BIN = path.join(process.env.HOME, '.local/bin');
const PINNED = 'pnpm@11.19.0';
// The sanitized-PATH shape that failed in production (run_20260910064001_ADB6B84E):
// real node and cargo are reachable, pnpm unavailable to this recipe shell.
const RECIPE_PATH = [NODE24_BIN, AMBIENT_NODE_BIN, '/opt/homebrew/bin', '/usr/bin', '/bin'].join(':');
const RUNNER_ENV = {
  ...process.env,
  PATH: RECIPE_PATH,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  // Identity for the runner's step commits, without touching global git config.
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};

function mentuBinary() {
  const override = process.env.DROGON_MENTU_RECIPES_BIN;
  const probe = spawnSync(override ?? 'mentu-recipes', ['--version'], { encoding: 'utf8' });
  assert.equal(
    probe.status,
    0,
    `mentu-recipes is required for this E2E (set DROGON_MENTU_RECIPES_BIN): ${probe.stderr || probe.error}`,
  );
  return override ?? 'mentu-recipes';
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: RUNNER_ENV, stdio: 'pipe' }).toString();
}

function fixtureRepo(t, recipe) {
  const base = mkdtempSync(path.join(tmpdir(), 'drogon-recipe-e2e-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  writeFileSync(path.join(base, 'package.json'), JSON.stringify({ name: 'fixture', packageManager: PINNED }));
  writeFileSync(path.join(base, '.gitignore'), '.mentu/runtime/\n.mentu/runs/\nnode_modules/\n');
  mkdirSync(path.join(base, 'scripts'));
  writeFileSync(path.join(base, 'scripts/recipe-toolchain.sh'), toolchainScript);
  // The recipe is part of the committed tree: clean-checkout asserts that no
  // untracked file exists, exactly as the real workspace does.
  writeRecipe(base, recipe);
  git(base, 'init', '-b', 'main');
  git(base, 'add', '.');
  git(
    base,
    '-c', 'user.name=Fixture',
    '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false',
    'commit', '-m', 'fixture',
  );
  return base;
}

function writeRecipe(base, recipe) {
  const dir = path.join(base, '.mentu/recipes');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${recipe.name}.json`), JSON.stringify(recipe, null, 2));
}

function runRecipe(base, recipeName) {
  const mentu = mentuBinary();
  const result = spawnSync(mentu, ['run', recipeName, '--workspace', base, '--backend', 'shell'], {
    cwd: base,
    env: RUNNER_ENV,
    encoding: 'utf8',
    timeout: 240000,
  });
  assert.equal(result.error, undefined, `runner crashed: ${result.error}`);
  const runsDir = path.join(base, '.mentu/runs');
  assert.ok(existsSync(runsDir), `runner wrote no run record; stdout:\n${result.stdout}${result.stderr}`);
  const runDirs = readdirSync(runsDir).filter((entry) => entry.startsWith('run_'));
  assert.equal(runDirs.length, 1, 'exactly one run record expected');
  const runDir = path.join(runsDir, runDirs[0]);
  const run = JSON.parse(readFileSync(path.join(runDir, 'run.json'), 'utf8'));
  const state = JSON.parse(readFileSync(path.join(runDir, 'state.json'), 'utf8'));
  return { result, runDir, run, state };
}

test('precondition: the constrained PATH has node and cargo but no pnpm', () => {
  const probe = spawnSync(
    '/bin/sh',
    ['-c', 'command -v node >/dev/null && command -v cargo >/dev/null && ! command -v pnpm >/dev/null'],
    { env: RUNNER_ENV, encoding: 'utf8' },
  );
  assert.equal(probe.status, 0, 'node and cargo must be reachable and pnpm must be absent');
});

test('original contract: missing pnpm fails visibly with 127 and leaves downstream pending', t => {
  // Verbatim clean-checkout prompt of the failed production run
  // run_20260910064001_ADB6B84E (rewrite-foundation-verification).
  const originalCleanCheckout =
    'git diff --quiet && git diff --cached --quiet && test -z "$(git ls-files --others --exclude-standard)" ' +
    '&& node --version && cargo --version && pnpm --version && printf \'CHECKOUT_READY\\n\'';
  const base = fixtureRepo(t, {
    name: 'original-contract-repro',
    description: 'Reproduces run_20260910064001_ADB6B84E: pnpm assumed to be an installed command.',
    type: 'sequence',
    steps: [
      {
        label: 'clean-checkout',
        backend: 'shell',
        prompt: originalCleanCheckout,
        completion_keyword: 'CHECKOUT_READY',
        expected_changes: [],
        timeout: 60,
      },
      {
        label: 'build-and-test',
        backend: 'shell',
        depends_on: ['clean-checkout'],
        prompt: 'printf \'BUILD_VERIFIED\\n\'',
        completion_keyword: 'BUILD_VERIFIED',
        expected_changes: [],
        timeout: 60,
      },
    ],
  });

  const { runDir, run, state } = runRecipe(base, 'original-contract-repro');

  assert.equal(run.outcome, 'failed');
  const step = run.steps.find((entry) => entry.label === 'clean-checkout');
  assert.equal(step.exit_code, 127);
  assert.equal(step.outcome, 'failed');
  assert.ok(
    step.warnings.includes('Completion policy was not satisfied'),
    `warnings: ${JSON.stringify(step.warnings)}`,
  );
  // The raw error is preserved verbatim in the run record, with the partial
  // toolchain output that preceded it.
  const stderr = readFileSync(path.join(runDir, 'clean-checkout.stderr'), 'utf8');
  assert.match(stderr, /pnpm: command not found/);
  const stdout = readFileSync(path.join(runDir, 'clean-checkout.stdout'), 'utf8');
  assert.match(stdout, /^v24\./);
  assert.match(stdout, /cargo 1\./);
  assert.doesNotMatch(stdout, /CHECKOUT_READY/);
  // The failed step blocks the rest of the recipe, as in production.
  assert.equal(state.steps['clean-checkout'].state, 'failed');
  assert.equal(state.steps['build-and-test'].state, 'pending');
});

test('fixed contract: the real recipe step resolves the pinned pnpm and the run goes green', t => {
  const fixedCleanCheckout = realRecipe.steps.find((step) => step.label === 'clean-checkout');
  const base = fixtureRepo(t, {
    name: 'fixed-contract-green',
    description: 'The real fixed clean-checkout contract plus a dependent step that uses the toolchain.',
    type: 'sequence',
    steps: [
      { ...fixedCleanCheckout, depends_on: undefined },
      {
        label: 'build-and-test',
        backend: 'shell',
        depends_on: ['clean-checkout'],
        prompt:
          'toolchain_env=$(sh scripts/recipe-toolchain.sh) && eval "$toolchain_env" ' +
          '&& mkdir -p evidence && pnpm --version > evidence/pnpm-version.txt && printf \'DOWNSTREAM_READY\\n\'',
        completion_keyword: 'DOWNSTREAM_READY',
        expected_changes: ['evidence/'],
        timeout: 60,
      },
    ],
  });

  const { runDir, run, state } = runRecipe(base, 'fixed-contract-green');

  assert.equal(run.outcome, 'ok', JSON.stringify(run, null, 2));
  const step = run.steps.find((entry) => entry.label === 'clean-checkout');
  assert.equal(step.exit_code, 0);
  // clean-checkout writes only gitignored toolchain paths against an empty
  // expected_changes boundary, so the runner books it as warn_bookkeeping
  // (work completed; nothing to commit). Either completed label is green.
  assert.ok(
    step.outcome === 'success' || step.outcome === 'warn_bookkeeping',
    `clean-checkout outcome: ${step.outcome}`,
  );
  const stdout = readFileSync(path.join(runDir, 'clean-checkout.stdout'), 'utf8');
  assert.match(stdout, /^v24\./, 'pinned Node 24 runtime used');
  assert.match(stdout, /cargo 1\./);
  assert.match(stdout, /^11\.19\.0$/m, 'packageManager-pinned pnpm resolved');
  assert.match(stdout, /CHECKOUT_READY/);
  assert.ok(existsSync(path.join(base, '.mentu/runtime/toolchain/node_modules/.bin/pnpm')));
  // A step that previously stayed pending now executes with the toolchain and
  // records success through the runner's real write-boundary machinery.
  assert.equal(state.steps['build-and-test'].state, 'success');
  assert.equal(
    readFileSync(path.join(base, 'evidence/pnpm-version.txt'), 'utf8').trim(),
    '11.19.0',
  );
  // expected_changes: [] stays truthful: the toolchain lives under gitignored paths.
  assert.equal(git(base, 'status', '--porcelain'), '', 'fixture tree must stay clean');
});
