// Compact orbit/pan/zoom camera controller. Owns the orbit `pivot`, which is
// exactly the `target` a captured Pose records.

import { Entity, Vec3 } from "playcanvas";
import type { Pose } from "./types";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

const MOVE_KEYS = new Set(["w", "a", "s", "d", "q", "e"]);
// Arrow keys mirror WASD (up/down = forward/back, left/right = strafe).
const ARROW_ALIAS: Record<string, string> = {
  arrowup: "w",
  arrowdown: "s",
  arrowleft: "a",
  arrowright: "d",
};
const MOVE_RATE = 1.5; // pivot units/sec, scaled by the current orbit distance
const BOOST = 3; // Shift multiplier ("run")

export class OrbitControls {
  pivot = new Vec3(0, 0, 0);
  distance = 10;
  /** Azimuth, degrees. */
  yaw = 0;
  /** Elevation, degrees, clamped to avoid gimbal flip. */
  pitch = 0;

  private camera: Entity;
  private el: HTMLElement;
  private dragging: "orbit" | "pan" | null = null;
  private lastX = 0;
  private lastY = 0;
  /** Currently-held movement keys (+ "shift" for boost). */
  private keys = new Set<string>();

  constructor(camera: Entity, el: HTMLElement) {
    this.camera = camera;
    this.el = el;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onUp);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("contextmenu", this.prevent);
    // Keys go on window so movement works without focusing the canvas.
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  destroy() {
    const el = this.el;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointercancel", this.onUp);
    el.removeEventListener("wheel", this.onWheel);
    el.removeEventListener("contextmenu", this.prevent);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
  }

  /** The pivot is the captured `target`; read it after capturing a pose. */
  get target(): Vec3 {
    return this.pivot;
  }

  /** Reposition the rig from a saved pose (for "fly back" / refine). */
  setFromPose(pose: Pose) {
    this.pivot.set(pose.target[0], pose.target[1], pose.target[2]);
    const dx = pose.position[0] - pose.target[0];
    const dy = pose.position[1] - pose.target[1];
    const dz = pose.position[2] - pose.target[2];
    this.distance = Math.hypot(dx, dy, dz) || 0.001;
    this.pitch = Math.asin(Math.max(-1, Math.min(1, dy / this.distance))) * RAD;
    this.yaw = Math.atan2(dx, dz) * RAD;
    this.camera.camera!.fov = pose.fov;
  }

  /**
   * Recompute the camera transform from the current orbit state. Pass the frame
   * delta (seconds) so held WASD/QE keys translate the rig frame-rate-independently.
   */
  update(dt = 0) {
    this.applyKeys(dt);
    const p = this.pitch * DEG;
    const y = this.yaw * DEG;
    const cp = Math.cos(p);
    const x = this.pivot.x + this.distance * cp * Math.sin(y);
    const yy = this.pivot.y + this.distance * Math.sin(p);
    const z = this.pivot.z + this.distance * cp * Math.cos(y);
    this.camera.setPosition(x, yy, z);
    this.camera.lookAt(this.pivot.x, this.pivot.y, this.pivot.z);
  }

  private onDown = (e: PointerEvent) => {
    this.dragging = e.button === 0 && !e.shiftKey ? "orbit" : "pan";
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.el.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (this.dragging === "orbit") {
      this.yaw -= dx * 0.3;
      this.pitch = Math.max(-89, Math.min(89, this.pitch + dy * 0.3));
    } else {
      // Pan the pivot in the camera's screen plane.
      const right = this.camera.right.clone().mulScalar(-dx * this.distance * 0.0015);
      const up = this.camera.up.clone().mulScalar(dy * this.distance * 0.0015);
      this.pivot.add(right).add(up);
    }
  };

  private onUp = (e: PointerEvent) => {
    this.dragging = null;
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // Generous range so splats of any scale stay navigable.
    this.distance = Math.max(0.05, Math.min(500, this.distance * (1 + e.deltaY * 0.001)));
  };

  // Fly the rig with WASD (move) + Q/E (down/up), Shift to boost. We translate the
  // pivot along the camera's axes; the camera follows, so orbit/zoom and captured
  // poses (target === pivot) keep working unchanged.
  private applyKeys(dt: number) {
    const k = this.keys;
    if (k.size === 0 || dt <= 0) return;
    const move = new Vec3();
    if (k.has("w")) move.add(this.camera.forward);
    if (k.has("s")) move.sub(this.camera.forward);
    if (k.has("d")) move.add(this.camera.right);
    if (k.has("a")) move.sub(this.camera.right);
    if (k.has("e")) move.y += 1; // world up
    if (k.has("q")) move.y -= 1; // world down
    if (move.length() === 0) return;
    const speed = Math.max(this.distance, 0.5) * MOVE_RATE * (k.has("shift") ? BOOST : 1);
    this.pivot.add(move.normalize().mulScalar(speed * dt));
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e)) return; // don't hijack keys while renaming a pose
    if (e.key === "Shift") {
      this.keys.add("shift");
      return;
    }
    const raw = e.key.toLowerCase();
    const key = ARROW_ALIAS[raw] ?? raw;
    if (MOVE_KEYS.has(key)) {
      this.keys.add(key);
      e.preventDefault(); // also stops arrow keys from scrolling the page
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.key === "Shift") this.keys.delete("shift");
    else {
      const raw = e.key.toLowerCase();
      this.keys.delete(ARROW_ALIAS[raw] ?? raw);
    }
  };

  // Drop all held keys when the tab loses focus, so nothing stays "stuck" down.
  private onBlur = () => this.keys.clear();

  private prevent = (e: Event) => e.preventDefault();
}

/** True when the key event targets a text field — leave those keystrokes alone. */
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}
