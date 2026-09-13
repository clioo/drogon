import assert from 'node:assert/strict';
const { chromium } = await import(process.env.DROGON_WEBSITE_PLAYWRIGHT || 'playwright');
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.DROGON_WEBSITE_URL || 'http://127.0.0.1:4178/');
  await page.waitForFunction(() => document.querySelector('#story-title').textContent.includes('interruption'));
  assert.equal(await page.locator('img').count(), 0);
  await page.locator('[data-signal="ticket"]').click();
  assert.equal(await page.locator('#project-name').textContent(), 'Beacon API');
  assert.match(await page.locator('#signal-capability').textContent(), /Concept scenario/);
  await page.locator('#tab-dispatch').click();
  await page.locator('[data-session="tests"]').click();
  assert.match(await page.locator('#dispatch-prompt').textContent(), /PROJECT Beacon API/);
  assert.match(await page.locator('#dispatch-prompt').textContent(), /WRITE tests/);
  await page.locator('#dispatch-sessions').click();
  assert.ok(await page.locator('#dispatch-sessions').isDisabled());
  await page.locator('#tab-monitor').focus();
  await page.keyboard.press('ArrowRight');
  assert.ok(await page.locator('#scene-specify').isVisible());
  await page.locator('#tab-approve').click();
  assert.ok(await page.locator('#approve-result').isDisabled());
  await page.locator('#tab-verify').click();
  await page.locator('#run-checks').click();
  assert.equal(await page.locator('#retry-check').textContent(), 'FAIL');
  await page.locator('#tab-recover').click();
  await page.locator('#recovery-limit').selectOption('0');
  await page.locator('#run-recovery').click();
  assert.match(await page.locator('#recovery-message').textContent(), /Budget exhausted/);
  await page.locator('#tab-approve').click();
  assert.ok(await page.locator('#approve-result').isDisabled());
  await page.locator('#tab-recover').click();
  await page.locator('#recovery-limit').selectOption('1');
  await page.locator('#run-recovery').click();
  assert.match(await page.locator('#recovery-message').textContent(), /checks passed/);
  await page.locator('#tab-approve').click();
  await page.locator('#approve-result').click();
  assert.match(await page.locator('#approval-lock').textContent(), /Sample approved/);
  await page.locator('#story-reset').click();
  await page.locator('#play-story').click();
  await page.waitForFunction(() => document.querySelector('#story-position').textContent === '7 of 7', { timeout: 25000 });
  assert.equal(await page.locator('#final-verdict').textContent(), 'Checks passed');
  assert.ok(await page.locator('#approve-result').isEnabled());
  await page.locator('#story-reset').click();
  await page.locator('#play-story').click();
  await page.locator('#story-reset').click();
  await page.waitForTimeout(2800);
  assert.equal(await page.locator('#story-position').textContent(), '1 of 7');
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const stage of ['monitor', 'specify', 'context', 'dispatch', 'verify', 'recover', 'approve']) {
      await page.locator('#tab-' + stage).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), stage + ' overflow at ' + width);
    }
  }
  await page.locator('#story-reset').click();
  if (process.env.DROGON_WEBSITE_SCREENSHOTS) {
    const dir = process.env.DROGON_WEBSITE_SCREENSHOTS;
    await page.screenshot({ path: dir + '/story-desktop.png', fullPage: true, animations: 'disabled' });
    await page.locator('#tab-dispatch').click();
    await page.locator('#workspace').screenshot({ path: dir + '/story-dispatch.png', animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: dir + '/story-mobile.png', fullPage: true, animations: 'disabled' });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: dir + '/story-dark.png', fullPage: true, animations: 'disabled' });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: all seven stages, routing, session prompts, keyboard tabs, verification, recovery limits, approval, autoplay, reset cancellation, five viewport widths, zero images or page errors.');
} finally { if (browser) await browser.close(); }
