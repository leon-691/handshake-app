/**
 * Screen-space <-> world-space conversion, derived directly from the actual
 * camera parameters (vertical FOV, aspect, distance) -- not a fitted/guessed
 * constant. This is what makes normalized (0..1) landmark coordinates land
 * at a specific, correct place in the Three.js scene at a chosen depth.
 *
 * Pure functions (no Three.js/DOM dependency) so they can be unit tested
 * directly -- see scripts/verify-screen-space.ts.
 */

export interface CameraParams {
  /** Vertical field of view, in degrees (matches THREE.PerspectiveCamera's `fov`). */
  fovDegrees: number;
  /** canvas width / height. */
  aspect: number;
  /** Camera's position along Z, looking toward the origin (matches `camera.position.z` when position is (0,0,z) looking at (0,0,0)). */
  cameraZ: number;
}

/** Height, in world units, of the visible frustum slice at a given Z depth. */
export function visibleHeightAtDepth(camera: CameraParams, depthZ: number): number {
  const distance = camera.cameraZ - depthZ;
  const fovRad = (camera.fovDegrees * Math.PI) / 180;
  return 2 * distance * Math.tan(fovRad / 2);
}

export interface WorldPoint2D {
  x: number;
  y: number;
}

/**
 * Converts a normalized image-space coordinate (0..1, y-down, MediaPipe's
 * convention) to world-space X/Y at the given depth (world is Y-up, so the Y
 * sense flips here -- this is the ONLY place that flip happens for on-screen
 * placement; HandSkeleton.ts's Y flip is a separate, unrelated conversion for
 * the metric world-landmarks used in retargeting, not screen position).
 */
export function normalizedToWorld(nx: number, ny: number, depthZ: number, camera: CameraParams): WorldPoint2D {
  const visibleHeight = visibleHeightAtDepth(camera, depthZ);
  const visibleWidth = visibleHeight * camera.aspect;
  return {
    x: (nx - 0.5) * visibleWidth,
    y: (0.5 - ny) * visibleHeight,
  };
}

/** Euclidean distance between two normalized image-space points, converted to world units at the given depth -- used to size the model against how big the real hand appears on screen. */
export function normalizedSpanToWorld(
  ax: number, ay: number, bx: number, by: number,
  depthZ: number,
  camera: CameraParams
): number {
  const pa = normalizedToWorld(ax, ay, depthZ, camera);
  const pb = normalizedToWorld(bx, by, depthZ, camera);
  return Math.hypot(pb.x - pa.x, pb.y - pa.y);
}
