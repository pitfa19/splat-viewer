import { useEffect, useRef, useState } from "react";
import { createViewer, type Viewer } from "./splat/viewer";
import { OrbitControls } from "./splat/orbit";
import type { Keyframe, Pose } from "./splat/types";

// Browser splat viewer + pose editor: load a .sog/.ply, fly around, capture
// camera poses, preview the motion between them, export poses.json.

type Mode = "orbit" | "preview";

interface LoadedModel {
  label: string; // unique display name (file base name)
  filename: string; // original file name, carries the extension for the parser
  url: string; // object URL
  flip: boolean; // 180° X flip toggle
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const modeRef = useRef<Mode>("orbit");
  const fovRef = useRef(50);
  const loadedRef = useRef<string | null>(null); // label currently in the viewer
  const modelsRef = useRef<LoadedModel[]>([]);
  const framesRef = useRef<Keyframe[]>([]);
  const framedRef = useRef<Set<string>>(new Set()); // models already auto-framed
  const playRef = useRef({ active: false, t: 0 });
  const lastPoseRef = useRef<Pose | null>(null);

  const [models, setModels] = useState<LoadedModel[]>([]);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [status, setStatus] = useState("ready");
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [readout, setReadout] = useState<Pose | null>(null);
  const [fov, setFov] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  fovRef.current = fov;
  framesRef.current = keyframes;
  modelsRef.current = models;

  // Boot the viewer once (no model loaded yet — that comes from the file picker).
  useEffect(() => {
    const canvas = canvasRef.current!;
    let alive = true;
    (async () => {
      const viewer = await createViewer(canvas);
      if (!alive) {
        viewer.dispose();
        return;
      }
      viewerRef.current = viewer;
      const orbit = new OrbitControls(viewer.camera, canvas);
      orbitRef.current = orbit;

      viewer.onUpdate((dt) => {
        if (modeRef.current === "orbit") {
          viewer.camera.camera!.fov = fovRef.current;
          orbit.update();
          return;
        }
        if (playRef.current.active) {
          const max = framesRef.current.length - 1;
          playRef.current.t = Math.min(max, playRef.current.t + dt * SPEED);
          applyPreview(playRef.current.t);
          if (playRef.current.t >= max) {
            playRef.current.active = false;
            if (lastPoseRef.current) settleToPose(lastPoseRef.current);
            else {
              modeRef.current = "orbit";
              setPlaying(false);
            }
          }
        }
      });
    })();
    return () => {
      alive = false;
      orbitRef.current?.destroy();
      viewerRef.current?.dispose();
      viewerRef.current = null;
    };
  }, []);

  // Live pose readout (throttled — never re-render per frame).
  useEffect(() => {
    const id = setInterval(() => {
      const v = viewerRef.current;
      const o = orbitRef.current;
      if (v && o && modeRef.current === "orbit" && loadedRef.current) {
        setReadout(v.getPose(o.target));
      }
    }, 150);
    return () => clearInterval(id);
  }, []);

  // Reset the orbit rig to a sensible default 3/4 view of the origin. (We don't
  // auto-frame from the splat AABB — stray floater Gaussians inflate it wildly.)
  const resetView = () => {
    const o = orbitRef.current;
    if (!o) return;
    o.pivot.set(0, 0, 0);
    o.distance = 10;
    o.yaw = 30;
    o.pitch = 18;
    modeRef.current = "orbit";
    playRef.current.active = false;
    setPlaying(false);
  };

