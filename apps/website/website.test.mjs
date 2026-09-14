import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { workflowSteps, monitorEvent } from './dist/product-demo-model.mjs';
const root = new URL('./dist/', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
test('all local assets and navigation targets resolve', async () => {
 for(const [,v] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if(v.startsWith('https:')||v==='#')continue;
  if(v.startsWith('#'))assert.ok(html.includes('id="'+v.slice(1)+'"'),v);
  else await access(new URL(v,root));
 }
 assert.doesNotMatch(html,/<img\b/);
});
test('the hero embeds the official product demo',()=>{
 assert.match(html,/<iframe[^>]+src="https:\/\/www\.youtube\.com\/embed\/jgnitCkmpKk"/);
 assert.match(html,/title="Stop Micromanaging AI Agents: Meet Drogon"/);
 assert.match(html,/<iframe[^>]+allowfullscreen/);
 assert.match(html,/href="https:\/\/youtu\.be\/jgnitCkmpKk"/);
});
test('three product views replace the invented diagram and rubric narrative',()=>{
 assert.equal((html.match(/role="tab"/g)||[]).length,3);
 for(const name of ['panel-bots','panel-graph','panel-evidence'])assert.ok(html.includes('id="'+name+'"'));
 assert.doesNotMatch(html,/loop-console|story-criterion|engineering-map|Your signals/);
 for(const label of ['Main agent','Implementation workers','Adversarial test','Code review','Repeat up to 2×','Last firing'])assert.ok(html.includes(label));
 assert.match(html,/MIT Copyright \(c\) 2026 Lovecast Inc/);
});
test('the restored execution sequence includes parallel work and a verification return',()=>{
 const steps=workflowSteps();
 assert.deepEqual(steps[1].active,['api','tests']);
 assert.deepEqual(steps.map(s=>s.kind),['PLAN','DISPATCH','CHECK','FAIL','RECOVER','VERIFY','REVIEW']);
 assert.equal(steps.at(-1).terminal,'review');
 assert.ok(!steps.some(s=>s.terminal==='approved'));
});
test('iteration cap blocks work; clean runs do not invent a failure',()=>{
 assert.equal(workflowSteps({limit:1}).at(-1).terminal,'blocked');
 assert.equal(workflowSteps({failure:false}).some(s=>s.kind==='FAIL'),false);
 assert.throws(()=>workflowSteps({limit:0}));
});
test('monitor approval and deduplication are preserved',()=>{
 assert.equal(monitorEvent({approved:false,handled:false}).work,false);
 const first=monitorEvent({approved:true,handled:false});
 assert.equal(first.handled,true);
 assert.equal(monitorEvent({approved:true,handled:first.handled}).state,'Already handled');
});
test('harness marks and sample boundaries remain explicit',()=>{
 for(const name of ['claude','codex','pi','agy'])assert.ok(html.includes('data-harness="'+name+'"'));
 assert.match(html,/Your agents. Your subscriptions/);
 assert.match(html,/Sample data/);
 assert.match(html,/nothing is committed or merged/);
});
