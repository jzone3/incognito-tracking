# incognito-tracking

[![Built by Devin](https://raw.githubusercontent.com/club-cog/built-by-devin/main/badges/built-by-devin.svg)](https://devin.ai)

**A website can recognize you in incognito, after you clear cookies, and often in a
different browser — with no login, no cookies, and no permission prompt.**

This is a tiny, dependency-free proof of concept. You type your name once. Then you
open the same URL in an incognito window (or a fresh profile, or another browser on
the same machine) and the page greets you by name.

Nothing is stored in your browser. There is no `Set-Cookie`, no `localStorage`, no
`sessionStorage`, no account. The only thing sent to the server is a hash of *how
your hardware behaves*.

## Why this exists

This came out of pulling on a thread about an AliExpress tab that kept breaking
someone's Bluetooth headphones. Chasing *why* a shopping page needs a permanently
open audio stream led to what is actually going on: sites play an *inaudible* tone
through the Web Audio API and measure how your CPU and audio stack render it.
Combined with WebGL and canvas quirks, that produces a stable device ID which
behaves like a cookie you cannot delete, clear, or refuse — and it is standard
anti-fraud infrastructure, shipped by a handful of vendors across the web.

Instrumenting 20 major e-commerce sites showed it running on most of them. It also
puts the "secretly recording audio" version of the story to bed: every mic-capable
API (`getUserMedia`, `getDisplayMedia`, `MediaRecorder`, `SpeechRecognition`) was
hooked before any page script ran, and there were zero calls. Nothing here is a
bypass — which is the point. There is no prompt to deny and no indicator to notice.

## How the fingerprint is built

See [`public/fingerprint.js`](public/fingerprint.js). No microphone is involved
anywhere; the audio component is pure offline signal processing.

| Component | Signal |
| --- | --- |
| Audio | `OfflineAudioContext`: triangle oscillator → `DynamicsCompressor` → render, then sum a slice of the output buffer. Floating-point results differ per audio stack. |
| WebGL | Unmasked vendor/renderer strings, max texture sizes, supported extension list. |
| Static | Screen size, color depth, CPU cores, device memory, platform, touch points, timezone. (`devicePixelRatio` is deliberately excluded — page zoom changes it, and zoom is per-profile.) |
| Canvas | Text + shape rasterization read back via `toDataURL()` (font/AA differences). |

Two IDs are derived:

- **`hardware`** = SHA-256(audio + WebGL + static attributes). Deliberately excludes
  canvas, which is the most browser-specific signal — this is the ID that survives a
  new profile or a different browser.
- **`full`** = SHA-256(everything, including canvas). More precise, more brittle.

The server ([`api/fp.js`](api/fp.js)) tries `full` first, then falls back
to `hardware`. That fallback is the whole point: it is what links an incognito
session back to your named identity.

Two extras make the link visible:

- **Badge** — an emoji and a colour rolled *at random* the first time the server
  sees a device, then stored in that device's record (`{ name, avatar }`). It is
  deliberately *not* derived from the hash: two contexts cannot land on the same
  badge by coincidence, so seeing the same otter in incognito is proof the server
  matched the fingerprint.
- **City** — resolved from the request IP, which needs no permission and shows no
  indicator (unlike `navigator.geolocation`). On Vercel this comes from the
  `x-vercel-ip-city` / `-country-region` / `-country` edge headers; locally it falls
  back to a keyless [ipwho.is](https://ipwho.is) lookup, and private IPs are skipped.
  It is city-level, often off by a metro area, and never stored.

## Run it locally

```bash
node server.js       # http://localhost:8080
```

1. Open it, type your name, hit **Remember me**.
2. Open the same URL in an incognito window.
3. It greets you by name.

## Verify it automatically

```bash
npm install          # playwright, dev only
npx playwright install chromium firefox
node verify.js
```

`verify.js` registers a name in one isolated browser context, closes it, opens a
brand-new context (no shared cookies or storage at all), and asserts it is still
recognized.

```
[chromium-normal]    app: new device I don't recognize this device yet.
[chromium-incognito] app: I know you. You are Jared-mfk2p1. recognized via…
RESULT chromium incognito recognized as Jared-mfk2p1: true
```

The name is randomized per run so a leftover registration from an earlier run
cannot produce a false pass.

## Honest limitations

- **Same-browser normal → incognito, and cookie clearing: reliable.** This is the
  core claim and it holds.
- **Cross-*engine* (Chrome ↔ Firefox): not guaranteed.** The two engines produce
  different WebAudio floats and expose different WebGL renderer strings, so the
  `hardware` ID diverges. On the headless VM used to build this, Chromium reported
  ANGLE/SwiftShader and Firefox Mesa/llvmpipe and they did not match. It converges
  much better on real hardware, but treat cross-engine linking as best-effort.
- This demo maps a fingerprint to a name **you typed in**. A fingerprint alone does
  not reveal who you are — it becomes identifying the moment any one site you visit
  knows your name, and the same fingerprinting vendors run on thousands of sites.
- The fingerprint here uses `OfflineAudioContext`, the common one-shot pattern. The
  rarer variant found on AliExpress and eBay keeps a *realtime* `AudioContext`
  connected to `destination` at zero gain, which holds the OS audio device open for
  the tab's lifetime — that is what broke a user's Bluetooth headphone multipoint
  switching and started this whole investigation.

## What this repo is not

It does not capture microphone audio, and it does not bypass any browser permission.
That is not possible without an exploit, and it is not what the real-world scripts do.

## Deploying

Static files in `public/`, one serverless function in [`api/fp.js`](api/fp.js) that
handles both `identify` and `register`. It is a single function on purpose: separate
Vercel functions get separate module instances, so the in-memory fallback store would
never be shared between a register and a later identify.

Asset and API paths are relative, so the site works mounted at `/` or at a subpath
like `/projects/incognito-tracking/` — as long as the page is reached with a trailing
slash (mount it behind a rewrite that preserves one).

**Production needs a shared store**, so the fingerprint→name map survives across
serverless instances and cold starts. Whichever shape your Redis integration
injects works:

- `REDIS_URL` (or `KV_URL`) — a native `redis://`/`rediss://` connection string, which is
  all Vercel's Redis marketplace database hands out;
- `KV_REST_API_URL` + `KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_URL` +
  `UPSTASH_REDIS_REST_TOKEN` — an HTTP REST endpoint.

`/api/fp` responses report which is in use as `"backend": "redis"`, `"kv"`, or `"memory"`.
Without any of them the demo falls back to per-instance memory, which works for
`node server.js` locally but will forget people in production.

## The site

`public/index.html` is the live demo on a single non-scrolling screen, with the
mechanism behind a `(?)` popup; `public/about.html` has the video walkthrough, the
detailed writeup and the list of sites observed doing this. Styling is system fonts
only — no webfont CDN, which would be a poor look on a page about silent
third-party requests.

## Credits

Built by [Devin](https://devin.ai) — badge from
[club-cog/built-by-devin](https://github.com/club-cog/built-by-devin).

Prior art and background reading:

- [The original Bluetooth-multipoint discovery](https://blog.laserphile.com/2026/08/aliexpress-webpage-keeping-multipoint.html)
- [Tom Ritter's analysis of Alibaba's WebAudio code](https://ritter.vg/blog-webaudio_alibaba.html)
- [FingerprintJS audio source](https://github.com/FingerprintJS/fingerprintjs/blob/master/src/sources/audio.ts)
- [Princeton OpenWPM](https://github.com/openwpm/OpenWPM) and its
  [audio fingerprint test page](https://audiofingerprint.openwpm.com/)
