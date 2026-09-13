import { scenarios, stages, initialState, verify, recover, approve, sessionPrompt } from './story-model.mjs';
const el = id => document.getElementById(id);
const tabs = [...document.querySelectorAll('[data-stage]')];
let state = initialState();
let selectedSession = 'implementation';
let playing = false;
let timer;

function stopStory() {
  clearTimeout(timer);
  playing = false;
  el('play-story').firstChild.textContent = 'Play the story ';
}
function setStage(stage, focus = false) {
  if (!Number.isInteger(stage) || stage < 0 || stage >= stages.length) return;
  state.stage = stage;
  render();
  if (focus) tabs[stage].focus();
}
function chooseSignal(signal) {
  stopStory();
  state = initialState(signal);
  selectedSession = 'implementation';
  el('recovery-limit').value = '1';
  render();
}
function runChecks() { state = verify(state); render(); }
function runRecovery() { state = recover(state, Number(el('recovery-limit').value)); render(); }

function render() {
  const scenario = scenarios[state.signal], stage = stages[state.stage];
  tabs.forEach((tab, i) => {
    tab.setAttribute('aria-selected', String(i === state.stage));
    tab.tabIndex = i === state.stage ? 0 : -1;
    el(`scene-${stages[i].id}`).hidden = i !== state.stage;
  });
  el('story-panel').setAttribute('aria-labelledby', tabs[state.stage].id);
  el('story-criterion').textContent = stage.criterion;
  el('story-title').textContent = stage.title;
  el('story-description').textContent = stage.description;
  el('story-outcome').textContent = stage.outcome;
  el('story-position').textContent = `${state.stage + 1} of ${stages.length}`;
  el('story-back').disabled = state.stage === 0;
  el('story-next').disabled = state.stage === stages.length - 1;
  document.querySelectorAll('[data-signal]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.signal === state.signal)));
  for (const [id, value] of Object.entries({ 'signal-label': scenario.label, 'event-type': scenario.type, 'event-title': scenario.title, 'event-description': scenario.description, 'event-repo': `${scenario.repository} · ${scenario.resource}`, 'project-initial': scenario.initial, 'project-name': scenario.project, 'project-path': scenario.path, 'dispatch-project': `${scenario.project} / scoped sessions`, 'final-project': scenario.project })) el(id).textContent = value;
  el('signal-capability').textContent = scenario.supported ? 'PR monitoring and project-scoped session dispatch are implemented. This is a scripted illustration, not a live connection.' : 'Concept scenario: this ticket/comment/mention adapter has not been verified in the reviewed build. The routing interaction illustrates the intended workflow.';
  document.querySelectorAll('[data-session]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.session === selectedSession)));
  el('prompt-session').textContent = `Prompt → ${selectedSession === 'implementation' ? 'implementation' : 'verification'} session`;
  el('dispatch-prompt').textContent = sessionPrompt(state.signal, selectedSession);
  document.querySelector('.prompt-packet>div>span').textContent = state.dispatched ? 'Delivered in demo' : 'Prepared';
  el('dispatch-sessions').disabled = state.dispatched;
  el('dispatch-sessions').firstChild.textContent = state.dispatched ? 'Sample prompts delivered ' : 'Dispatch sample prompts ';
  el('run-checks').disabled = !state.dispatched;
  el('retry-check').textContent = state.checked ? state.verified ? 'PASS' : 'FAIL' : 'Not run';
  el('retry-check').className = state.checked ? state.verified ? 'passed' : 'failed' : '';
  el('scope-check').textContent = state.checked ? state.scopePassed ? 'PASS' : 'FAIL' : 'Not run';
  el('scope-check').className = state.checked ? state.scopePassed ? 'passed' : 'failed' : '';
  el('check-output').textContent = state.checked ? `assert(maxAttempts <= 2)\nexpected: ≤ 2\nreceived: ${state.attempts}\n\n${state.verified ? 'PASS · acceptance gate satisfied' : 'FAIL · hold for correction; do not approve'}` : state.dispatched ? 'Run the browser fixture to inspect the result.' : 'Dispatch the sample prompts first, then run verification.';
  el('recovery-message').textContent = !state.checked ? 'Run verification first. A failure gives the loop something specific to fix.' : state.blocked ? 'Budget exhausted. Stopped for human intervention; no approval is available.' : state.recovered ? 'Correction applied. The same checks passed on re-run. No additional instruction is needed inside this scripted loop.' : 'The retry limit exceeds the specification. Apply one correction, then run the same checks again.';
  el('run-recovery').disabled = !state.checked || state.verified;
  el('final-verdict').textContent = state.blocked ? 'Escalated' : state.verified ? 'Checks passed' : 'Not verified';
  el('final-verdict').className = state.verified ? 'passed' : '';
  el('approve-result').disabled = !state.verified || state.blocked || state.approved;
  el('approval-lock').textContent = state.approved ? 'Sample approved. No real branch or pull request was changed.' : state.verified ? 'The sample checks pass. Review the workstreams, then make the call.' : 'Run the checks and close the recovery loop before approving.';
  el('story-run-state').textContent = state.approved ? 'Sample approved · no real merge' : playing ? 'Playing a scripted story · no connected agents' : 'Scripted demo · no connected agents';
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => { stopStory(); setStage(index); });
  tab.addEventListener('keydown', event => {
    const target = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
    if (target !== undefined) { event.preventDefault(); stopStory(); setStage(target, true); }
  });
});
document.querySelectorAll('[data-signal]').forEach(b => b.addEventListener('click', () => chooseSignal(b.dataset.signal)));
document.querySelectorAll('[data-hero-signal]').forEach(a => a.addEventListener('click', () => chooseSignal(a.dataset.heroSignal)));
document.querySelectorAll('[data-session]').forEach(b => b.addEventListener('click', () => { selectedSession = b.dataset.session; render(); }));
el('story-back').addEventListener('click', () => { stopStory(); setStage(state.stage - 1); });
el('story-next').addEventListener('click', () => { stopStory(); setStage(state.stage + 1); });
el('run-checks').addEventListener('click', () => { stopStory(); runChecks(); });
el('dispatch-sessions').addEventListener('click', () => { state.dispatched = true; render(); });
el('run-recovery').addEventListener('click', () => { stopStory(); runRecovery(); });
el('approve-result').addEventListener('click', () => { state = approve(state); render(); });
el('story-reset').addEventListener('click', () => chooseSignal(state.signal));
el('play-story').addEventListener('click', () => {
  if (playing) { stopStory(); render(); return; }
  const budget = el('recovery-limit').value;
  state = initialState(state.signal);
  playing = true;
  el('recovery-limit').value = budget;
  el('play-story').firstChild.textContent = 'Pause story ';
  render();
  function advance() {
    if (!playing) return;
    state.stage += 1;
    if (state.stage === 3) state.dispatched = true;
    if (state.stage === 4) state = verify(state);
    if (state.stage === 5) state = recover(state, Number(el('recovery-limit').value));
    if (state.stage === 6) stopStory();
    render();
    if (playing) timer = setTimeout(advance, 2600);
  }
  timer = setTimeout(advance, 2600);
});
window.addEventListener('pagehide', stopStory);
render();
