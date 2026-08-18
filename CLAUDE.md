# Pearloom — notes for agents

P2P Loom alternative: Electron + TypeScript + the Pear/Holepunch stack. See README.md for architecture.

## Commands

- `npm start` — build (esbuild) + launch Electron
- `npm test` — vitest; includes a 2-peer P2P integration test on a local hyperdht testnet (no internet needed)
- `npm run typecheck` / `npm run format`
- `npm run package` — .app via @electron/packager
- `electron . --screenshot out.png` — headless-ish UI smoke test (captures window, quits); add `--view library` to open on the Library view (README screenshots use demo data in a throwaway `--user-data-dir`)
- Second instance for manual P2P testing: `npx electron . --user-data-dir=/tmp/pearloom-peer-b`

## Hard-won facts (July 2026)

- **Pear CLI ≥2.6 removed `pear init`; `pear run` is deprecated.** Current Pear desktop model = plain Electron + `pear-runtime` npm module (see hello-pear-electron). Don't follow pre-2026 tutorials that use `pear-electron`/`Pear` globals/`pear.gui` config.
- Autobase 7 API: `new Autobase(store, bootstrapKey, { open, apply })`; writers added inside `apply` via `host.addWriter`; `apply` must be a deterministic reducer (no clocks/randomness/IO).
- Invite flow = `blind-pairing` (autopass pattern): creator appends invite record into the bee; joiner sends `Autobase.getLocalKey(namespacedStore)` as userData; member confirms with `{ key, encryptionKey }`.
- A freshly opened remote Hyperdrive is sparse and knows nothing: call `drive.findingPeers()` + `swarm.flush()` + `drive.update({ wait: true })` before `entry()`, or you get 404s (bit us in serve-drive's `get`).
- `serve-drive` provides the HTTP Range gateway for `<video>` P2P streaming; local recordings stream via the custom `pearloom://` protocol instead.
- Holepunch modules ship no TS types — ambient shims live in `src/types/holepunch.d.ts`. Native modules (sodium/udx) are N-API, so they load in Electron main without rebuilds; keep them `external` in esbuild (see scripts/build.mjs).
- MediaRecorder webm has the Infinity-duration quirk; PlayerView works around it by seeking far ahead once.
- **Recording while backgrounded**: rAF freezes when the Electron window is occluded (i.e. whenever the user records another app), so the compositor draws on a `setInterval` and the window sets `backgroundThrottling: false`. Both are required.
- Recorder state (`useRecorder`) is owned by `App`, NOT `RecordView` — navigating mid-recording must never unmount the MediaRecorder session. A floating HUD (App.tsx) shows the timer/stop on other views.
- Global click/typing capture uses `uiohook-napi` (macOS Accessibility permission; `isTrustedAccessibilityClient`). Screens only — window sources have no bounds to map global coords into. **Never trust uiohook's coordinates** (wrong on Retina scale factors) — it's only the trigger; read positions from `screen.getCursorScreenPoint()` (display points, matches `display.bounds`, no permission). The burned-in red cursor dot polls the same API at 30Hz — macOS captures exclude the pointer.
- Activity track (clicks + typing bursts, timing only) lives in `RecordingMeta.activity`, travels inside the `rec!` autobase record on publish, and renders as ticks on the PlayerView timeline. Older records default `activity: []` on read.
- Likes/reactions are keyed by `node.from.key` inside `apply` (the signing writer), not by a value field — prevents spoofed/duplicate likes. Unlike = `view.del` in apply.
- Corestore takes an exclusive file lock: `app.requestSingleInstanceLock()` guards against double launch ("File descriptor could not be locked").
- Recording-time desktop UI lives in src/main/recui.ts: tray (empty nativeImage + emoji title works on macOS), window hides on record (close is intercepted while recording — the renderer owns the live MediaRecorder), and the face bubble is a second BrowserWindow loading the same bundle with `#bubble?camera=<id>` (main.tsx branches on the hash). The bubble MUST keep `setContentProtection(true)` or faces appear twice in recordings.
- Tray left-click (idle) opens the quick-record popover — a third window on the same bundle (`#quickrec`, QuickRecApp.tsx). It only forwards `{sourceId, camera, mic}` over `quickrec:start` → `event:request-start`; the recording always starts in the main window's renderer (App owns useRecorder). Recording state gates the tray click to the controls menu instead.
- Pause/resume: MediaRecorder pause() natively; useRecorder shifts `startedAt` forward on resume so `Date.now() - startedAt` stays the recorded duration everywhere (activity track suppressed while paused).
- Auto-update: update-electron-app + update.electronjs.org (needs the `repository` field in package.json and signed builds; no-op in dev and unsigned packages).

## Conventions

- Renderer is sandbox-style (contextIsolation, no Node); everything crosses `window.pearloom` (typed in src/preload/index.ts, contracts in src/shared/types.ts).
- P2P engine (`src/main/p2p/`) is plain Node code — keep it Electron-free so tests can drive it directly.
