import { workflowSteps, monitorEvent } from './product-demo-model.mjs';
const el=id=>document.getElementById(id);
const tabs=[...document.querySelectorAll('.product-tabs [role=tab]')];
const nodes=[...document.querySelectorAll('[data-node]')];
const copy={bots:['Turn a signal into action.','Let a bot watch incoming pull requests and start a review session in the right project. Give it the responsibility once; inspect the work it returns.'],graph:['Build the workflow.\nLet agents run it.','Turn a complex build into coordinated work: a main agent, parallel implementation workers, and an adversarial test-and-review loop. Assign harnesses and models to each role. You decide what ships.'],evidence:['See what happened.\nThen make the call.','Follow the findings, corrections, and verification results in one place. Review the evidence, ask for changes, and decide when the work is ready.']};
let running=false, timer, index=0, autoStarted=false, handled=false;
let steps=workflowSteps();
let emptyEvidence=el('evidence-entries').innerHTML;
function selectTab(tab,focus=false){
  const key=tab.id.slice(4);if(key!=='graph')pause();
  tabs.forEach(t=>{const selected=t===tab;t.setAttribute('aria-selected',String(selected));t.tabIndex=selected?0:-1;el(t.getAttribute('aria-controls')).hidden=!selected;});
  el('feature-title').textContent=copy[key][0];el('feature-description').textContent=copy[key][1];
  if(focus)tab.focus();
}
tabs.forEach(tab=>{tab.addEventListener('click',()=>selectTab(tab));tab.addEventListener('keydown',e=>{const i=tabs.indexOf(tab),j={ArrowRight:(i+1)%3,ArrowLeft:(i+2)%3,Home:0,End:2}[e.key];if(j!==undefined){e.preventDefault();selectTab(tabs[j],true);}});});
document.querySelectorAll('[data-open-evidence]').forEach(b=>b.addEventListener('click',()=>selectTab(el('tab-evidence'))));
document.querySelectorAll('[data-open-graph]').forEach(b=>b.addEventListener('click',()=>selectTab(el('tab-graph'))));
el('show-usage').addEventListener('click',()=>{const open=el('usage-readout').hidden;el('usage-readout').hidden=!open;el('show-usage').setAttribute('aria-expanded',String(open));});
function pause(){clearTimeout(timer);running=false;el('graph-canvas').dataset.paused='true';el('run-workflow').textContent=index>=steps.length?'↻ Replay workflow':index?'▷ Resume workflow':'▷ Run workflow';}
function evidence(step){
  if(!['FAIL','RECOVER','VERIFY','REVIEW'].includes(step.kind))return;
  if(el('evidence-entries').querySelector('.evidence-empty'))el('evidence-entries').replaceChildren();
  const entry=document.createElement('article');entry.className='evidence-entry'+(step.kind==='FAIL'?' finding':'');
  const icon=document.createElement('span');icon.className='evidence-icon';icon.textContent=step.kind==='FAIL'?'◉':'✓';icon.setAttribute('aria-hidden','true');
  const body=document.createElement('div'),title=document.createElement('h4'),meta=document.createElement('small'),detail=document.createElement('p'),artifact=document.createElement('code');
  title.textContent={FAIL:'Retry limit exceeded',RECOVER:'Retry policy corrected',VERIFY:'Failure-path checks passed',REVIEW:'Ready to merge'}[step.kind];
  meta.textContent='Sample run · '+(step.kind==='FAIL'?'finding':'completed');detail.textContent=step.text;artifact.textContent=step.kind==='RECOVER'?'src/checkout/retry.ts':'tests/checkout-recovery.test.ts';
  body.append(title,meta,detail,artifact);entry.append(icon,body);el('evidence-entries').prepend(entry);
  document.querySelectorAll('.evidence-count').forEach(n=>n.textContent=String(el('evidence-entries').children.length));
}
function advance(){
  if(!running)return;const step=steps[index++];
  nodes.forEach(node=>{const key=node.dataset.node,source=key==='workers'?'api':key;const state=step.states[source];node.classList.toggle('is-active',step.active.includes(source));if(state){node.querySelector('.node-state').textContent=key==='merge'&&step.terminal==='review'?'Ready to merge':state;node.classList.toggle('has-failed',['Failed','Blocked'].includes(state));node.classList.toggle('is-complete',['Planned','Complete','Passed','Verified'].includes(state)||key==='merge'&&step.terminal==='review');}});
  document.querySelectorAll('[data-edge]').forEach(edge=>edge.classList.toggle('is-active',step.active.includes(edge.dataset.edge==='workers'?'api':edge.dataset.edge)));
  document.querySelector('.graph-return').classList.toggle('is-active',step.kind==='RECOVER'||step.kind==='VERIFY');
  el('workflow-status').textContent=step.text;evidence(step);
  if(step.terminal){pause();nodes.forEach(n=>n.classList.remove('is-active'));document.querySelector('.graph-return').classList.remove('is-active');}else timer=setTimeout(advance,1150);
}
function reset(){pause();index=0;steps=workflowSteps();nodes.forEach(n=>{n.classList.remove('is-active','has-failed','is-complete');n.querySelector('.node-state').textContent=n.dataset.node==='plan'?'Ready':n.dataset.node==='merge'?'Awaiting checks':'Queued';});document.querySelectorAll('[data-edge],.graph-return').forEach(e=>e.classList.remove('is-active'));el('workflow-status').textContent='Sample workflow · no agents connected';el('evidence-entries').innerHTML=emptyEvidence;el('evidence-entries').querySelector('[data-open-graph]').addEventListener('click',()=>selectTab(el('tab-graph')));document.querySelectorAll('.evidence-count').forEach(n=>n.textContent='');pause();}
function play(){if(index>=steps.length)reset();running=true;el('graph-canvas').dataset.paused='false';el('run-workflow').textContent='Ⅱ Pause workflow';advance();}
el('run-workflow').addEventListener('click',()=>{autoStarted=true;running?pause():play();});
el('reset-workflow').addEventListener('click',()=>{autoStarted=true;reset();});
el('play-monitor').addEventListener('click',()=>{const result=monitorEvent({approved:true,handled});handled=result.handled;el('monitor-firing').textContent='Prompt sent · now';el('monitor-count').textContent='1/10 delegations today';el('monitor-status').textContent=result.state==='Already handled'?'Duplicate skipped. The PR already has a session.':'PR #42 → Atlas Checkout · review session started.';el('play-monitor').textContent='Replay event ↻';});
const icons={bot:'<path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2m16 0h2M9 13v2m6-2v2"/>',users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',shield:'<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11"/>',file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm0 0v6h6M8 13h8m-8 4h6"/>',check:'<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>'};
document.querySelectorAll('[data-icon]').forEach(n=>{n.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+icons[n.dataset.icon]+'</svg>';});
emptyEvidence=el('evidence-entries').innerHTML;
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
new IntersectionObserver(entries=>{const visible=entries[0].isIntersecting;if(!visible&&running)pause();if(visible&&!autoStarted&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&!document.hidden){autoStarted=true;play();}},{threshold:.45}).observe(el('panel-graph'));
