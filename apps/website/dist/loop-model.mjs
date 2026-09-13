export function loopFrames(scenario = 'recover') {
  if (!['recover', 'pass', 'escalate'].includes(scenario)) throw new Error('Unknown scenario');
  const frames = [
    { node:'monitor', state:'pass', wire:'intake', title:'A signal enters the workspace.', text:'The PR monitor detects a review request. Its event reference enters the configured bot responsibility.' },
    { node:'bot', state:'pass', wire:'dispatch', title:'Context travels with the task.', text:'Sentinel matches the approved Atlas project and prepares a scoped brief. The event is data, not authority.' },
    { node:'build', state:'pass', wire:'verify', title:'Two scopes. Two harnesses.', text:'Codex implements the retry policy. Pi prepares failure-path tests in a separate session. Both inherit the same brief.' },
    { node:'adversary', state:scenario==='pass'?'pass':'fail', wire:'correction', title:scenario==='pass'?'The first check passes.':'The adversary finds a boundary failure.', text:scenario==='pass'?'The sample retry limit satisfies the specification. Code review still runs before human approval.':'Agy challenges the sample: 3 attempts exceed the specified limit of 2. The finding goes back into the workflow.' }
  ];
  if(scenario==='escalate') return [...frames, {node:'human',state:'blocked',wire:'handoff',title:'The budget ends. You decide.',text:'No correction is allowed in this scenario. The workflow stops with the failed check attached; approval remains locked.',verified:false}];
  frames.push({node:'reviewer',state:'pass',wire:scenario==='pass'?'handoff':'return',title:scenario==='pass'?'A second perspective reviews the change.':'The finding becomes a correction.',text:scenario==='pass'?'Claude Code reviews the sample changes and acceptance evidence before handoff.':'Claude Code applies the scripted correction: maxAttempts 3 → 2. The same verification runs again, without another human prompt.'});
  if(scenario!=='pass') frames.push({node:'adversary',state:'pass',wire:'handoff',title:'Same check. Corrected result.',text:'Agy re-runs the sample acceptance check. Two attempts satisfy the bound. The run retains both the failure and the passing result.'});
  frames.push({node:'human',state:'ready',title:'The evidence is ready. Your call.',text:'Review the changes and verification trail. Only your explicit approval completes this demo; no real branch is merged.',verified:true});
  return frames;
}
