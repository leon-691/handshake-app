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
 * MediaPipe's coordinate space has +Y pointing down the image and +Z pointing
 * toward the camera being treated as negative depth -- the (y,z) negation
 * below is the standard flip to bring that into a Y-up right-handed scene.
 * This has NOT been verified against a live camera (no browser/camera in
 * this environment) -- if the model reads as mirrored or upside-down on
 * first real test, flip the sign of Y and/or Z here, it's isolated to this
 * one function.
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
    skeleton[name] = new THREE.Vector3(p.x, -p.y, -p.z);
  }
  return skeleton;
}
