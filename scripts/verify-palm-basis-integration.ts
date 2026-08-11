import * as THREE from 'three';
import { computePalmBasis, alignmentQuaternion, rotateSkeletonAbout } from '../src/core/PalmBasis';
import { precomputeBindDirs, applyRetargeting } from '../src/core/Retargeting';
import type { HandSkeleton, JointName } from '../src/core/HandSkeleton';

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${label}`);
  if (!cond) failures++;
}
function angleDeg(q: THREE.Quaternion): number {
  const w = Math.min(1, Math.max(-1, Math.abs(q.w)));
  return THREE.MathUtils.radToDeg(2 * Math.acos(w));
}

// Bind skeleton with a real finger chain (WRIST -> INDEX_MCP -> INDEX_PIP),
// in a deliberately non-axis-aligned "arbitrary GLB orientation" -- same
// spirit as the real hand.glb not being authored in any standard convention.
function makeBindSkeleton(): HandSkeleton {
  const s = {} as HandSkeleton;
  s.WRIST = new THREE.Vector3(0, 0, 0);
  s.INDEX_MCP = new THREE.Vector3(0.3, 0.9, 0.2);
  s.MIDDLE_MCP = new THREE.Vector3(0.1, 1.0, 0.4);
  s.PINKY_MCP = new THREE.Vector3(-0.3, 0.85, 0.1);
  s.INDEX_PIP = s.INDEX_MCP.clone().add(new THREE.Vector3(0.05, 0.35, 0.08)); // straight continuation
  const rest: JointName[] = [
    'THUMB_CMC', 'THUMB_MCP', 'THUMB_IP', 'THUMB_TIP', 'INDEX_DIP', 'INDEX_TIP',
    'MIDDLE_PIP', 'MIDDLE_DIP', 'MIDDLE_TIP',
    'RING_MCP', 'RING_PIP', 'RING_DIP', 'RING_TIP',
    'PINKY_PIP', 'PINKY_DIP', 'PINKY_TIP',
  ];
  rest.forEach((n, i) => { s[n] = new THREE.Vector3(0.1 * i, 1.2 + 0.05 * i, 0.3); });
  return s;
}

const bindSkeleton = makeBindSkeleton();
const bindBasis = computePalmBasis(bindSkeleton);
const bindDirs = precomputeBindDirs(bindSkeleton);

// Bones stub (identity local rotation to start; applyRetargeting overwrites them)
const bones: Partial<Record<JointName, THREE.Bone>> = {};
for (const name of Object.keys(bindSkeleton) as JointName[]) {
  const b = new THREE.Bone();
  b.name = name;
  bones[name] = b;
}

// --- Build the LIVE skeleton: whole-hand rotated 50deg about an arbitrary
// axis, PLUS a genuine 40deg bend added at INDEX_PIP (rotating everything
// distal to INDEX_MCP around it) ---
const rootRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0.3, 1, 0.2).normalize(), THREE.MathUtils.degToRad(50));
let liveSkeleton = rotateSkeletonAbout(bindSkeleton, bindSkeleton.WRIST, rootRotation);

// add a real local bend at INDEX_PIP: rotate INDEX_PIP (and anything distal,
// none in this test) about INDEX_MCP, by 40deg around an axis perpendicular
// to the finger -- done in the ALREADY-rotated live frame, exactly like a
// real independent finger bend would look after the whole hand turned.
const bendAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(rootRotation);
const bendQuat = new THREE.Quaternion().setFromAxisAngle(bendAxis, THREE.MathUtils.degToRad(40));
const indexMcpLive = liveSkeleton.INDEX_MCP.clone();
liveSkeleton = {
  ...liveSkeleton,
  INDEX_PIP: liveSkeleton.INDEX_PIP.clone().sub(indexMcpLive).applyQuaternion(bendQuat).add(indexMcpLive),
};

// --- Run the actual alignment + retargeting pipeline ---
const liveBasis = computePalmBasis(liveSkeleton);
const qAlign = alignmentQuaternion(liveBasis, bindBasis);
const qRoot = qAlign.clone().invert();
bones.WRIST!.quaternion.copy(qRoot);

const alignedLive = rotateSkeletonAbout(liveSkeleton, liveSkeleton.WRIST, qAlign);
applyRetargeting(bones, bindDirs, alignedLive);

check(`Q_root recovers the 50deg whole-hand rotation (got ${angleDeg(qRoot).toFixed(2)}deg)`, Math.abs(angleDeg(qRoot) - 50) < 1.0);
check(
  `INDEX_MCP shows ~0deg local rotation -- the whole-hand rotation did NOT leak into a finger-bone quaternion (got ${angleDeg(bones.INDEX_MCP!.quaternion).toFixed(2)}deg)`,
  angleDeg(bones.INDEX_MCP!.quaternion) < 1.0
);
check(
  `INDEX_PIP recovers the real 40deg bend, isolated from the root rotation (got ${angleDeg(bones.INDEX_PIP!.quaternion).toFixed(2)}deg)`,
  Math.abs(angleDeg(bones.INDEX_PIP!.quaternion) - 40) < 1.0
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
