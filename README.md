# incognito-tracking

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

Three IDs are derived:

- **`hardware`** = SHA-256(audio + WebGL + static attributes). Deliberately excludes
  canvas, which is the most browser-specific signal — this is the ID that survives a
  new profile or a different browser.
- **`full`** = SHA-256(everything, including canvas). More precise, more brittle.
- **`soft`** = SHA-256(WebGL + device attributes *minus screen size*). No audio, no
  canvas, no screen dimensions — the three things Safari randomises or overrides in
  Private Browsing. It is coarse enough to be a device *class* rather than a device,
  so it is a clearly-labelled last resort; see [Safari Private Browsing](#safari-private-browsing-and-the-soft-id).

The server ([`api/fp.js`](api/fp.js)) tries `full` first, then `hardware`, then
`soft`. That fallback chain is the whole point: it is what links an incognito
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

## Safari Private Browsing and the `soft` id

iOS and macOS Safari have shipped *advanced tracking and fingerprinting protection*
since Safari 17 — **on by default in Private Browsing**, opt-in for normal browsing
(iOS: Settings › Apps › Safari › Advanced; macOS: Safari › Settings › Advanced).
It does not block the APIs this demo uses. It makes their answers unstable, which is
worse for a fingerprinter
([WebKit writeup](https://webkit.org/blog/15697/private-browsing-2-0/)):

| Signal | What Safari does with protections on |
| --- | --- |
| `AudioBuffer.getChannelData()` | Every sample multiplied by `1 ± 0.001` of random noise. Normally distributed and consistent within one buffer since 17.5, so it cannot be averaged away cheaply. |
| 2D canvas / WebGL readback | Per-pixel noise on painted pixels, seeded by a hash salt that is unique per session *and* per origin. |
| `screen.width` / `.height` | Replaced by the window's `innerWidth` / `innerHeight`. `screenX/Y` → `(0,0)`, `outerWidth/Height` → inner. |

Consequences for this demo, in order of how badly they hurt:

1. The audio sum and the canvas image change on **every page load** in a private tab.
   So `full` and `hardware` do not just fail to match a normal tab — they fail to
   match the same private tab a second later. This is not the ephemerality of private
   mode; it is deliberate per-session noise.
2. `screen.width x height` in a private tab is the *viewport*, which differs from the
   real screen and shifts as the URL bar collapses. Bucketing it would not help.

That leaves the `soft` id: WebGL strings (Safari reports a generic
`Apple Inc. | Apple GPU`, identical across all Apple devices), colour depth, CPU core
count, `deviceMemory` (absent on Safari), platform, `maxTouchPoints`, timezone.

**The tradeoff is real and it is not small.** Every iPhone of the same generation, on
the same iOS version, in the same timezone, produces the same `soft` id. That is a
device class — maybe tens of bits fewer than `hardware`, and on a busy site it would
collide constantly. So:

- `soft` is only consulted after `full` and `hardware` both miss.
- A `soft` match is reported to the page as `matchedOn: "soft"` and rendered as
  “coarse device-class match — a guess”, never as a confident recognition.
- The moment a second *name* registers against the same `soft` key, that key is
  marked ambiguous and is never matched again — better to say “new device” than to
  greet someone with a stranger's name.
- `hardware` and `full` are byte-for-byte unchanged, so records stored by earlier
  versions keep working and a client that sends no `soft` id behaves exactly as before.

Note that `soft` is computed and sent by *every* browser, not only Safari — Safari is
just the case where it is the only thing left. So on any browser, if `full` and
`hardware` both miss and the device class collides with someone who registered, the
guess can name the wrong person. That is the same tradeoff, and the same ambiguity
guard and “a guess” label apply everywhere.

There is a known way to attack the audio protection specifically — render the buffer
repeatedly and average the noise out, as
[Fingerprint.com demonstrated](https://fingerprint.com/blog/bypassing-safari-17-audio-fingerprinting-protection/).
This repo deliberately does not do that: it is a demonstration of what tracking
vendors do, not an arms race against a privacy protection, and the audio component
carries almost no cross-device entropy anyway (every machine measured here sums to
`124.0434…`).

### Reproducing it without an iPhone

[`safari-protections.js`](safari-protections.js) models the three documented
behaviours above and is injected into a Playwright WebKit context by `verify.js`.
Measured on this machine (12-char hash prefixes):

| context | audio | hardware | full | soft |
| --- | --- | --- | --- | --- |
| WebKit, normal | `124.04345374458353` | `befcd23f4444` | `a11fcee959f1` | `90e19d9ce5ac` |
| WebKit, normal, fresh context | `124.04345374458353` | `befcd23f4444` | `a11fcee959f1` | `90e19d9ce5ac` |
| WebKit + protections | `124.0459250896165` | `cda51f64724c` | `dfa2b1f4a842` | `90e19d9ce5ac` |
| WebKit + protections, again | `124.03744574045413` | `da68898da80c` | `6e8780f3b9cd` | `90e19d9ce5ac` |
| WebKit + protections, phone viewport | `124.04587967375119` | `6743ae4de41c` | `d9abd0d5abdb` | `90e19d9ce5ac` |

Playwright's WebKit is **not** iOS Safari — it does not implement the protections at
all, which is why they have to be emulated, and its WebGL/screen values come from
this Linux VM. The table shows that the emulated protections defeat `hardware` and
`full` while `soft` survives; it is not evidence about a real iPhone.

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
  core claim and it holds — in Chrome, Edge, Firefox, and Safari with advanced
  protections off.
- **iOS/macOS Safari Private Browsing: the precise ids are unlinkable by design,**
  and that is Safari working correctly, not a bug here. Audio and canvas are
  re-randomised on every load and `screen` reports the viewport, so `full` and
  `hardware` are single-use values. Only the coarse `soft` id can match, it is a
  device-class guess, and it is labelled as one. See
  [Safari Private Browsing](#safari-private-browsing-and-the-soft-id).
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

Built by Devin — see [club-cog/built-by-devin](https://github.com/club-cog/built-by-devin).

Prior art and background reading:

- [The original Bluetooth-multipoint discovery](https://blog.laserphile.com/2026/08/aliexpress-webpage-keeping-multipoint.html)
- [Tom Ritter's analysis of Alibaba's WebAudio code](https://ritter.vg/blog-webaudio_alibaba.html)
- [FingerprintJS audio source](https://github.com/FingerprintJS/fingerprintjs/blob/master/src/sources/audio.ts)
- [Princeton OpenWPM](https://github.com/openwpm/OpenWPM) and its
  [audio fingerprint test page](https://audiofingerprint.openwpm.com/)
