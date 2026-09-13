export function workflowSteps({ failure = true, limit = 2 } = {}) {
  if (typeof failure !== 'boolean' || ![1, 2].includes(limit)) throw new Error('Invalid sample policy');
  const steps = [
    { kind: 'PLAN', text: 'Main agent scopes the task.', active: ['plan'], states: { plan: 'Planning' } },
    { kind: 'DISPATCH', text: 'Implementation workers run in parallel.', active: ['api', 'tests'], states: { plan: 'Planned', api: 'Working', tests: 'Working' } },
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
  steps.push({ kind: 'REVIEW', text: 'Ready to merge. Review the evidence before shipping.', active: ['merge'], states: { merge: 'Awaiting you' }, terminal: 'review' });
  return steps;
}

export function monitorEvent({ approved, handled }) {
  if (!approved) return { handled, state: 'Awaiting approval', message: 'Event held. Approve the monitor before it can release work.', work: handled };
  if (handled) return { handled: true, state: 'Already handled', message: 'Duplicate skipped. Pull request #42 already has a review workspace.', work: true };
  return { handled: true, state: 'Review queued', message: 'Sample event accepted. A review worktree and session are prepared below.', work: true };
}
