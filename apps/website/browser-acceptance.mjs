import assert from 'node:assert/strict';
const { chromium } = await import(process.env.DROGON_WEBSITE_PLAYWRIGHT || 'playwright');
const url = process.env.DROGON_WEBSITE_URL || 'http://127.0.0.1:4178/';
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#code-preview').children.length > 0);
  await page.waitForFunction(() => document.querySelector('#drogon-photo').complete);
  assert.ok(await page.locator('#drogon-photo').evaluate(image => image.naturalWidth > 0), 'production still loads');
  await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
  await page.locator('[data-tree="api"]').click();
  assert.equal(await page.locator('#demo-file').textContent(), 'src/api/retry.ts');
  await page.locator('[data-tree="tests"]').click();
  assert.equal(await page.locator('#demo-harness').textContent(), 'OpenCode');
  await page.getByRole('tab', { name: 'Workspace', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.ok(await page.locator('#panel-orchestrator').isVisible());
  await page.locator('[data-node="review"]').click();
  assert.equal(await page.locator('#node-title').textContent(), 'Code review');
  await page.locator('#run-demo').click();
  await page.waitForFunction(() => !document.querySelector('#approve-demo').hidden);
  assert.match(await page.locator('#evidence-log').textContent(), /FAIL.*RECOVER.*VERIFY/s);
  await page.locator('#approve-demo').click();
  assert.match(await page.locator('#run-status').textContent(), /Demo approved/);
  await page.locator('#iteration-limit').selectOption('1');
  await page.locator('#run-demo').click();
  await page.waitForFunction(() => document.querySelector('#run-status').textContent.includes('Iteration limit reached'));
  assert.ok(await page.locator('#approve-demo').isHidden());
  await page.locator('#inject-failure').uncheck();
  await page.locator('#run-demo').click();
  await page.waitForFunction(() => !document.querySelector('#approve-demo').hidden);
  assert.doesNotMatch(await page.locator('#evidence-log').textContent(), /FAIL/);
  await page.locator('#run-demo').click();
  await page.locator('#reset-demo').click();
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('#evidence-log li').count(), 1, 'reset cancels pending steps');
  await page.getByRole('tab', { name: 'Self-waking bots', exact: true }).click();
  await page.locator('#simulate-event').click();
  assert.match(await page.locator('#bot-result').textContent(), /Event held/);
  assert.ok(await page.locator('#bot-work').isHidden());
  await page.locator('#approve-monitor').check();
  await page.locator('#simulate-event').click();
  assert.ok(await page.locator('#bot-work').isVisible());
  await page.locator('#simulate-event').click();
  assert.match(await page.locator('#bot-result').textContent(), /Duplicate skipped/);
  await page.locator('#reset-bot').click();
  assert.ok(await page.locator('#bot-work').isHidden());
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const name of ['Workspace', 'Orchestrator', 'Self-waking bots']) {
      await page.getByRole('tab', { name, exact: true }).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} overflow at ${width}`);
    }
  }
  await page.getByRole('tab', { name: 'Orchestrator', exact: true }).click();
  if (process.env.DROGON_WEBSITE_SCREENSHOTS) {
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#code-preview').children.length > 0);
    await page.screenshot({ path: `${process.env.DROGON_WEBSITE_SCREENSHOTS}/interactive-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.DROGON_WEBSITE_SCREENSHOTS}/interactive-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.screenshot({ path: `${process.env.DROGON_WEBSITE_SCREENSHOTS}/interactive-dark.png`, fullPage: true });
  }
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('#copy-command').click();
  await page.waitForFunction(() => document.querySelector('#copy-status').textContent.includes('copied'));
  assert.deepEqual(errors, []);
  console.log('PASS: image, worktrees, keyboard tabs, node inspection, recovery, iteration limit, approval, reset cancellation, bot approval/deduplication, five viewport widths, clipboard.');
} finally {
  if (browser) await browser.close();
}
