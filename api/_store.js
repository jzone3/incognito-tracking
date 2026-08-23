// Tiny storage abstraction.
//
// On Vercel, serverless instances are ephemeral and not shared, so a real demo
// needs a shared store: set KV_REST_API_URL + KV_REST_API_TOKEN (Vercel KV /
// Upstash Redis) and it is used automatically. Without those env vars we fall
// back to per-instance memory, which is fine for local `node server.js` but
// will "forget" between cold starts in production.

const memory = new Map();

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const useKv = Boolean(KV_URL && KV_TOKEN);

async function kv(command) {
  const res = await fetch(KV_URL + '/' + command.map(encodeURIComponent).join('/'), {
    headers: { Authorization: 'Bearer ' + KV_TOKEN },
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
