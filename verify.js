// Verify the demo links two separate browser contexts via fingerprint alone.
const playwright = require('playwright');
const SAFARI_PROTECTIONS = require('./safari-protections');
const BASE = 'http://localhost:8080';
// Unique per run, so a stale registration from an earlier run can't fake a pass.
const NAME = 'Jared-' + Date.now().toString(36);
const KNOWS = new RegExp('You are\\s+' + NAME);

async function run(browser, label, opts = {}) {
  // Fresh context = no shared cookies/storage with any other context.
  const ctx = await browser.newContext(opts.contextOptions);
  if (opts.protections) await ctx.addInitScript(SAFARI_PROTECTIONS);
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

  // WebKit with Safari's advanced fingerprinting protections emulated: audio and
  // canvas are randomised per session and screen size is replaced by the window
  // size, so `full` and `hardware` cannot match. Only the coarse `soft` key can,
  // and it must be reported as a guess.
  let knowsSafari = null;
  try {
    const webkit = await playwright.webkit.launch();
    const D = await run(webkit, 'webkit-normal');
    if (await D.page.locator('#forget').count()) {
      await D.page.click('#forget');
      await D.page.waitForSelector('#name');
    }
    // Deliberately stable across runs, unlike NAME: the coarse key is derived from
    // device attributes only, so a fresh name on every run would make the key
    // ambiguous (see softRecord) and every later run would fail.
    const wkName = 'Jared-webkit';
    await D.page.fill('#name', wkName);
    await D.page.click('#save');
    await D.page.waitForTimeout(400);
    await D.ctx.close();

    const E = await run(webkit, 'webkit-private-protected', {
      protections: true,
      contextOptions: { viewport: { width: 390, height: 664 } },
    });
    knowsSafari = new RegExp('You are\\s+' + wkName).test(E.state)
      && /coarse device-class match/.test(E.state);
    console.log(`RESULT webkit private+protections recognized as ${wkName} via soft: ${knowsSafari}`);
    await E.ctx.close();
    await webkit.close();
  } catch (e) {
    console.log('webkit skipped: ' + e.message);
  }

  console.log('\nSUMMARY incognito=' + knowsB + ' firefox=' + knowsFF +
    ' safari-protected=' + knowsSafari);
  process.exit(knowsB ? 0 : 1);
})();
