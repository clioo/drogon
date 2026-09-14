import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
const { chromium } = await import(process.env.DROGON_WEBSITE_PLAYWRIGHT || 'playwright');
const profile = await mkdtemp(join(tmpdir(), 'drogon-loop-cdp-'));
const child = spawn(chromium.executablePath(), ['--headless', '--no-sandbox', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], {stdio:['ignore','ignore','pipe']});
let browser;
try {
  const endpoint = await new Promise((resolve,reject)=>{
    let output=''; const timeout=setTimeout(()=>reject(new Error('CDP launch timeout')),15000);
    child.stderr.on('data', chunk=>{output+=chunk;const match=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
    child.once('error',error=>{clearTimeout(timeout);reject(error);});
  });
  browser=await chromium.connectOverCDP(endpoint);
  const page=await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce'});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
  await page.route('https://www.youtube.com/**',route=>route.abort());
  await page.goto(process.env.DROGON_WEBSITE_URL || 'http://127.0.0.1:4178/');
  const demoFrame=page.locator('.hero-video iframe');
  assert.equal(await demoFrame.getAttribute('src'),'https://www.youtube.com/embed/jgnitCkmpKk');
  assert.equal(await demoFrame.getAttribute('title'),'Stop Micromanaging AI Agents: Meet Drogon');
  const demoBox=await page.locator('.hero-video-frame').boundingBox();
  assert.ok(demoBox&&Math.abs(demoBox.width/demoBox.height-16/9)<0.02,'hero video keeps a 16:9 ratio');
  if(process.env.DROGON_WEBSITE_SCREENSHOTS)await page.locator('.hero').screenshot({path:join(process.env.DROGON_WEBSITE_SCREENSHOTS,'drogon-hero-video.png'),animations:'disabled'});
  await page.locator('#install').scrollIntoViewIfNeeded();
  assert.match(await page.locator('#release-version').innerText(),/^v\d+\.\d+\.\d+/);
  assert.match(await page.locator('#install .button').getAttribute('href'),/\/releases\/tag\/v\d+\.\d+\.\d+/);
  assert.match(await page.locator('#install-command').innerText(),/brew tap clioo\/drogon && brew install --cask clioo\/drogon\/drogon/);
  await page.click('#copy-command');
  await page.waitForFunction(()=>document.getElementById('copy-status').textContent.length>0);
  assert.match(await page.locator('#copy-status').innerText(),/copied|manually/);
  await page.locator('#workspace').scrollIntoViewIfNeeded();
  await page.clock.install();
  assert.equal(await page.locator('[data-node] .harness-badge').count(),5);
  assert.equal(await page.locator('[role=tabpanel]:visible').count(),1);
  await page.click('#run-workflow');
  await page.clock.runFor(1250);
  assert.equal(await page.locator('[data-node=workers].is-active').count(),1);
  await page.click('#run-workflow');
  const paused=await page.locator('#workflow-status').innerText();
  await page.clock.runFor(3000);
  assert.equal(await page.locator('#workflow-status').innerText(),paused);
  await page.click('#run-workflow');
  await page.clock.runFor(1250);
  assert.equal(await page.locator('[data-node=test].has-failed').count(),1);
  await page.clock.runFor(1200);
  assert.equal(await page.locator('.graph-return.is-active').count(),1);
  if(process.env.DROGON_WEBSITE_SCREENSHOTS)await page.locator('.product-layout').screenshot({path:join(process.env.DROGON_WEBSITE_SCREENSHOTS,'drogon-real-widgets.png'),animations:'disabled'});
  await page.clock.runFor(4000);
  assert.match(await page.locator('[data-node=merge]').innerText(),/Ready to merge/);
  await page.click('#panel-graph [data-open-evidence]');
  assert.equal(await page.locator('.evidence-entry').count(),4);
  assert.match(await page.locator('.evidence-entry').first().innerText(),/Ready to merge/);
  await page.click('#tab-bots');
  await page.click('#play-monitor');
  assert.equal(await page.locator('#monitor-firing').innerText(),'Prompt sent · now');
  await page.click('#play-monitor');
  assert.match(await page.locator('#monitor-status').innerText(),/Duplicate skipped/);
  await page.locator('#tab-bots').focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#tab-graph').getAttribute('aria-selected'),'true');
  await page.click('#reset-workflow');
  assert.equal(await page.locator('[data-node].is-active').count(),0);
  await page.click('#show-usage');
  assert.match(await page.locator('#usage-readout').innerText(),/No models/);
  await page.click('#show-usage');
  for(const width of [320,390,768,884,1024,1440]){
   await page.setViewportSize({width,height:1100});
   for(const tab of ['bots','graph','evidence']){
    await page.click('#tab-'+tab);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,tab+' fits '+width);
    const overflow=await page.locator('#panel-'+tab).evaluate(root=>[...root.querySelectorAll('.app-node,.monitor-card')].some(n=>n.scrollWidth>n.clientWidth+2));
    assert.equal(overflow,false,'widget text fits '+width);
   }
  }
  await page.setViewportSize({width:390,height:1000});await page.click('#tab-graph');
  if(process.env.DROGON_WEBSITE_SCREENSHOTS)await page.locator('#panel-graph').screenshot({path:join(process.env.DROGON_WEBSITE_SCREENSHOTS,'drogon-real-widgets-mobile.png'),animations:'disabled'});
  assert.deepEqual(errors,[]);
  console.log('PASS: source-derived widgets, restored graph animation, pause/reset, failure/recovery, evidence, monitor deduplication, keyboard tabs, six widths, no asset or runtime errors.');
} finally {
  await browser?.close();
  if(child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await Promise.race([exited,new Promise(r=>setTimeout(r,3000))]);}
  if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'exit');}
  await rm(profile,{recursive:true,force:true});
  console.log(`Test-owned Chromium PID ${child.pid}: exited (${child.exitCode ?? child.signalCode}).`);
}
