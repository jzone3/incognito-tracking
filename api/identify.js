// POST /api/identify  { hardware, full } -> { name, matchedOn } | { name: null }
// Re-identifies a visitor from their device fingerprint. No cookie is read.
const store = require('./_store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('method'); }
  const body = await readJson(req);
  const { full, hardware } = body;
  // Precise full (device + browser) match first, then the hardware-only match
  // that survives incognito / cookie-clear / another browser on the same machine.
  if (full) {
    const n = await store.get('full:' + full);
    if (n) return json(res, { name: n, matchedOn: 'full' });
  }
  if (hardware) {
    const n = await store.get('hw:' + hardware);
    if (n) return json(res, { name: n, matchedOn: 'hardware' });
  }
  return json(res, { name: null });
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
