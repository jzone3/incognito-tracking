// POST /api/register  { name, hardware, full } -> { ok }
// Associates a name with a device fingerprint. No cookie is set.
const store = require('./_store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('method'); }
  const { name, hardware, full } = await readJson(req);
  if (!name || !hardware) { res.statusCode = 400; return json(res, { ok: false }); }
  try {
    await store.set('hw:' + hardware, name);
    if (full) await store.set('full:' + full, name);
  } catch (err) {
    res.statusCode = 500;
    return json(res, { ok: false, error: 'store unavailable' });
  }
  return json(res, { ok: true });
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
