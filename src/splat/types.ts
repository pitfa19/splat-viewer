// Camera-pose types. The editor captures `Keyframe[]` and exports it as
// poses.json — the artifact you take into your own scene/animation code.

/** A camera pose in the splat's coordinate space. */
export interface Pose {
  /** World-space camera position. */
  position: [number, number, number];
  /** World-space point the camera looks at (orbit pivot). */
  target: [number, number, number];
  /** Vertical field of view, degrees. */
  fov: number;
}

/** One captured stop: a pose, tagged with which loaded model it was framed against. */
export interface Keyframe extends Pose {
  /** Stable id / short slug; also the React key and a handy label. */
  id: string;
  /** Label of the loaded model this pose belongs to (the file's base name). */
  model: string;
}
