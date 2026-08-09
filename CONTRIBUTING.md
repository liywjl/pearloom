# Contributing to Pearloom

Thanks for your interest! Pearloom is a small side project, so contributions of all sizes are welcome — bug reports, docs fixes, and features alike.

## Getting started

```sh
npm install
npm start            # build + launch
npm test             # unit tests + 2-peer P2P integration test (offline, local DHT)
npm run typecheck
npm run format
```

macOS is the only supported platform right now (capture and the recording UI are macOS-specific; the P2P engine itself is portable).

## Ground rules

- **Keep the P2P engine Electron-free.** Everything under `src/main/p2p/` is plain Node so the test suite can drive it directly.
- **The renderer is sandboxed.** No Node access in `src/renderer/` — anything privileged crosses the typed `window.pearloom` bridge (`src/preload/index.ts`, contracts in `src/shared/types.ts`).
- **`apply` must stay deterministic.** The Autobase reducer in `src/main/p2p/space.ts` cannot use clocks, randomness, or IO — every peer must reduce the same log to the same state.
- Run `npm test`, `npm run typecheck`, and `npm run format` before opening a PR.
- For larger changes, open an issue first so we can talk it through.

## Reporting bugs

Please include your macOS version, whether the build was dev (`npm start`) or packaged, and — for P2P issues — whether both peers were online at the time (pure P2P means someone with the data must be online for a new peer to fetch it).
