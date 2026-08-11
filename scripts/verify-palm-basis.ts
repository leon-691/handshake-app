import * as THREE from 'three';
import { computePalmBasis, alignmentQuaternion, rotateSkeletonAbout } from '../src/core/PalmBasis';
import type { HandSkeleton, JointName } from '../src/core/HandSkeleton';

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${label}`);
  if (!cond) failures++;
}
function quatAngleDeg(q: THREE.Quaternion): number {
  const w = Math.min(1, Math.max(-1, Math.abs(q.w)));
  return THREE.MathUtils.radToDeg(2 * Math.acos(w));
}

// A plausible bind skeleton (rough hand shape, arbitrary "native" orientation --
// deliberately NOT axis-aligned, to mimic the real GLB's arbitrary orientation)
function makeBindSkeleton(): HandSkeleton {
  const s = {} as HandSkeleton;
  s.WRIST = new THREE.Vector3(0, 0, 0);
  s.INDEX_MCP = new THREE.Vector3(0.3, 0.9, 0.2);
  s.MIDDLE_MCP = new THREE.Vector3(0.1, 1.0, 0.4);
  s.PINKY_MCP = new THREE.Vector3(-0.3, 0.85, 0.1);
  // fill remaining joints with plausible-ish points so HandSkeleton's full shape is present
  const names: JointName[] = [
    'THUMB_CMC', 'THUMB_MCP', 'THUMB_IP', 'THUMB_TIP',
    'INDEX_PIP', 'INDEX_DIP', 'INDEX_TIP',
    'MIDDLE_PIP', 'MIDDLE_DIP', 'MIDDLE_TIP',
    'RING_MCP', 'RING_PIP', 'RING_DIP', 'RING_TIP',
    'PINKY_PIP', 'PINKY_DIP', 'PINKY_TIP',
  ];
  names.forEach((n, i) => { s[n] = new THREE.Vector3(0.1 * i, 1.2 + 0.05 * i, 0.3); });
  return s;
}

const bindSkeleton = makeBindSkeleton();
const bindBasis = computePalmBasis(bindSkeleton);

// sanity: basis should be orthonormal and right-handed
const dotAF = bindBasis.across.dot(bindBasis.forward);
const dotAN = bindBasis.across.dot(bindBasis.normal);
const dotNF = bindBasis.normal.dot(bindBasis.forward);
check('basis vectors mutually orthogonal', Math.abs(dotAF) < 1e-6 && Math.abs(dotAN) < 1e-6 && Math.abs(dotNF) < 1e-6);
check('basis vectors unit length', Math.abs(bindBasis.across.length() - 1) < 1e-6 && Math.abs(bindBasis.normal.length() - 1) < 1e-6 && Math.abs(bindBasis.forward.length() - 1) < 1e-6);
const handedness = new THREE.Vector3().crossVectors(bindBasis.across, bindBasis.normal).dot(bindBasis.forward);
check('basis is right-handed (across x normal ~= forward)', handedness > 0.99);

// --- Case 1: live == bind exactly -> alignment should be identity ---
const qIdentityCase = alignmentQuaternion(bindBasis, bindBasis);
check(`identical bases -> alignment ~= identity (angle=${quatAngleDeg(qIdentityCase).toFixed(3)}deg)`, quatAngleDeg(qIdentityCase) < 0.01);

// --- Case 2: live = bind rigidly rotated by a KNOWN rotation, no additional bending ---
const knownRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(37));
const liveSkeleton = rotateSkeletonAbout(bindSkeleton, bindSkeleton.WRIST, knownRotation);
const liveBasis = computePalmBasis(liveSkeleton);

const qAlign = alignmentQuaternion(liveBasis, bindBasis); // live-space -> GLB-native-equivalent
const qRoot = qAlign.clone().invert(); // world/render orientation to apply to WRIST

check(
  `Q_root recovers the known 37deg rotation (got ${quatAngleDeg(qRoot).toFixed(2)}deg)`,
  Math.abs(quatAngleDeg(qRoot) - 37) < 0.5
);

// after aligning the live skeleton via qAlign, its directions should match the
// bind skeleton's directions almost exactly (since the ONLY difference was a
// rigid rotation, which qAlign is specifically built to cancel)
const alignedLive = rotateSkeletonAbout(liveSkeleton, liveSkeleton.WRIST, qAlign);
let maxResidualAngle = 0;
for (const key of ['INDEX_MCP', 'MIDDLE_MCP', 'PINKY_MCP'] as JointName[]) {
  const bindDir = bindSkeleton[key].clone().sub(bindSkeleton.WRIST).normalize();
  const alignedDir = alignedLive[key].clone().sub(alignedLive.WRIST).normalize();
  const angle = THREE.MathUtils.radToDeg(bindDir.angleTo(alignedDir));
  maxResidualAngle = Math.max(maxResidualAngle, angle);
}
check(`after alignment, finger-reference directions match bind almost exactly (max residual=${maxResidualAngle.toFixed(3)}deg)`, maxResidualAngle < 0.5);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
