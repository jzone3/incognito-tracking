---
name: testing-fingerprint-demo
description: How to run and end-to-end test the incognito-tracking fingerprint re-identification demo (server, browser flow, verify.js) and avoid automation-tooling fingerprint pollution.
---

# Testing the fingerprint re-identification demo

## Run
- `cd <repo> && node server.js` → http://localhost:8080. Stdlib only, no deps.
- Store is in-memory: restart the server to wipe registrations before each run.
- `verify.js` needs Playwright; if not in repo node_modules use `NODE_PATH=/home/ubuntu/fp-demo/node_modules node verify.js` (chromium+firefox already downloaded there). Exit 0 + `SUMMARY incognito=true` = pass. `firefox=false` is expected on headless VMs (documented cross-engine limitation).

## Testing the Safari Private Browsing path
- `verify.js` has a WebKit scenario that injects `safari-protections.js` (a model of Safari 17+ advanced fingerprinting protection: audio noise ±0.001, salted canvas pixel noise, `screen` = viewport). Expect `SUMMARY … safari-protected=true`, meaning `hardware`/`full` changed and the coarse `soft` id matched with the "coarse device-class match — a guess" label.
- Playwright WebKit needs `npx playwright install webkit`. On this VM host validation fails spuriously (`libgles2`/`gstreamer1.0-libav` are in fact installed) — run with `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`.
- WebKit quirk: `page.waitForFunction(...)` in a fresh context can kill the page ("Target page, context or browser has been closed"). Poll with `page.evaluate('typeof window.computeFingerprint === "function"')` instead when writing new WebKit scripts.
- Playwright WebKit does NOT implement Safari's protections and reports this VM's Linux/Mesa reality behind a generic `Apple Inc.|Apple GPU` WebGL string; it is a proxy, never evidence about a real iPhone.
- Killing the server: `pkill -f "node server.js"` and even `grep 'serve[r].js'` kill the *shell itself*, because the one-shot shell's own command line contains the pattern. Use `ps -eo pid,comm,args | awk '$2=="node" && $4 ~ /server\.js$/ {print $1}' | xargs -r kill`.

## CRITICAL: do not test the browser flow with the CDP browser automation tool
The Devin browser tool applies per-target emulation (observed: `navigator.maxTouchPoints` = 1 in automated tabs vs 0 in real windows), which changes the static-attrs component and thus the hardware/full fingerprint. Registration from an automated tab will NOT match a real incognito window ("new device" instead of recognition) — a false failure.

Workaround that works:
1. Launch a clean Chrome instance: `DISPLAY=:0 setsid <chrome-binary> --user-data-dir=/tmp/chrome-clean --no-first-run --start-maximized http://localhost:8080 &` (the binary is at a *versioned* path — `/opt/.devin/chrome/chrome/linux-<version>/chrome-linux64/chrome`, there is no `/opt/.devin/chrome/chrome/chrome`; locate it with `find /opt/.devin/chrome -name chrome -type f`. Do NOT reuse /home/ubuntu/.browser_data_dir — profile singleton lock).
2. Drive it purely with xdotool + `import -window root` screenshots.
3. Open incognito with real modifier key events (plain `xdotool key ctrl+shift+n` may be ignored):
   `xdotool keydown ctrl keydown shift; xdotool key n; xdotool keyup shift keyup ctrl` after clicking into the page to focus.
