---
name: testing-fingerprint-demo
description: How to run and end-to-end test the incognito-tracking fingerprint re-identification demo (server, browser flow, verify.js) and avoid automation-tooling fingerprint pollution.
---

# Testing the fingerprint re-identification demo

## Run
- `cd <repo> && node server.js` → http://localhost:8080. Stdlib only, no deps.
- Store is in-memory: restart the server to wipe registrations before each run.
- `verify.js` needs Playwright; if not in repo node_modules use `NODE_PATH=/home/ubuntu/fp-demo/node_modules node verify.js` (chromium+firefox already downloaded there). Exit 0 + `SUMMARY incognito=true` = pass. `firefox=false` is expected on headless VMs (documented cross-engine limitation).

## CRITICAL: do not test the browser flow with the CDP browser automation tool
The Devin browser tool applies per-target emulation (observed: `navigator.maxTouchPoints` = 1 in automated tabs vs 0 in real windows), which changes the static-attrs component and thus the hardware/full fingerprint. Registration from an automated tab will NOT match a real incognito window ("new device" instead of recognition) — a false failure.

Workaround that works:
1. Launch a clean Chrome instance: `DISPLAY=:0 setsid <chrome-binary> --user-data-dir=/tmp/chrome-clean --no-first-run --start-maximized http://localhost:8080 &` (find binary under /opt/.devin/chrome/...; do NOT reuse /home/ubuntu/.browser_data_dir — profile singleton lock).
2. Drive it purely with xdotool + `import -window root` screenshots.
3. Open incognito with real modifier key events (plain `xdotool key ctrl+shift+n` may be ignored):
   `xdotool keydown ctrl keydown shift; xdotool key n; xdotool keyup shift keyup ctrl` after clicking into the page to focus.
4. `wmctrl` / `xdotool windowactivate` fail on this WM (no _NET_ACTIVE_WINDOW); focus via real mouse clicks instead.
5. DevTools checks: F12, click Console/Network tabs by coordinates; type expressions with `xdotool type`.

## Assertions worth checking
- Fresh context: "new device" badge + 64-hex hardware/full ids (not "…").
- Register "Jared" → "Saved. You are Jared."
- Real incognito window: "I know you. You are Jared." with identical ids.
- Console: `document.cookie === ""`, localStorage/sessionStorage length 0.
- No `Set-Cookie` on /, fingerprint.js, api/identify, api/register (curl -si works).
- Relative paths: requests must be `fingerprint.js` / `api/identify` (page mountable at subpath).
- Secure-context guard: on http://localhost the "This demo needs a secure context" message must NOT appear.