  // Load/switch to a model by label. Ref-guarded so the frame loop is safe.
  const ensureModel = (label: string) => {
    if (label === loadedRef.current) return;
    const m = modelsRef.current.find((x) => x.label === label);
    if (!m) return;
    loadedRef.current = label;
    setActiveLabel(label);
    setStatus(`loading ${label}…`);
    viewerRef.current
      ?.setModel(m.url, m.filename, m.flip)
      .then(() => {
        setStatus("ready");
        if (modeRef.current === "orbit" && !framedRef.current.has(label)) {
          framedRef.current.add(label);
          resetView();
        }
      })
      .catch(() => setStatus("load failed"));
  };

  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const labels = new Set(models.map((m) => m.label));
    const added: LoadedModel[] = [];
    for (const f of Array.from(files)) {
      const base = f.name.replace(/\.[^.]+$/, "") || "model";
      let label = base;
      let n = 2;
      while (labels.has(label)) label = `${base} (${n++})`;
      labels.add(label);
      // Default flip ON: most trained 3DGS / SuperSplat exports are Y-down, so
      // they load upright. Untick for a splat that's already right-way-up.
      added.push({ label, filename: f.name, url: URL.createObjectURL(f), flip: true });
    }
    const next = [...models, ...added];
    modelsRef.current = next; // sync now so ensureModel sees the new model
    setModels(next);
    ensureModel(added[0].label);
  };

  const toggleFlip = () => {
    const label = loadedRef.current;
    if (!label) return;
    const cur = modelsRef.current.find((m) => m.label === label);
    const next = !(cur?.flip ?? false);
    setModels((ms) => ms.map((m) => (m.label === label ? { ...m, flip: next } : m)));
    viewerRef.current?.setFlip(next); // live, no reload
  };

  const applyPreview = (t: number) => {
    const frames = framesRef.current;
    if (frames.length < 2) return;
    const i = Math.min(Math.floor(t), frames.length - 2);
    const pose = lerpPose(frames[i], frames[i + 1], ease(t - i));
    ensureModel(frames[Math.min(Math.round(t), frames.length - 1)].model);
    lastPoseRef.current = pose;
    viewerRef.current?.setPose(pose);
  };

  const settleToPose = (p: Pose) => {
    orbitRef.current?.setFromPose(p);
    fovRef.current = p.fov;
    setFov(Math.round(p.fov));
    modeRef.current = "orbit";
    setPlaying(false);
  };

  const play = () => {
    if (framesRef.current.length < 2) return;
    playRef.current = { active: true, t: 0 };
    modeRef.current = "preview";
    setPlaying(true);
  };

  const stop = () => {
    playRef.current.active = false;
    if (lastPoseRef.current) settleToPose(lastPoseRef.current);
    else setPlaying(false);
  };

  const capture = () => {
    const v = viewerRef.current;
    const o = orbitRef.current;
    if (!v || !o || !activeLabel) return;
    const pose = v.getPose(o.target);
    setKeyframes((k) => [...k, { id: `${activeLabel}-${k.length + 1}`, model: activeLabel, ...pose }]);
  };

  const flyTo = (kf: Keyframe) => {
    playRef.current.active = false;
    setPlaying(false);
    modeRef.current = "orbit";
    ensureModel(kf.model);
    orbitRef.current?.setFromPose(kf);
    setFov(Math.round(kf.fov));
  };

  const move = (i: number, dir: -1 | 1) =>
    setKeyframes((k) => {
      const j = i + dir;
      if (j < 0 || j >= k.length) return k;
      const next = [...k];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const remove = (i: number) => setKeyframes((k) => k.filter((_, idx) => idx !== i));

  const rename = (i: number, id: string) =>
    setKeyframes((k) => k.map((kf, idx) => (idx === i ? { ...kf, id } : kf)));

  const scrub = (t: number) => {
    playRef.current.active = false;
    setPlaying(false);
    modeRef.current = "preview";
    applyPreview(t);
  };

  // Record the camera flight to a video file by capturing the canvas stream
  // while the Play motion runs. Captures canvas pixels only — the UI panel (a
  // separate DOM element) never appears in the video.
  const exportVideo = () => {
    const canvas = canvasRef.current;
    if (!canvas || recording || keyframes.length < 2) return;
    const mime = pickVideoMime();
    if (!mime) {
      setStatus("video export unsupported");
      return;
    }
    const stream = canvas.captureStream(60);
    const chunks: BlobPart[] = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16_000_000 });
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `motion.${mime.includes("mp4") ? "mp4" : "webm"}`;
      a.click();
      URL.revokeObjectURL(url);
      setRecording(false);
      setStatus("ready");
    };
    setRecording(true);
    setStatus("recording…");
    rec.start();
    // Drive the same motion as Play, then stop the recorder when it ends.
    playRef.current = { active: true, t: 0 };
    modeRef.current = "preview";
    setPlaying(true);
    const durationMs = (keyframes.length - 1) * SECONDS_PER_SEGMENT * 1000;
    window.setTimeout(() => rec.state !== "inactive" && rec.stop(), durationMs + 500);
  };

  const json = JSON.stringify(keyframes, null, 2);
  const download = () => {
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "poses.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeFlip = models.find((m) => m.label === activeLabel)?.flip ?? false;

  return (
    <div
      className={dragOver ? "sv-root dragover" : "sv-root"}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onFiles(e.dataTransfer.files);
      }}
    >
      <canvas ref={canvasRef} className="sv-canvas" />

      {models.length === 0 && (
        <div className="sv-empty">
          <p>
            Drop a <code>.sog</code> / <code>.ply</code> file here
            <br />
            or
          </p>
          <button className="sv-load" onClick={() => fileInputRef.current?.click()}>
            Choose a splat file…
          </button>
        </div>
      )}

      <div className="sv-panel">
        <header className="sv-head">
          <strong>Splat viewer</strong>
          <span className="sv-status">{status}</span>
        </header>

        {models.length > 0 && (
          <div className="sv-models">
            {models.map((m) => (
              <button
                key={m.label}
                className={m.label === activeLabel ? "sv-tab on" : "sv-tab"}
                title={m.filename}
                onClick={() => ensureModel(m.label)}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        <div className="sv-row">
          <button className="sv-load" onClick={() => fileInputRef.current?.click()}>
            ＋ Load splat…
          </button>
          <button onClick={resetView} disabled={!activeLabel} title="Re-center the camera">
            ⟲ Reset view
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".sog,.ply,.splat"
          multiple
          hidden
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {activeLabel && (
          <label className="sv-check">
            <input type="checkbox" checked={activeFlip} onChange={toggleFlip} /> Flip 180° (X)
          </label>
        )}

        <label className="sv-range">
          FOV {fov}°
          <input
            type="range"
            min={20}
            max={90}
            value={fov}
            onChange={(e) => setFov(Number(e.target.value))}
          />
        </label>

        <button className="sv-capture" onClick={capture} disabled={!activeLabel || recording}>
          ◉ Capture pose
        </button>

        <ol className="sv-list">
          {keyframes.map((kf, i) => (
            <li key={i} className="sv-item">
              <span
                className="sv-badge"
                title={kf.model}
                style={{ background: hashColor(kf.model) }}
              >
                {kf.model.slice(0, 1).toUpperCase()}
              </span>
              <input className="sv-name" value={kf.id} onChange={(e) => rename(i, e.target.value)} />
              <button title="fly to" onClick={() => flyTo(kf)}>↗</button>
              <button title="up" onClick={() => move(i, -1)}>↑</button>
              <button title="down" onClick={() => move(i, 1)}>↓</button>
              <button title="delete" onClick={() => remove(i)}>✕</button>
            </li>
          ))}
          {keyframes.length === 0 && <li className="sv-emptyrow">No poses yet.</li>}
        </ol>

        {keyframes.length >= 2 && (
          <>
            <button className="sv-play" onClick={playing ? stop : play} disabled={recording}>
              {playing && !recording ? "■ Stop" : "▶ Play motion"}
            </button>
            <button className="sv-export" onClick={exportVideo} disabled={recording}>
              {recording ? "● recording…" : "⤓ Export video"}
            </button>
            <label className="sv-range">
              Scrub
              <input
                type="range"
                min={0}
                max={keyframes.length - 1}
                step={0.01}
                defaultValue={0}
                onChange={(e) => scrub(Number(e.target.value))}
                onPointerUp={() => lastPoseRef.current && settleToPose(lastPoseRef.current)}
              />
            </label>
          </>
        )}

        <div className="sv-row">
          <button onClick={download} disabled={!keyframes.length}>↓ poses.json</button>
          <button onClick={() => navigator.clipboard.writeText(json)} disabled={!keyframes.length}>
            ⧉ copy
          </button>
        </div>

        {readout && (
          <pre className="sv-readout">
            pos [{readout.position.join(", ")}]{"\n"}
            tgt [{readout.target.join(", ")}]{"\n"}
            fov {readout.fov}
          </pre>
        )}

        <p className="sv-hint">drag = orbit · shift/right-drag = pan · wheel = zoom</p>
      </div>
    </div>
  );
}

const SECONDS_PER_SEGMENT = 2.5; // auto-playback pace between two poses
const SPEED = 1 / SECONDS_PER_SEGMENT; // keyframe-units per second

function ease(t: number): number {
  return t * t * (3 - 2 * t); // smoothstep
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    position: [
      lerp(a.position[0], b.position[0], t),
      lerp(a.position[1], b.position[1], t),
      lerp(a.position[2], b.position[2], t),
    ],
    target: [
      lerp(a.target[0], b.target[0], t),
      lerp(a.target[1], b.target[1], t),
      lerp(a.target[2], b.target[2], t),
    ],
    fov: lerp(a.fov, b.fov, t),
  };
}

// Pick the best supported recording container/codec — MP4/H.264 (best for video
// editors) when available, else WebM.
function pickVideoMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const types = [
    "video/mp4;codecs=avc1.640028",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const t of types) if (MediaRecorder.isTypeSupported(t)) return t;
  return null;
}

// Stable per-model badge colour from its label.
function hashColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h}, 52%, 42%)`;
}