4. `wmctrl` / `xdotool windowactivate` fail on this WM (no _NET_ACTIVE_WINDOW); focus via real mouse clicks instead.
5. DevTools checks: F12, click Console/Network tabs by coordinates; type expressions with `xdotool type`.
6. Header nav link clicks via xdotool sometimes don't register; falling back to `xdotool key ctrl+l` + typing the URL is reliable.
7. Closing DevTools re-centers the page layout — re-screenshot and recompute click coordinates before clicking page buttons.
8. Viewport-height assertions: Chrome window chrome (tab strip + URL bar ≈89px) + the Chrome-for-Testing banner (≈50px) eat ~139px, so pass `--window-size=1280,939` to get a true ~800px viewport (verify with `window.innerHeight` in the console). Page client coords = screen coords minus that ~139px offset.
9. Tiny controls (e.g. the 18px `(?)` help button) can be missed by 1px with xdotool even when the screenshot looks centered — if a click seems to do nothing, aim a few px inside the visual center or debug with a temporary `document.addEventListener('click', e=>console.log(e.clientX,e.clientY,e.target))` in the console; don't conclude the handler is broken.

## Assertions worth checking
- Fresh context: "new device" badge + 64-hex hardware/full ids (not "…").
- Register "Jared" → "Saved. You are Jared."
- Real incognito window: "I know you. You are Jared." with identical ids.
- Console: `document.cookie === ""`, localStorage/sessionStorage length 0.
- No `Set-Cookie` on any route (curl -si works). API is now a single `POST /api/fp` with `{op:'register'|'identify', ...}` (older branches used api/identify + api/register).
- Relative paths: requests must be `fingerprint.js` / `api/fp` (page mountable at subpath).
- /about.html: renders, `<video>` (demo.mp4, poster demo-poster.png) plays — click the play control and confirm the time counter advances; no audio track is expected.
- Assets site.css / demo-poster.png / demo.mp4 all 200 with correct content-type.
- Secure-context guard: on http://localhost the "This demo needs a secure context" message must NOT appear.

## Testing the Redis/KV store backends (api/_store.js)
- Backend selection: `REDIS_URL`/`KV_URL` → native `redis` client, `KV_REST_API_*`/`UPSTASH_REDIS_REST_*` → HTTP `kv`, else `memory`. Every `/api/fp` JSON response includes `"backend":"..."` — assert it explicitly.
- Local real Redis: `docker run -d --rm -p 6399:6379 --name fpredis redis:7-alpine`, then `REDIS_URL=redis://localhost:6399 node server.js`. `docker exec fpredis redis-cli FLUSHALL` before a run; after registering, `keys '*'` must show `hw:<64hex>` and `full:<64hex>` whose value JSON contains the name + avatar.
- The decisive persistence test: kill and restart the node server (same REDIS_URL), reload — recognition must survive (memory backend would forget). `verify.js` works unchanged against a Redis-backed server.
- Note: even an `identify` of an unknown device persists an avatar record (`hw:`/`full:` keys with no name) — seeing such keys after a curl probe is expected, not a bug.
- Cleanup: `docker stop fpredis` (--rm removes it). Gotcha: `pgrep -f`/`pkill -f <pattern>` in one-shot shells matches the shell's own command line containing the pattern — verify with `ps aux | grep 'patter[n]'` instead.

## Testing a Vercel preview deployment
- Preview URLs sit behind Vercel Authentication: open the share link (`/?_vercel_share=<token>`) FIRST in each browser context (normal AND incognito separately) — it 307s to `/` and sets an HttpOnly `_vercel_jwt` bypass cookie. curl: `curl -c jar '<share-url>'` then reuse `-b jar`.
- The `_vercel_jwt` cookie and the Vercel preview toolbar are Vercel's, not the app's. The toolbar writes sessionStorage keys (`__vtkb-hide-key`, `vc-mfe-session-cleared`, `vc-dt-src`) and injects `feedback.js` requests — do NOT count these against the app's "no storage/no cookies" claims; check `Object.keys(sessionStorage)` to attribute them.
- Without KV env vars the store is an in-process Map per serverless instance: identify can return `name:null` with the SAME hardware hash (cold-start amnesia — retry) vs a DIFFERENT hash (real fingerprint mismatch).
- Newer UI additions worth asserting: emoji+color device badge (assigned randomly by the server on first sight and stored with the record, so it must be identical in normal and incognito) and IP-derived city line; api/fp response includes `matchedOn` and `geo`.
