// Silent, permissionless device fingerprint.
// No cookies, no localStorage, no mic — just hardware/OS/driver quirks the
// browser exposes to any page automatically.

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- Audio: the AliExpress/FingerprintJS method (offline, no mic) ---
function audioFingerprint() {
  return new Promise(resolve => {
    // Rendering can silently never complete (suspended audio stack, locked-down
    // browser); bail out rather than leaving the page stuck on "reading…".
    const timer = setTimeout(() => resolve('audio-timeout'), 3000);
    const done = v => { clearTimeout(timer); resolve(v); };
    try {
      const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Ctx) return done('no-audio');
      const ctx = new Ctx(1, 44100, 44100);
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 10000;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -50;
      comp.knee.value = 40;
      comp.ratio.value = 12;
      comp.attack.value = 0;
      comp.release.value = 0.25;
      osc.connect(comp);
      comp.connect(ctx.destination);
      osc.start(0);
      ctx.startRendering();
      ctx.oncomplete = e => {
        const data = e.renderedBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 4500; i < 5000; i++) sum += Math.abs(data[i]);
        done(sum.toString());
      };
    } catch (e) {
      done('audio-err');
    }
  });
}

// --- Canvas: 2D text/emoji rendering quirks ---
function canvasFingerprint() {
  try {
    const c = document.createElement('canvas');
    c.width = 280; c.height = 60;
    const ctx = c.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('FingerprintDemo \u{1F510}', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('FingerprintDemo \u{1F510}', 4, 17);
    return c.toDataURL();
  } catch (e) { return 'canvas-err'; }
}

// --- WebGL: GPU vendor/renderer + params ---
function webglFingerprint() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return 'no-webgl';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : '';
    const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
    return [vendor, renderer, gl.getParameter(gl.MAX_TEXTURE_SIZE),
            gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
            (gl.getSupportedExtensions() || []).join(',')].join('|');
  } catch (e) { return 'webgl-err'; }
}

// --- Static hardware/OS attributes ---
function staticAttrs() {
  const n = navigator, s = screen;
  // devicePixelRatio is deliberately excluded: page zoom changes it, and zoom is
  // per-profile, so including it would break recognition for anyone who zoomed.
  return [
    s.width + 'x' + s.height,
    s.colorDepth,
    n.hardwareConcurrency,
    n.deviceMemory || '',
    n.platform,
    n.maxTouchPoints,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join('|');
}

// Same list minus screen dimensions. Safari's advanced fingerprinting protection
// (on by default in Private Browsing since 17.0) reports screen.width/height as
// the *window's* innerWidth/innerHeight, which differs between a normal tab and a
// private tab and shifts as the URL bar collapses.
function softAttrs() {
  const n = navigator;
  return [
    screen.colorDepth,
    n.hardwareConcurrency,
    n.deviceMemory || '',
    n.platform,
    n.maxTouchPoints,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join('|');
}

// Build a "hardware fingerprint" that is stable across browser profiles
// (incognito, cleared cookies) AND largely across different browsers on the
// same machine — because it is driven by the physical device, not the profile.
async function computeFingerprint() {
  const audio = await audioFingerprint();
  const webgl = webglFingerprint();
  const attrs = staticAttrs();
  const canvas = canvasFingerprint();
  // Hardware-level: survives incognito, cookie-clear, and often a different browser.
  const hardware = await sha256Hex([audio, webgl, attrs].join('##'));
  // Full: adds canvas (browser-specific), most precise within one browser family.
  const full = await sha256Hex([audio, webgl, attrs, canvas].join('##'));
  // Soft: everything Safari's advanced fingerprinting protection leaves alone —
  // no audio samples, no canvas pixels, no screen size, because those three are
  // per-session randomised or overridden in Private Browsing. What is left is
  // closer to a device *class* than a device, so the server only ever uses it as
  // a last resort and refuses it when two people share one. See README.
  const soft = await sha256Hex([webgl, softAttrs()].join('##'));
  return {
    hardware,
    full,
    soft,
    components: { audio, webgl, attrs, canvasLen: canvas.length, softAttrs: softAttrs() },
  };
}

window.computeFingerprint = computeFingerprint;
