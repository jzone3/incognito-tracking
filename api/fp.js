// POST /api/fp
//   { op: 'identify', hardware, full } -> { name, matchedOn, backend } | { name: null }
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
      if (full) {
        const n = await store.get('full:' + full);
        if (n) return json(res, { name: n, matchedOn: 'full', backend: store.backend });
      }
      if (hardware) {
        const n = await store.get('hw:' + hardware);
        if (n) return json(res, { name: n, matchedOn: 'hardware', backend: store.backend });
      }
      return json(res, { name: null, backend: store.backend });
    }

    res.statusCode = 400;
    return json(res, { error: 'unknown op' });
  } catch (err) {
    res.statusCode = 500;
    return json(res, { error: 'store unavailable' });
  }
};

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
