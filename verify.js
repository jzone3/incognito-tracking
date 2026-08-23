// Verify the demo links two separate browser contexts via fingerprint alone.
const playwright = require('playwright');
const BASE = 'http://localhost:8080';
// Unique per run, so a stale registration from an earlier run can't fake a pass.
const NAME = 'Jared-' + Date.now().toString(36);
const KNOWS = new RegExp('You are\\s+' + NAME);

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
  // A previous run may have left this device registered; reset to the form first.
  if (await A.page.locator('#forget').count()) {
    await A.page.click('#forget');
    await A.page.waitForSelector('#name');
  }
  await A.page.fill('#name', NAME);
  await A.page.click('#save');
  await A.page.waitForTimeout(400);
  await A.ctx.close();

  // Context B: brand-new context (simulates incognito / cleared cookies).
  const B = await run(chromium, 'chromium-incognito');
  const knowsB = KNOWS.test(B.state);
  console.log(`RESULT chromium incognito recognized as ${NAME}: ${knowsB}`);
  await B.ctx.close();
  await chromium.close();

  // Cross-browser: Firefox on the same machine should match on hardware id.
  let knowsFF = null;
  try {
    const firefox = await playwright.firefox.launch();
    const C = await run(firefox, 'firefox');
    knowsFF = KNOWS.test(C.state);
    console.log(`RESULT firefox recognized as ${NAME}: ${knowsFF}`);
    await C.ctx.close();
    await firefox.close();
  } catch (e) {
    console.log('firefox skipped: ' + e.message);
  }

  console.log('\nSUMMARY incognito=' + knowsB + ' firefox=' + knowsFF);
  process.exit(knowsB ? 0 : 1);
})();
