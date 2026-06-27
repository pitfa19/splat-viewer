// Pose-graph routing. Captured poses become vertices; "fly to" walks a route
// through nearby poses to reach the clicked one, instead of cutting a straight
// line that could clip through the splat (we have no collision geometry).

import type { Keyframe } from "./types";

const K = 3; // each pose links to its 3 nearest — sparse enough to force detours

function dist(a: Keyframe, b: Keyframe): number {
  const dx = a.position[0] - b.position[0];
  const dy = a.position[1] - b.position[1];
  const dz = a.position[2] - b.position[2];
  return Math.hypot(dx, dy, dz);
}

/**
 * Route from a virtual `start` node (the live camera pose) to keyframe
 * `targetIndex`, hopping through nearby captured poses. Returns
 * `[start, ...intermediate poses..., target]`, or a direct `[start, target]`
 * if the target can't be reached through the graph.
 *
 * The sparsity is the whole trick. Edge weights are straight-line distances, so
 * on a *complete* graph the direct start→target edge would always win (triangle
 * inequality) and the camera would never detour. Linking each node to only its
 * K nearest neighbours means a far target has no direct edge, forcing Dijkstra
 * to hop through the intermediate poses you captured — which, being viewpoints
 * you actually stood at, keep the flight in navigable space.
 */
export function buildRoute(
  poses: Keyframe[],
  targetIndex: number,
  start: Keyframe,
  k = K,
): Keyframe[] {
  const target = poses[targetIndex];
  if (!target) return [start];
  if (poses.length < 2) return [start, target];

  // Node ids: -1 = start, 0..n-1 = poses.
  const n = poses.length;
  const at = (id: number): Keyframe => (id === -1 ? start : poses[id]);
  const nearest = (id: number, count: number): number[] =>
    Array.from({ length: n }, (_, j) => j)
      .filter((j) => j !== id)
      .sort((a, b) => dist(at(id), poses[a]) - dist(at(id), poses[b]))
      .slice(0, count);

  // Undirected kNN graph over the poses, plus the start node linked to its
  // k nearest poses.
  const adj = new Map<number, Set<number>>();
  const ensure = (id: number): Set<number> => {
    let s = adj.get(id);
    if (!s) adj.set(id, (s = new Set()));
    return s;
  };
  const link = (a: number, b: number) => {
    ensure(a).add(b);
    ensure(b).add(a);
  };
  for (let i = 0; i < n; i++) for (const j of nearest(i, k)) link(i, j);
  for (const j of nearest(-1, k)) link(-1, j);

  // Dijkstra from start (-1) to the target. The graph is tiny (tens of nodes),
  // so we linear-scan the frontier instead of using a real heap.
  const best = new Map<number, number>([[-1, 0]]);
  const prev = new Map<number, number>();
  const done = new Set<number>();
  const frontier: number[] = [-1];
  while (frontier.length) {
    let bi = 0;
    for (let i = 1; i < frontier.length; i++)
      if ((best.get(frontier[i]) ?? Infinity) < (best.get(frontier[bi]) ?? Infinity)) bi = i;
    const u = frontier.splice(bi, 1)[0];
    if (u === targetIndex) break;
    if (done.has(u)) continue;
    done.add(u);
    for (const v of adj.get(u) ?? []) {
      if (done.has(v)) continue;
      const nd = (best.get(u) ?? Infinity) + dist(at(u), at(v));
      if (nd < (best.get(v) ?? Infinity)) {
        best.set(v, nd);
        prev.set(v, u);
        frontier.push(v);
      }
    }
  }

  if (!prev.has(targetIndex)) return [start, target]; // unreachable → straight hop

  const ids: number[] = [];
  for (let cur: number | undefined = targetIndex; cur !== undefined; cur = prev.get(cur)) {
    ids.push(cur);
    if (cur === -1) break;
  }
  return ids.reverse().map(at);
}
