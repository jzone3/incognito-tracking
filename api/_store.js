// Tiny storage abstraction.
//
// On Vercel, serverless instances are ephemeral and not shared, so a real demo
// needs a shared store. Any Redis REST credentials are picked up automatically:
// the legacy Vercel KV names, or the UPSTASH_* names the marketplace Upstash
// integration injects. Without them we fall back to per-instance memory, which
// is fine for local `node server.js` but "forgets" between cold starts in prod.

const memory = new Map();

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const useKv = Boolean(KV_URL && KV_TOKEN);

// Commands go in a POST body rather than the URL path, so values containing
// slashes or a lot of JSON cannot break the request.
async function kv(command) {
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KV_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error('kv ' + res.status);
  return (await res.json()).result;
}

async function get(key) {
  if (!useKv) return memory.get(key) || null;
  return await kv(['get', key]);
}

async function set(key, value) {
  if (!useKv) { memory.set(key, value); return; }
  await kv(['set', key, value]);
}

module.exports = { get, set, backend: useKv ? 'kv' : 'memory' };
