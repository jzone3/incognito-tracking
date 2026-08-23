// Verify the demo links two separate browser contexts via fingerprint alone.
const playwright = require('playwright');
const BASE = 'http://localhost:8080';

async function run(browser, label) {
  // Fresh context = no shared cookies/storage with any other context.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.getElementById('hwid').textContent !== '…');
  const fp = await page.evaluate(() => ({
    hw: document.getElementById('hwid').textContent,
    full: document.getElementById('fullid').textContent,
  }));
  const state = await page.evaluate(() => document.getElementById('app').innerText);
  console.log(`[${label}] hw=${fp.hw.slice(0,16)}… full=${fp.full.slice(0,16)}…`);
  console.log(`[${label}] app: ${state.replace(/\n/g,' ')}`);
  return { ctx, page, fp, state };
}

(async () => {
  const chromium = await playwright.chromium.launch();

  // Context A: register a name.
  const A = await run(chromium, 'chromium-normal');
  await A.page.fill('#name', 'Jared');
  await A.page.click('#save');
  await A.page.waitForTimeout(400);
  await A.ctx.close();

  // Context B: brand-new context (simulates incognito / cleared cookies).
  const B = await run(chromium, 'chromium-incognito');
  const knowsB = /You are\s+Jared/.test(B.state);
  console.log(`RESULT chromium incognito recognized as Jared: ${knowsB}`);
  await B.ctx.close();
  await chromium.close();

  // Cross-browser: Firefox on the same machine should match on hardware id.
  let knowsFF = null;
  try {
    const firefox = await playwright.firefox.launch();
    const C = await run(firefox, 'firefox');
    knowsFF = /You are\s+Jared/.test(C.state);
    console.log(`RESULT firefox recognized as Jared: ${knowsFF}`);
    await C.ctx.close();
    await firefox.close();
  } catch (e) {
    console.log('firefox skipped: ' + e.message);
  }

  console.log('\nSUMMARY incognito=' + knowsB + ' firefox=' + knowsFF);
  process.exit(knowsB ? 0 : 1);
})();
