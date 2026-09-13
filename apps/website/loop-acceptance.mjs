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
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
  await page.goto(process.env.DROGON_WEBSITE_URL || 'http://127.0.0.1:4178/');
  await page.locator('#method').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('[data-loop-node] .harness-badge').count(),5);
  assert.equal(await page.locator('.harness-roster .harness-badge').count(),4);
  await page.clock.install();
  for(const scenario of ['recover','pass','escalate']){
    await page.selectOption('#loop-scenario',scenario);
    await page.click('#loop-play');
    await page.clock.runFor(2500);
    await page.click('#loop-play');
    const history=await page.locator('#loop-log li').count();
    await page.clock.runFor(2500);
    assert.equal(await page.locator('#loop-log li').count(),history,'pause holds state');
    await page.click('#loop-play');
    await page.clock.runFor(11000);
    assert.equal(await page.locator('#loop-approve').isEnabled(),scenario!=='escalate');
    if(scenario==='recover'){
      await page.click('#loop-approve');
      assert.match(await page.locator('#loop-announcement').innerText(),/Sample approved/);
    }
    await page.click('#loop-reset');
    assert.equal(await page.locator('#loop-approve').isEnabled(),false);
    assert.equal(await page.locator('#loop-log li').count(),0);
  }
  for(const width of [320,390,768,884,1024,1440]){
    await page.setViewportSize({width,height:1100});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`no overflow at ${width}`);
  }
  await page.setViewportSize({width:1440,height:1100});
  await page.selectOption('#loop-scenario','recover');await page.click('#loop-play');await page.clock.runFor(9000);
  if(process.env.DROGON_WEBSITE_SCREENSHOTS) await page.locator('#method').screenshot({path:join(process.env.DROGON_WEBSITE_SCREENSHOTS,'drogon-harness-loop.png'),animations:'disabled'});
  assert.deepEqual(errors,[]);
  console.log('PASS: CDP mixed-harness icons; recovery/pass/escalation; pause/reset/approval; six viewport widths; no runtime or asset errors.');
} finally {
  await browser?.close();
  if(child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await Promise.race([exited,new Promise(r=>setTimeout(r,3000))]);}
  if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'exit');}
  await rm(profile,{recursive:true,force:true});
  console.log(`Test-owned Chromium PID ${child.pid}: exited (${child.exitCode ?? child.signalCode}).`);
}
