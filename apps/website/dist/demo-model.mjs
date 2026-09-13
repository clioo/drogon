export const worktrees = {
  auth: { file: 'src/auth/session.ts', branch: 'feat/session-guard', harness: 'Claude Code', initial: 'C', stat: '+4 −1', description: 'Adding a session guard in an isolated worktree.', lines: [['context', 'export function requireSession(request) {'], ['remove', '  return request.session;'], ['add', '  const session = request.session;'], ['add', '  if (!session) throw new Unauthorized();'], ['add', '  return session;'], ['context', '}']] },
  api: { file: 'src/api/retry.ts', branch: 'fix/retry-policy', harness: 'Pi', initial: 'P', stat: '+3 −1', description: 'Bounding retries without touching the authentication branch.', lines: [['context', 'export async function checkout(input) {'], ['remove', '  return charge(input);'], ['add', '  return retry(() => charge(input), {'], ['add', '    attempts: 2, backoff: 250'], ['add', '  });'], ['context', '}']] },
  tests: { file: 'tests/recovery.test.ts', branch: 'test/failover', harness: 'OpenCode', initial: 'O', stat: '+5 −0', description: 'Testing the failure path in a separate branch.', lines: [['add', 'test("stops at the retry limit", async () => {'], ['add', '  const charge = failingGateway();'], ['add', '  await expect(checkout(charge)).rejects.toThrow();'], ['add', '  expect(charge).toHaveBeenCalledTimes(2);'], ['add', '});']] },
};

export const nodeDetails = {
  plan: ['Main agent', 'Turns the intent into scoped work and coordinates implementation workers.'],
  api: ['API worker', 'Works on the retry policy in its own Git worktree. Its changes do not alter the test worker’s branch.'],
  tests: ['Test worker', 'Builds failure-path checks in parallel with implementation, using a separate worktree.'],
  test: ['Adversarial test', 'Tries to break the result. A failed check holds the workflow instead of silently declaring success.'],
  review: ['Code review', 'Inspects the finding, fixes the issue, and verifies it within the configured iteration bound.'],
  merge: ['Human review', 'The sample pauses here. Evidence is available, but approval remains an explicit human decision.'],
};

export function workflowSteps({ failure = true, limit = 2 } = {}) {
  if (typeof failure !== 'boolean' || ![1, 2].includes(limit)) throw new Error('Invalid sample policy');
  const steps = [
    { kind: 'PLAN', text: 'Main agent reads the brief and scopes two worktrees.', active: ['plan'], states: { plan: 'Planning' } },
    { kind: 'DISPATCH', text: 'API and test workers run in isolated branches.', active: ['api', 'tests'], states: { plan: 'Planned', api: 'Working', tests: 'Working' } },
    { kind: 'CHECK', text: 'Implementation is ready for adversarial verification.', active: ['test'], states: { api: 'Complete', tests: 'Complete', test: 'Testing' } },
  ];
  if (failure) {
    steps.push({ kind: 'FAIL', text: 'Iteration 1: retry-limit check failed. Progress is held.', active: ['test'], states: { test: 'Failed' } });
    if (limit === 1) {
      steps.push({ kind: 'BLOCKED', text: 'Iteration limit reached. Human intervention required; approval is unavailable.', active: ['review'], states: { review: 'Blocked', merge: 'Blocked' }, terminal: 'blocked' });
      return steps;
    }
    steps.push({ kind: 'RECOVER', text: 'Code review corrects the retry bound in the sample.', active: ['review'], states: { review: 'Fixing' } });
    steps.push({ kind: 'VERIFY', text: 'Iteration 2: the corrected retry-limit check passes.', active: ['test'], states: { test: 'Passed', review: 'Verified' } });
  } else {
    steps.push({ kind: 'PASS', text: 'Iteration 1: the sample checks pass. Code review verifies the result.', active: ['review'], states: { test: 'Passed', review: 'Verified' } });
  }
  steps.push({ kind: 'REVIEW', text: 'Evidence is ready. Waiting for your approval; nothing has been merged.', active: ['merge'], states: { merge: 'Awaiting you' }, terminal: 'review' });
  return steps;
}

export function monitorEvent({ approved, handled }) {
  if (!approved) return { handled, state: 'Awaiting approval', message: 'Event held. Approve the monitor before it can release work.', work: handled };
  if (handled) return { handled: true, state: 'Already handled', message: 'Duplicate skipped. Pull request #42 already has a review workspace.', work: true };
  return { handled: true, state: 'Review queued', message: 'Sample event accepted. A review worktree and session are prepared below.', work: true };
}
