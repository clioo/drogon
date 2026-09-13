import { loopFrames } from './loop-model.mjs';
const el = id => document.getElementById(id);
const root = el('loop-console');
const nodes = [...root.querySelectorAll('[data-loop-node]')];
const wires = [...root.querySelectorAll('[data-wire]')];
let frames, index = 0, timer, running = false, verified = false;
const descriptions = {
  monitor:['Monitor','A configured GitHub PR monitor supplies an event reference. This demo does not connect to GitHub.'],
  bot:['Sentinel · Claude Code','The bot maps the event to an approved project and creates scoped prompts. Harness assignments here are illustrative and configurable.'],
  build:['Codex + Pi · parallel sessions','Codex owns the implementation scope; Pi owns the test scope. Use your own configured accounts and provider access.'],
  adversary:['Agy · adversarial testing','Antigravity challenges the implementation against the brief. A failed check returns a concrete finding to the correction loop.'],
  reviewer:['Claude Code · review & correction','Review the finding, apply a bounded correction, and request verification again. The animation uses scripted sample results.'],
  human:['You · final review','Inspect the evidence and approve, or intervene when the recovery budget is exhausted. Drogon does not decide to merge for you.']
};
function inspect(node, title, text) {
  nodes.forEach(n=>n.setAttribute('aria-pressed',String(n.dataset.loopNode===node)));
  el('loop-inspector-label').textContent='Selected step';
  el('loop-inspector-title').textContent=title||descriptions[node][0];
  el('loop-inspector-text').textContent=text||descriptions[node][1];
}
function log(text) {
  const row=document.createElement('li');
  const count=document.createElement('span'); count.textContent=String(el('loop-log').children.length+1).padStart(2,'0');
  const message=document.createElement('span'); message.textContent=text;
  row.append(count,message); el('loop-log').append(row); el('loop-log').scrollTop=el('loop-log').scrollHeight;
}
function pause(){clearTimeout(timer);running=false;root.dataset.running='false';el('loop-play').textContent=index>=frames.length?'Replay the loop ↻':index?'Resume loop →':'Run the loop →';}
function advance(){
  if(!running)return;
  const frame=frames[index++];
  const node=nodes.find(n=>n.dataset.loopNode===frame.node);
  node.dataset.state=frame.state;
  node.querySelector('.node-status').textContent={pass:'Complete',fail:'Finding',ready:'Awaiting you',blocked:'Needs your input'}[frame.state];
  wires.forEach(w=>w.dataset.active=String(w.dataset.wire===frame.wire));
  inspect(frame.node,frame.title,frame.text);log(frame.title);
  el('loop-runtime').textContent=frame.title;
  if(frame.node==='adversary'){
    el('adversary-result').textContent=frame.state==='fail'?'FAIL · 3 attempts > limit 2':'PASS · 2 attempts ≤ limit 2';
    el('loop-iteration').textContent=`Verification ${index>5?2:1} / 2`;
  }
  if(frame.node==='reviewer')el('loop-patch').textContent=el('loop-scenario').value==='pass'?'Reviewed · maxAttempts: 2':'Applied · maxAttempts: 3 → 2';
  if(frame.node==='human'){
    verified=frame.verified===true;el('loop-approve').disabled=!verified;
    el('human-check').textContent=verified?'Passed':'Failed';el('human-changes').textContent=verified?'Ready':'Needs attention';
    el('human-note').textContent=verified?'Your approval is still required. Nothing has been merged.':'Recovery budget exhausted. Approval stays locked.';
    el('loop-announcement').textContent=verified?'Demo verification passed. Ready for your review.':'Demo stopped. Human intervention required.';
  }
  if(index>=frames.length){pause();wires.forEach(w=>w.dataset.active='false');}else timer=setTimeout(advance,1250);
}
function reset(){
  clearTimeout(timer);index=0;verified=false;frames=loopFrames(el('loop-scenario').value);pause();
  nodes.forEach(n=>{delete n.dataset.state;n.setAttribute('aria-pressed','false');n.querySelector('.node-status').textContent=n.dataset.loopNode==='monitor'?'Watching':'Queued';});
  wires.forEach(w=>w.dataset.active='false');el('loop-log').replaceChildren();
  el('loop-approve').disabled=true;el('loop-approve').textContent='Review & approve sample ↗';
  el('human-check').textContent='Pending';el('human-changes').textContent='Pending';
  el('human-note').textContent='Approval unlocks only after checks pass.';
  el('adversary-result').textContent='retry-limit.test · awaiting work';el('loop-patch').textContent='Awaiting verification';
  el('loop-iteration').textContent='Verification 0 / 2';el('loop-runtime').textContent='Ready to receive a signal';
  el('loop-inspector-title').textContent='Your harnesses. One workflow.';
  el('loop-inspector-text').textContent='Run the sample to follow the handoffs. Select any node to inspect its role and harness.';
  el('loop-announcement').textContent='Interactive illustration. No agents or external services are connected.';
}
el('loop-play').addEventListener('click',()=>{if(running){pause();return;}if(index>=frames.length)reset();running=true;root.dataset.running='true';el('loop-play').textContent='Pause loop Ⅱ';advance();});
el('loop-reset').addEventListener('click',reset);el('loop-scenario').addEventListener('change',reset);
nodes.forEach(n=>n.addEventListener('click',()=>inspect(n.dataset.loopNode)));
el('loop-approve').addEventListener('click',()=>{if(!verified)return;el('loop-approve').disabled=true;el('loop-approve').textContent='Sample approved ✓';nodes.find(n=>n.dataset.loopNode==='human').dataset.state='pass';el('loop-announcement').textContent='Sample approved. No real branch or pull request was changed.';log('Human approved the sample result.');});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
new IntersectionObserver(entries=>{if(!entries[0].isIntersecting&&running)pause();},{threshold:0}).observe(root);
reset();
