// POST /api/fp
//   { op: 'identify', hardware, full } -> { name, avatar, matchedOn, backend, geo }
//   { op: 'register', name, hardware, full } -> { ok, avatar }
//
// Both operations live in ONE function on purpose: separate Vercel functions get
// separate module instances, so the in-memory fallback store would never be
// shared between a register and a later identify.
const store = require('./_store');

// The badge is picked at random the first time a device is seen and then kept in
// its record — it is not derived from the hash. That makes the demo honest about
// what is happening: when incognito shows the same otter, it is because the
// server recognised the fingerprint and looked the otter up, not because both
// windows recomputed it locally.
const EMOJI = [
  '\u{1F98A}', '\u{1F419}', '\u{1F98B}', '\u{1F42C}', '\u{1F984}', '\u{1F43F}',
  '\u{1F989}', '\u{1F41D}', '\u{1F438}', '\u{1F427}', '\u{1F98E}', '\u{1F980}',
  '\u{1F42A}', '\u{1F992}', '\u{1F9A9}', '\u{1F99C}', '\u{1F995}', '\u{1F9AB}',
  '\u{1F9A6}', '\u{1F994}', '\u{1F987}', '\u{1F41A}', '\u{1F41E}', '\u{1F997}',
];
const COLORS = [
  { name: 'violet', hex: '#3969ca' }, { name: 'teal', hex: '#21c19a' },
  { name: 'blue', hex: '#0294de' }, { name: 'amber', hex: '#d98314' },
  { name: 'rose', hex: '#d2456d' }, { name: 'indigo', hex: '#5b45c8' },
  { name: 'moss', hex: '#4f8a3d' }, { name: 'clay', hex: '#b4593a' },
];

function randomAvatar() {
  const c = pick(COLORS);
  return { emoji: pick(EMOJI), color: c.hex, colorName: c.name };
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('method'); }
  const body = await readJson(req);
  const { op, name, hardware, full } = body;

  try {
    if (op === 'register') {
      if (!name || !hardware) { res.statusCode = 400; return json(res, { ok: false }); }
      // Keep whatever badge this device was already given; only the name is new.
      const prev = await lookup(hardware, full);
      const rec = { name, avatar: (prev && prev.rec.avatar) || randomAvatar() };
      await save(hardware, full, rec);
      return json(res, { ok: true, avatar: rec.avatar });
    }

    if (op === 'identify') {
      // Precise full (device + browser) match first, then the hardware-only match
      // that survives incognito / cookie-clear / another browser on the same machine.
      const geo = await lookupGeo(req);
      const hit = await lookup(hardware, full);
      if (hit) {
        return json(res, {
          name: hit.rec.name || null, avatar: hit.rec.avatar,
          matchedOn: hit.matchedOn, backend: store.backend, geo,
        });
      }
      // First sighting: mint a badge for this device and remember it, so the
      // next context (incognito, cleared cookies, another browser) gets it back.
      const rec = { name: null, avatar: randomAvatar() };
      if (hardware) await save(hardware, full, rec);
      return json(res, { name: null, avatar: rec.avatar, backend: store.backend, geo });
    }

    res.statusCode = 400;
    return json(res, { error: 'unknown op' });
  } catch (err) {
    res.statusCode = 500;
    return json(res, { error: 'store unavailable' });
  }
};

async function lookup(hardware, full) {
  if (full) {
    const rec = parseRec(await store.get('full:' + full));
    if (rec) return { rec, matchedOn: 'full' };
  }
  if (hardware) {
    const rec = parseRec(await store.get('hw:' + hardware));
    if (rec) return { rec, matchedOn: 'hardware' };
  }
  return null;
}

async function save(hardware, full, rec) {
  const value = JSON.stringify(rec);
  await store.set('hw:' + hardware, value);
  if (full) await store.set('full:' + full, value);
}

// Records are JSON; a bare string is a name written by an earlier version.
function parseRec(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : { name: String(o), avatar: randomAvatar() };
  } catch {
    return { name: raw, avatar: randomAvatar() };
  }
}

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
