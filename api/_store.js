// Tiny storage abstraction.
//
// On Vercel, serverless instances are ephemeral and not shared, so a real demo
// needs a shared store. Credentials are picked up automatically in whichever
// shape the attached integration injects them:
//   - REDIS_URL / KV_URL: a native redis:// (or rediss://) connection string,
//     which is all Vercel's Redis marketplace database gives you;
//   - KV_REST_API_* / UPSTASH_REDIS_REST_*: an HTTP REST endpoint + token.
// Without either we fall back to per-instance memory, which is fine for local
// `node server.js` but "forgets" between cold starts in prod.

const memory = new Map();

const REDIS_URL = process.env.REDIS_URL || process.env.KV_URL;
const REST_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const backend = REDIS_URL ? 'redis' : (REST_URL && REST_TOKEN ? 'kv' : 'memory');

// One client per warm serverless instance: connecting is the expensive part, so
// the promise is cached and reused by every later invocation on this instance.
let clientPromise = null;

function client() {
  if (!clientPromise) {
    const { createClient } = require('redis');
    const c = createClient({ url: REDIS_URL });
    c.on('error', () => {}); // never let a socket blip become an unhandled event
    // A failed connect clears the cache so the next request retries instead of
    // being stuck with a permanently rejected promise.
    clientPromise = c.connect().catch(err => { clientPromise = null; throw err; });
  }
  return clientPromise;
}

// Commands go in a POST body rather than the URL path, so values containing
// slashes or a lot of JSON cannot break the request.
async function rest(command) {
  const res = await fetch(REST_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REST_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error('kv ' + res.status);
  return (await res.json()).result;
}

async function get(key) {
  if (backend === 'redis') return (await client()).get(key);
  if (backend === 'kv') return await rest(['get', key]);
  return memory.get(key) || null;
}

async function set(key, value) {
  if (backend === 'redis') { await (await client()).set(key, value); return; }
  if (backend === 'kv') { await rest(['set', key, value]); return; }
  memory.set(key, value);
}

module.exports = { get, set, backend };
