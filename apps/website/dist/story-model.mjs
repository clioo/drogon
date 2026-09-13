export const scenarios = {
  pr: { label: 'PR #42', type: 'review_requested', title: 'Review the checkout retry policy', description: 'A pull request is waiting for review in atlas/checkout.', repository: 'atlas/checkout', resource: 'pull/42', project: 'Atlas Checkout', path: 'projects/atlas-checkout', initial: 'A', supported: true },
  ticket: { label: 'Issue #108', type: 'issue.assigned', title: 'Bound retries in the billing API', description: 'A ticket describes repeated billing attempts after a timeout.', repository: 'beacon/api', resource: 'issue/108', project: 'Beacon API', path: 'projects/beacon-api', initial: 'B', supported: false },
  comment: { label: 'Comment #81', type: 'review.comment', title: 'The timeout path still needs a test', description: 'A reviewer asks for failure-path coverage on a checkout change.', repository: 'atlas/checkout', resource: 'comment/81', project: 'Atlas Checkout', path: 'projects/atlas-checkout', initial: 'A', supported: false },
  mention: { label: 'Mention #42', type: 'bot.mentioned', title: '@sentinel investigate the retry failure', description: 'A thread mentions the bot with a request to inspect a failed check.', repository: 'atlas/checkout', resource: 'mention/42', project: 'Atlas Checkout', path: 'projects/atlas-checkout', initial: 'A', supported: false },
};
export const stages = [
  { id: 'monitor', criterion: 'Event-driven work', title: 'A signal.\nNot another interruption.', description: 'The bot recognizes an event, matches the configured project, and prepares scoped work. A useful signal becomes a handoff, not another notification.', outcome: 'You define the responsibility. The monitor supplies the trigger.' },
  { id: 'specify', criterion: 'Intent + specification', title: 'Give the work\na definition of done.', description: 'Before a session starts building, make the requirement, constraints, architecture, and acceptance criteria durable. Every worker gets the same destination.', outcome: 'The brief is the contract. A longer prompt is not the system.' },
  { id: 'context', criterion: 'Context engineering', title: 'Carry the context.\nLeave the noise.', description: 'The receiving session gets the relevant specification, repository instructions, diff, and evidence. Unrelated projects and untrusted inbox content stay out of the instruction layer.', outcome: 'The right context is a deliberate boundary, not the entire history.' },
  { id: 'dispatch', criterion: 'Orchestration + parallel work', title: 'The right project.\nThe right sessions.', description: 'The bot prepares focused prompts for scoped sessions. Implementation and failure-path tests can progress in separate worktrees, then meet at a shared verification gate.', outcome: 'Parallelism has a reason: separate writes, independent work, explicit integration.' },
  { id: 'verify', criterion: 'Harness + backpressure', title: 'A failing check\nchanges the next action.', description: 'Completion needs a machine-readable result. Run the sample checks: a retry limit of three violates the specification. The gate holds the result for correction.', outcome: 'Build → verify → observe. A failed check is feedback, not a footnote.' },
  { id: 'recover', criterion: 'Autonomous loops + recovery', title: 'Fix. Recheck.\nKnow when to stop.', description: 'The feedback points to a bounded correction. In this scripted example, the retry limit changes and the same checks run again. An exhausted budget escalates to the engineer.', outcome: 'Reliable autonomy has a stopping condition. It does not just keep trying.' },
  { id: 'approve', criterion: 'Human as orchestrator', title: 'You keep\nthe final call.', description: 'Inspect the intent, the changes, and the result of verification. Agents handle the repetitive handoffs; the engineer decides whether the integrated work is ready.', outcome: 'A passing test informs judgment. It does not replace it.' },
];
export function initialState(signal = 'pr') {
  if (!scenarios[signal]) throw new Error('Unknown signal');
  return { signal, project: scenarios[signal].project, stage: 0, dispatched: false, attempts: 3, checked: false, scopePassed: false, verified: false, recovered: false, approved: false, blocked: false };
}
export function verify(state) {
  const scopePassed = state.project === scenarios[state.signal]?.project;
  return { ...state, checked: true, scopePassed, verified: scopePassed && state.attempts <= 2 && state.attempts > 0, approved: false, blocked: false };
}
export function recover(state, budget) {
  if (!state.checked || state.verified) return state;
  if (budget === 0) return { ...state, blocked: true, approved: false };
  if (budget !== 1) throw new Error('Invalid recovery budget');
  return { ...verify({ ...state, attempts: 2 }), recovered: true };
}
export function approve(state) {
  if (!state.verified || state.blocked) throw new Error('Verification required');
  return { ...state, approved: true };
}
export function sessionPrompt(signal, session) {
  const item = scenarios[signal];
  if (!item || !['implementation', 'tests'].includes(session)) throw new Error('Invalid session context');
  return `PROJECT ${item.project}\nEVENT ${item.resource}\nGOAL ${session === 'implementation' ? 'Correct the bounded retry policy.' : 'Verify the timeout and retry-limit paths.'}\nREAD brief.md, repository instructions, scoped diff.\nWRITE ${session === 'implementation' ? 'src/checkout/retry.ts' : 'tests/checkout-recovery.test.ts'} only.\nRETURN ${session === 'implementation' ? 'diff + verification evidence.' : 'failure-path tests + findings.'}`;
}
