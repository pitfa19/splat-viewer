# Splat Viewer

A small browser tool for **Gaussian splats** (`.sog` / `.ply` / `.splat`). Load a
splat, fly around it, **capture camera poses**, preview the camera **motion**
between them, and **export `poses.json`** — the keyframes you can drive your own
scroll-scene or animation with.

Built with [PlayCanvas](https://playcanvas.com/) + React + Vite. Everything runs
client-side; your splat files never leave the browser.

## Features

- Load **any** splat at runtime via file picker or drag-and-drop (no files bundled).
- Load **multiple** models and switch between them; each pose is tagged with its model.
- Orbit / pan / zoom, adjustable FOV, optional **180° flip** for Y-down exports.
- **Capture** poses; reorder, rename, delete, and **fly back** to refine them.
- **▶ Play motion** animates the camera through your poses; **Scrub** does it manually.
- **Export / copy `poses.json`**.

## Run it

Requires **Node 18+**.

```bash
npm install
npm run dev        # http://localhost:5173
```

Then **drag a `.sog` file onto the page** (or click *Choose a splat file…*).

Build a static bundle:

```bash
npm run build      # outputs to dist/ (also typechecks)
npm run preview    # serve the built bundle
```

`dist/` is a plain static site — host it on GitHub Pages, Netlify, Vercel, or any
static host.

## Usage

1. **Load** one or more splat files. The camera auto-frames each new model.
2. **Navigate:** drag to orbit · shift- or right-drag to pan · wheel to zoom · FOV slider.
   Toggle **Flip 180° (X)** if a model loads upside down.
3. **◉ Capture pose** to record the current camera. Captured poses appear in the list:
   - **↗** fly back to a pose · **↑ ↓** reorder · **✕** delete · rename inline.
4. With 2+ poses, **▶ Play motion** flies the camera through them in order; **Scrub**
   moves through the path manually. Model switches happen at a segment's midpoint.
5. **↓ poses.json** to export (or **⧉ copy**).

## `poses.json` format

An ordered array of keyframes:

```json
[
  {
    "id": "myModel-1",
    "model": "myModel",
    "position": [x, y, z],
    "target": [x, y, z],
    "fov": 50
  }
]
```

- `position` — world-space camera position.
- `target` — world-space point the camera looks at.
- `fov` — vertical field of view, in degrees.
- `model` — label (file base name) the pose was framed against.

To replay a pose: place the camera at `position`, `lookAt(target)`, set the vertical
`fov`. Interpolate `position` / `target` / `fov` between consecutive keyframes to
reproduce the **Play motion** flight (this tool uses linear interpolation with a
smoothstep ease).

## Getting `.sog` files

`.sog` is PlayCanvas's compressed splat format (a zip of WebP textures + `meta.json`).
Create one from a trained 3D Gaussian Splatting `.ply` with
[SuperSplat](https://superspl.at/editor) (export → SOG) or the
[`splat-transform`](https://github.com/playcanvas/splat-transform) CLI. Plain `.ply`
and `.splat` files also load directly.

## License

[MIT](./LICENSE)
