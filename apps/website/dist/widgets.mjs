import { worktrees, nodeDetails, workflowSteps, monitorEvent } from './demo-model.mjs';

const byId = id => document.getElementById(id);
const nodes = [...document.querySelectorAll('[data-node]')];
let runToken = 0;
let running = false;
let terminal = null;
let handled = false;
let timer;

function chooseTree(key) {
  const tree = worktrees[key];
  if (!tree) throw new Error('Unknown sample worktree');
  document.querySelectorAll('[data-tree]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tree === key)));
  byId('demo-file').textContent = tree.file;
  byId('diff-stat').textContent = tree.stat;
  byId('demo-harness').textContent = tree.harness;
  byId('agent-monogram').textContent = tree.initial;
  byId('workspace-explanation').textContent = tree.description;
  byId('code-preview').replaceChildren(...tree.lines.map(([kind, text], index) => {
    const row = document.createElement('span');
    row.className = `code-line ${kind}`;
    const number = document.createElement('span');
    number.className = 'line-number';
    number.setAttribute('aria-hidden', 'true');
    number.textContent = String(index + 1).padStart(2, '0');
    const code = document.createElement('code');
    code.textContent = `${kind === 'add' ? '+' : kind === 'remove' ? '−' : ' '} ${text}`;
    row.append(number, code);
    return row;
  }));
}
document.querySelectorAll('[data-tree]').forEach(button => button.addEventListener('click', () => chooseTree(button.dataset.tree)));
chooseTree('auth');

function inspectNode(key) {
  const detail = nodeDetails[key];
  if (!detail) throw new Error('Unknown graph node');
  nodes.forEach(node => node.setAttribute('aria-pressed', String(node.dataset.node === key)));
  byId('node-title').textContent = detail[0];
  byId('node-description').textContent = detail[1];
}
nodes.forEach(node => node.addEventListener('click', () => inspectNode(node.dataset.node)));

function appendEvidence(kind, text) {
  const row = document.createElement('li');
  const label = document.createElement('span');
  label.className = 'evidence-kind';
  label.textContent = kind;
  const message = document.createElement('span');
  message.textContent = text;
  row.append(label, message);
  byId('evidence-log').append(row);
  byId('evidence-log').scrollTop = byId('evidence-log').scrollHeight;
}

function setRunning(value) {
  running = value;
  byId('run-demo').disabled = value;
  byId('inject-failure').disabled = value;
  byId('iteration-limit').disabled = value;
  byId('run-demo').firstChild.textContent = value ? 'Running sample… ' : 'Run sample workflow ';
}

function resetWorkflow() {
  runToken += 1;
  clearTimeout(timer);
  terminal = null;
  setRunning(false);
  byId('approve-demo').hidden = true;
  byId('evidence-log').replaceChildren();
  appendEvidence('INTENT', 'Workflow ready. No agent or model is connected.');
  byId('run-status').textContent = 'Ready. Run the sample or inspect a node.';
  nodes.forEach(node => {
    node.classList.remove('is-active', 'has-failed', 'is-complete');
    node.querySelector('.node-state').textContent = node.dataset.node === 'plan' ? 'Ready' : node.dataset.node === 'merge' ? 'Waiting' : 'Queued';
  });
}

function runWorkflow() {
  if (running) return;
  resetWorkflow();
  const token = runToken;
  const steps = workflowSteps({ failure: byId('inject-failure').checked, limit: Number(byId('iteration-limit').value) });
  setRunning(true);
  let index = 0;
  function advance() {
    if (token !== runToken) return;
    const step = steps[index++];
    for (const node of nodes) {
      const state = step.states[node.dataset.node];
      node.classList.toggle('is-active', step.active.includes(node.dataset.node));
      if (state) {
        node.querySelector('.node-state').textContent = state;
        node.classList.toggle('has-failed', ['Failed', 'Blocked'].includes(state));
        node.classList.toggle('is-complete', ['Complete', 'Planned', 'Passed', 'Verified'].includes(state));
      }
    }
    appendEvidence(step.kind, step.text);
    byId('run-status').textContent = step.text;
    if (step.terminal) {
      terminal = step.terminal;
      setRunning(false);
      byId('approve-demo').hidden = terminal !== 'review';
    } else timer = setTimeout(advance, 750);
  }
  advance();
}
byId('run-demo').addEventListener('click', runWorkflow);
byId('reset-demo').addEventListener('click', resetWorkflow);
byId('inject-failure').addEventListener('change', resetWorkflow);
byId('iteration-limit').addEventListener('change', resetWorkflow);
byId('approve-demo').addEventListener('click', () => {
  if (terminal !== 'review' || running) return;
  terminal = 'approved';
  const merge = document.querySelector('[data-node="merge"]');
  merge.classList.remove('is-active');
  merge.classList.add('is-complete');
  merge.querySelector('.node-state').textContent = 'Approved';
  byId('approve-demo').hidden = true;
  byId('run-status').textContent = 'Demo approved. No real branch or pull request was changed.';
  appendEvidence('HUMAN', 'You approved the sample result. The real merge remains outside this demo.');
});

byId('approve-monitor').addEventListener('change', () => {
  byId('bot-state').textContent = byId('approve-monitor').checked ? handled ? 'Already handled' : 'Watching' : 'Awaiting approval';
  byId('bot-result').textContent = byId('approve-monitor').checked ? 'Monitor approved. You can simulate a pull-request event.' : 'Monitor paused. New events cannot release work.';
});
byId('simulate-event').addEventListener('click', () => {
  const result = monitorEvent({ approved: byId('approve-monitor').checked, handled });
  handled = result.handled;
  byId('bot-state').textContent = result.state;
  byId('bot-result').textContent = result.message;
  byId('bot-work').hidden = !result.work;
});
byId('reset-bot').addEventListener('click', () => {
  handled = false;
  byId('approve-monitor').checked = false;
  byId('bot-state').textContent = 'Awaiting approval';
  byId('bot-result').textContent = 'No event received.';
  byId('bot-work').hidden = true;
});
window.addEventListener('pagehide', () => { runToken += 1; clearTimeout(timer); setRunning(false); });
