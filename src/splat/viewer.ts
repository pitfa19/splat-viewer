// PlayCanvas Gaussian-splat viewer core.
//
// Renders a .sog / .ply / .splat asset, exposes camera get/set for pose
// capture and playback, and reports each model's bounding box so the UI can
// auto-frame it. Engine 2.20 parses these formats via the built-in GSplatHandler.

import {
  AppBase,
  AppOptions,
  CameraComponentSystem,
  Color,
  Entity,
  FILLMODE_NONE,
  GSplatComponentSystem,
  GSplatHandler,
  RESOLUTION_AUTO,
  TextureHandler,
  Vec3,
  createGraphicsDevice,
  type Asset,
} from "playcanvas";
import type { Pose } from "./types";

export interface ViewerOptions {
  /** Canvas clear colour. Defaults to deep near-black. */
  clearColor?: [number, number, number];
}

export interface Viewer {
  app: AppBase;
  camera: Entity;
  /**
   * Load (and swap to) a splat from any URL — including a `blob:` object URL
   * from a file picker. `filename` must carry the real extension (e.g.
   * "model.sog") so the engine selects the right parser.
   */
  setModel: (url: string, filename: string, flip?: boolean) => Promise<void>;
  /** Toggle a 180° X flip on the current model (some splats export Y-down). */
  setFlip: (on: boolean) => void;
  /** Snap the camera to a pose (position + lookAt + fov). */
  setPose: (pose: Pose) => void;
  /** Read the camera's current pose. `target` is supplied by the orbit rig. */
  getPose: (target: Vec3) => Pose;
  /** Run a callback every frame (dt in seconds). Returns an unsubscribe fn. */
  onUpdate: (cb: (dt: number) => void) => () => void;
  dispose: () => void;
}

export async function createViewer(
  canvas: HTMLCanvasElement,
  options: ViewerOptions = {},
): Promise<Viewer> {
  const device = await createGraphicsDevice(canvas, {
    deviceTypes: ["webgl2"],
    antialias: true,
  });

  const opts = new AppOptions();
  opts.graphicsDevice = device;
  opts.componentSystems = [CameraComponentSystem, GSplatComponentSystem];
  opts.resourceHandlers = [TextureHandler, GSplatHandler];

  const app = new AppBase(canvas);
  app.init(opts);
  app.setCanvasFillMode(FILLMODE_NONE); // size follows the canvas element (CSS)
  app.setCanvasResolution(RESOLUTION_AUTO);

  const [r, g, b] = options.clearColor ?? [0.02, 0.05, 0.07];
  const camera = new Entity("camera");
  camera.addComponent("camera", {
    clearColor: new Color(r, g, b, 1),
    fov: 50,
    nearClip: 0.05,
    farClip: 1000,
  });
  camera.setPosition(0, 0, 10);
  camera.lookAt(0, 0, 0);
  app.root.addChild(camera);

  // Keep the drawing buffer matched to the canvas's CSS size.
  const ro = new ResizeObserver(() => app.resizeCanvas());
  ro.observe(canvas);

  let splatAsset: Asset | null = null;
  let splatEntity: Entity | null = null;

  const setModel = (url: string, filename: string, flip = false) =>
    new Promise<void>((resolve, reject) => {
      // Tear down any previous model first.
      if (splatEntity) {
        splatEntity.destroy();
        splatEntity = null;
      }
      if (splatAsset) {
        app.assets.remove(splatAsset);
        splatAsset.unload();
        splatAsset = null;
      }

      // loadFromUrlAndFilename sets file.filename so the parser is chosen by the
      // real extension even when `url` is an extension-less blob: URL.
      app.assets.loadFromUrlAndFilename(url, filename, "gsplat", (err, asset) => {
        if (err || !asset) {
          reject(new Error(err || "failed to load splat"));
          return;
        }
        splatAsset = asset;
        const entity = new Entity("splat");
        entity.addComponent("gsplat", { asset });
        entity.setLocalEulerAngles(flip ? 180 : 0, 0, 0);
        app.root.addChild(entity);
        splatEntity = entity;
        resolve();
      });
    });

  const setFlip = (on: boolean) => {
    splatEntity?.setLocalEulerAngles(on ? 180 : 0, 0, 0);
  };

  const setPose = (pose: Pose) => {
    camera.camera!.fov = pose.fov;
    camera.setPosition(pose.position[0], pose.position[1], pose.position[2]);
    camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
  };

  const getPose = (target: Vec3): Pose => {
    const p = camera.getPosition();
    return {
      position: [round(p.x), round(p.y), round(p.z)],
      target: [round(target.x), round(target.y), round(target.z)],
      fov: round(camera.camera!.fov),
    };
  };

  const updaters = new Set<(dt: number) => void>();
  const onFrame = (dt: number) => updaters.forEach((cb) => cb(dt));
  app.on("update", onFrame);
  const onUpdate = (cb: (dt: number) => void) => {
    updaters.add(cb);
    return () => updaters.delete(cb);
  };

  app.start();

  const dispose = () => {
    ro.disconnect();
    app.off("update", onFrame);
    updaters.clear();
    app.destroy();
  };

  return { app, camera, setModel, setFlip, setPose, getPose, onUpdate, dispose };
}

/** Round to 4 decimals to keep exported JSON readable. */
function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
