# CLAUDE.md

Browser viewer + camera-pose editor for Gaussian splats. Load a splat, fly
around, capture camera poses, preview the motion between them, and export
`poses.json` (or a video of the flight). Everything runs client-side — splat
files never leave the browser.

## Stack

- **PlayCanvas** `^2.20` — splat rendering (built-in `GSplatHandler` parses the formats)
- **React 19** + **Vite 6** + **TypeScript** — static SPA, no backend

## Commands

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc typecheck + vite build → dist/ (plain static site)
npm run preview  # serve the built bundle
```

## Layout

- `src/main.tsx` — React entry
- `src/App.tsx` — all UI + app logic: file load, pose capture/list, play/scrub, video + JSON export
- `src/splat/viewer.ts` — PlayCanvas viewer core: `createViewer()`, model load/swap, camera get/set pose
- `src/splat/orbit.ts` — orbit/pan/zoom rig + WASD/arrow fly-through (`OrbitControls`)
- `src/splat/route.ts` — pose-graph routing (`buildRoute`): kNN graph + Dijkstra for ↗ fly-to
- `src/splat/types.ts` — `Pose` / `Keyframe` types

## Splat files

Loaded at runtime only (file picker or drag-and-drop) — **none are bundled**, and
`*.sog *.ply *.splat *.spz` are gitignored. Supported: `.sog`, `.ply`, `.splat`.

A **`.sog`** is a *zip* of `meta.json` + WebP textures (SOG v2). An **unzipped**
SOG folder (like `podmornica/`, `podmornicaUnutra/`) won't load via the picker —
zip it first so relative texture refs resolve inside one file:

```bash
cd podmornica && zip -r -X ../podmornica.sog . && cd ..
```

## Conventions

- **Keyboard:** WASD/arrows fly, Q/E down/up, Shift boosts (in `orbit.ts`); **Space
  captures a pose** (window listener in `App.tsx`). All key handlers ignore events
  whose target is a text input, so renaming a pose never triggers movement/capture.
- **Flip 180° (X) defaults ON** — most trained 3DGS / SuperSplat exports are
  Y-down, so they load upright; untick for already-upright splats.
- The camera is **not** auto-framed from the splat AABB (stray floater Gaussians
  inflate it); `resetView()` snaps to a fixed 3/4 view of the origin instead.
- Each captured pose is tagged with its model label; during playback the model
  swaps at a segment's midpoint.
- `poses.json` keyframes use linear interpolation with a smoothstep ease on replay.
- Playback runs over `seqRef` (the active sequence): the full keyframe list for
  ▶ Play motion / Scrub, or a computed route for ↗ fly-to. The ↗ route hops
  through nearby captured poses — `buildRoute` links each pose to its k nearest
  (sparse graph) so Dijkstra is forced to detour through intermediate vertices
  rather than cut a straight line (we have no collision geometry).
