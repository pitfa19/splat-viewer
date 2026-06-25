// Compact orbit/pan/zoom camera controller. Owns the orbit `pivot`, which is
// exactly the `target` a captured Pose records.

import { Entity, Vec3 } from "playcanvas";
import type { Pose } from "./types";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

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

  constructor(camera: Entity, el: HTMLElement) {
    this.camera = camera;
    this.el = el;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onUp);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("contextmenu", this.prevent);
  }

  destroy() {
    const el = this.el;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointercancel", this.onUp);
    el.removeEventListener("wheel", this.onWheel);
    el.removeEventListener("contextmenu", this.prevent);
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

  /** Recompute the camera transform from the current orbit state. */
  update() {
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

  private prevent = (e: Event) => e.preventDefault();
}
