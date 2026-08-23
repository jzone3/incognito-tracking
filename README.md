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

This came out of investigating the viral claim that AliExpress was "secretly
recording audio". That claim is **false** — websites cannot access the microphone
without a permission prompt and a visible recording indicator, and instrumenting
every mic-capable API (`getUserMedia`, `getDisplayMedia`, `MediaRecorder`,
`SpeechRecognition`) across 20 major e-commerce sites showed zero calls.

What is actually happening is more interesting, and this repo is the demonstration
of why it matters: sites play an *inaudible* tone through the Web Audio API and
measure how your CPU/audio stack renders it. Combined with WebGL and canvas
rendering quirks, that produces a stable device ID that behaves like a cookie you
cannot delete, clear, or refuse.

## How the fingerprint is built

See [`public/fingerprint.js`](public/fingerprint.js). No microphone is involved
anywhere; the audio component is pure offline signal processing.

| Component | Signal |
| --- | --- |
| Audio | `OfflineAudioContext`: triangle oscillator → `DynamicsCompressor` → render, then sum a slice of the output buffer. Floating-point results differ per audio stack. |
| WebGL | Unmasked vendor/renderer strings, max texture sizes, supported extension list. |
| Static | Screen size, color depth, device pixel ratio, CPU cores, device memory, platform, touch points, timezone. |
| Canvas | Text + shape rasterization read back via `toDataURL()` (font/AA differences). |

Two IDs are derived:

- **`hardware`** = SHA-256(audio + WebGL + static attributes). Deliberately excludes
  canvas, which is the most browser-specific signal — this is the ID that survives a
  new profile or a different browser.
- **`full`** = SHA-256(everything, including canvas). More precise, more brittle.

The server ([`api/identify.js`](api/identify.js)) tries `full` first, then falls back
to `hardware`. That fallback is the whole point: it is what links an incognito
session back to your named identity.

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
[chromium-incognito] app: I know you. You are Jared. recognized via hardware match…
RESULT chromium incognito recognized as Jared: true
```

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

Static files in `public/`, two serverless functions in `api/`. Paths are relative so
it works mounted at `/` or at a subpath like `/projects/incognito-tracking/`.

For a real deployment, set `KV_REST_API_URL` and `KV_REST_API_TOKEN` (Vercel KV /
Upstash Redis) so the fingerprint→name map is shared across serverless instances.
Without them it falls back to per-instance memory, which is fine locally but is lost
on cold starts.

## Credits

Built by Devin — see [club-cog/built-by-devin](https://github.com/club-cog/built-by-devin).

Prior art and background reading:

- [The original Bluetooth-multipoint discovery](https://blog.laserphile.com/2026/08/aliexpress-webpage-keeping-multipoint.html)
- [Tom Ritter's analysis of Alibaba's WebAudio code](https://ritter.vg/blog-webaudio_alibaba.html)
- [FingerprintJS audio source](https://github.com/FingerprintJS/fingerprintjs/blob/master/src/sources/audio.ts)
- [Princeton OpenWPM](https://github.com/openwpm/OpenWPM) and its
  [audio fingerprint test page](https://audiofingerprint.openwpm.com/)
