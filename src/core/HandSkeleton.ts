import * as THREE from 'three';

/**
 * Hand Skeleton stage.
 *
 * This is the abstraction layer between MediaPipe's raw landmark indices and
 * the 3D model's bone names. Nothing outside this file should know that
 * landmark 9 means "middle finger MCP" -- that mapping lives here, once.
 *
 * Joint names match the bones baked into public/models/hand.glb (see the
 * asset-prep notes from the rig-building pass). If a different model is
 * swapped in, only the bone-name strings need to line up with this list --
 * no other pipeline code changes.
 */
export const JOINT_NAMES = [
  'WRIST',
  'THUMB_CMC', 'THUMB_MCP', 'THUMB_IP', 'THUMB_TIP',
  'INDEX_MCP', 'INDEX_PIP', 'INDEX_DIP', 'INDEX_TIP',
  'MIDDLE_MCP', 'MIDDLE_PIP', 'MIDDLE_DIP', 'MIDDLE_TIP',
  'RING_MCP', 'RING_PIP', 'RING_DIP', 'RING_TIP',
  'PINKY_MCP', 'PINKY_PIP', 'PINKY_DIP', 'PINKY_TIP',
] as const;

export type JointName = (typeof JOINT_NAMES)[number];

/** child -> parent, for every joint except the root (WRIST). */
export const PARENT_OF: Partial<Record<JointName, JointName>> = {
  THUMB_CMC: 'WRIST', THUMB_MCP: 'THUMB_CMC', THUMB_IP: 'THUMB_MCP', THUMB_TIP: 'THUMB_IP',
  INDEX_MCP: 'WRIST', INDEX_PIP: 'INDEX_MCP', INDEX_DIP: 'INDEX_PIP', INDEX_TIP: 'INDEX_DIP',
  MIDDLE_MCP: 'WRIST', MIDDLE_PIP: 'MIDDLE_MCP', MIDDLE_DIP: 'MIDDLE_PIP', MIDDLE_TIP: 'MIDDLE_DIP',
  RING_MCP: 'WRIST', RING_PIP: 'RING_MCP', RING_DIP: 'RING_PIP', RING_TIP: 'RING_DIP',
  PINKY_MCP: 'WRIST', PINKY_PIP: 'PINKY_MCP', PINKY_DIP: 'PINKY_PIP', PINKY_TIP: 'PINKY_DIP',
};

/** Every parent->child pair, i.e. every bone that needs a rotation during retargeting. */
export const BONES: Array<{ parent: JointName; child: JointName }> = (
  Object.entries(PARENT_OF) as Array<[JointName, JointName]>
).map(([child, parent]) => ({ parent, child }));

// MediaPipe HandLandmarker's landmark index -> our joint name.
// (Index order is MediaPipe's own fixed topology; see their HandLandmark enum.)
const MEDIAPIPE_INDEX_TO_JOINT: JointName[] = [
  'WRIST',
  'THUMB_CMC', 'THUMB_MCP', 'THUMB_IP', 'THUMB_TIP',
  'INDEX_MCP', 'INDEX_PIP', 'INDEX_DIP', 'INDEX_TIP',
  'MIDDLE_MCP', 'MIDDLE_PIP', 'MIDDLE_DIP', 'MIDDLE_TIP',
  'RING_MCP', 'RING_PIP', 'RING_DIP', 'RING_TIP',
  'PINKY_MCP', 'PINKY_PIP', 'PINKY_DIP', 'PINKY_TIP',
];

export type HandSkeleton = Record<JointName, THREE.Vector3>;

export interface MediaPipePoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Converts MediaPipe's 21 world-landmarks (metric, hand-relative, NOT the
 * normalized 0-1 image-space landmarks) into a named HandSkeleton in
 * Three.js's Y-up convention.
 *
 * All three axes are negated, not just Y/Z. Reasoning: MediaPipe's raw
 * convention (X right, Y down, Z increasing away from camera) is itself
 * right-handed, and negating exactly two axes (as an earlier version of
 * this function did, Y and Z only) is a proper rotation -- it preserves
 * chirality, it cannot introduce OR fix a reflection. If the live tracking
 * data and the GLB's bind-pose data don't actually share the same chirality
 * (plausible: the GLB's own coordinate convention comes verbatim from a
 * ZBrush/OBJ export whose handedness was never independently verified),
 * no amount of rotation-based alignment (see PalmBasis.ts) can correct for
 * it -- only an odd number of axis negations (a genuine reflection) can.
 * Negating all three here is the isolated, minimal way to do that.
 *
 * IMPORTANT CAVEAT: this is the best-reasoned hypothesis available without
 * a live camera to test against (Google's docs don't publish an explicit
 * per-axis sign convention for world landmarks), corroborated by at least
 * one independent MediaPipe+Three.js integration doing the same 3-axis
 * negation. It is not proven with certainty -- if poses still look
 * mirrored/backwards after this change, that's evidence against this
 * specific hypothesis, not a sign the general approach (chirality
 * mismatch) is wrong.
 */
export function skeletonFromWorldLandmarks(points: MediaPipePoint[]): HandSkeleton {
  if (points.length !== 21) {
    throw new Error(`Expected 21 landmarks, got ${points.length}`);
  }
  const skeleton = {} as HandSkeleton;
  for (let i = 0; i < 21; i++) {
    const name = MEDIAPIPE_INDEX_TO_JOINT[i];
    const p = points[i];
    if (!name || !p) continue; // unreachable given the length check above, but satisfies noUncheckedIndexedAccess
    skeleton[name] = new THREE.Vector3(-p.x, -p.y, -p.z);
  }
  return skeleton;
}
