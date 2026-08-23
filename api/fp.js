// POST /api/fp
//   { op: 'identify', hardware, full } -> { name, matchedOn, backend, geo } | { name: null, geo }
//   { op: 'register', name, hardware, full } -> { ok }
//
// Both operations live in ONE function on purpose: separate Vercel functions get
// separate module instances, so the in-memory fallback store would never be
// shared between a register and a later identify.
const store = require('./_store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('method'); }
  const body = await readJson(req);
  const { op, name, hardware, full } = body;

  try {
    if (op === 'register') {
      if (!name || !hardware) { res.statusCode = 400; return json(res, { ok: false }); }
      await store.set('hw:' + hardware, name);
      if (full) await store.set('full:' + full, name);
      return json(res, { ok: true });
    }

    if (op === 'identify') {
      // Precise full (device + browser) match first, then the hardware-only match
      // that survives incognito / cookie-clear / another browser on the same machine.
      const geo = await lookupGeo(req);
      if (full) {
        const n = await store.get('full:' + full);
        if (n) return json(res, { name: n, matchedOn: 'full', backend: store.backend, geo });
      }
      if (hardware) {
        const n = await store.get('hw:' + hardware);
        if (n) return json(res, { name: n, matchedOn: 'hardware', backend: store.backend, geo });
      }
      return json(res, { name: null, backend: store.backend, geo });
    }

    res.statusCode = 400;
    return json(res, { error: 'unknown op' });
  } catch (err) {
    res.statusCode = 500;
    return json(res, { error: 'store unavailable' });
  }
};

// Where the request came from, from the IP alone — no geolocation permission
// prompt, nothing the visitor can decline. On Vercel the edge network has
// already resolved it into headers; elsewhere fall back to a public lookup
// (ipwho.is, keyless). City-level only, and it is never stored.
async function lookupGeo(req) {
  const h = req.headers;
  const city = header(h, 'x-vercel-ip-city');
  if (city) {
    return {
      city: decodeURIComponent(city),
      region: decodeURIComponent(header(h, 'x-vercel-ip-country-region') || ''),
      country: header(h, 'x-vercel-ip-country') || '',
      source: 'edge-header',
    };
  }
  const ip = clientIp(req);
  if (!ip || isPrivate(ip)) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch('https://ipwho.is/' + encodeURIComponent(ip), { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const d = await r.json();
    if (!d || !d.success || !d.city) return null;
    return {
      city: d.city,
      region: d.region_code || d.region || '',
      country: d.country_code || '',
      source: 'ip-lookup',
    };
  } catch {
    return null;
  }
}

function header(h, name) {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
}

function clientIp(req) {
  const fwd = header(req.headers, 'x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  const addr = req.socket && req.socket.remoteAddress;
  return addr ? addr.replace(/^::ffff:/, '') : '';
}

function isPrivate(ip) {
  return ip === '::1' || /^127\./.test(ip) || /^10\./.test(ip) ||
    /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^f[cd]/i.test(ip);
}

function json(res, obj) {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(obj));
}
function readJson(req) {
  return new Promise(r => {
    if (req.body) return r(typeof req.body === 'string' ? safe(req.body) : req.body);
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => r(safe(b)));
  });
}
function safe(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }
