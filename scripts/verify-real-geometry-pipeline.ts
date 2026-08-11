import * as THREE from 'three';
import fs from 'fs';
import { computePalmBasis, alignmentQuaternion, rotateSkeletonAbout } from '../src/core/PalmBasis';
import { precomputeBindDirs, applyRetargeting } from '../src/core/Retargeting';
import { BONES, type HandSkeleton, type JointName } from '../src/core/HandSkeleton';

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${label}`);
  if (!cond) failures++;
}

const raw = JSON.parse(fs.readFileSync(new URL('./real-bind-pose.json', import.meta.url), 'utf-8'));
const bindSkeleton = {} as HandSkeleton;
for (const [name, xyz] of Object.entries(raw) as Array<[JointName, number[]]>) {
  bindSkeleton[name] = new THREE.Vector3(...(xyz as [number, number, number]));
}
check('loaded all 21 real joints from hand.glb', Object.keys(bindSkeleton).length === 21);

const bindBasis = computePalmBasis(bindSkeleton);
const bindDirs = precomputeBindDirs(bindSkeleton);

function makeBones(): Partial<Record<JointName, THREE.Bone>> {
  const bones: Partial<Record<JointName, THREE.Bone>> = {};
  for (const name of Object.keys(bindSkeleton) as JointName[]) {
    const b = new THREE.Bone();
    b.name = name;
    bones[name] = b;
  }
  return bones;
}

function isFinite3(v: THREE.Vector3) {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}
function isFiniteQuat(q: THREE.Quaternion) {
  return Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w);
}

// A handful of plausible "camera + hand" orientations a real session might
// produce: near-identity (facing camera dead-on), and several meaningful
// tilts/turns, applied to the REAL bind geometry (not a synthetic stand-in).
const scenarios: Array<{ label: string; axis: THREE.Vector3; deg: number }> = [
  { label: 'near bind orientation', axis: new THREE.Vector3(0, 1, 0), deg: 2 },
  { label: 'rotated 45deg around Y (turning hand)', axis: new THREE.Vector3(0, 1, 0), deg: 45 },
  { label: 'rotated 90deg around Y (hand edge-on)', axis: new THREE.Vector3(0, 1, 0), deg: 90 },
  { label: 'rotated 170deg (near worst-case for antiparallel edge cases)', axis: new THREE.Vector3(0.2, 1, 0.1).normalize(), deg: 170 },
  { label: 'tilted around X (wrist flex)', axis: new THREE.Vector3(1, 0, 0), deg: 60 },
  { label: 'compound tilt', axis: new THREE.Vector3(0.5, 0.7, 0.3).normalize(), deg: 80 },
];

for (const { label, axis, deg } of scenarios) {
  const q = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(deg));
  const liveSkeleton = rotateSkeletonAbout(bindSkeleton, bindSkeleton.WRIST, q);
  const liveBasis = computePalmBasis(liveSkeleton);
  const qAlign = alignmentQuaternion(liveBasis, bindBasis);
  const qRoot = qAlign.clone().invert();

  const bones = makeBones();
  bones.WRIST!.quaternion.copy(qRoot);
  const alignedLive = rotateSkeletonAbout(liveSkeleton, liveSkeleton.WRIST, qAlign);
  applyRetargeting(bones, bindDirs, alignedLive);

  let allFinite = isFiniteQuat(qRoot);
  let maxBendDeg = 0;
  for (const { child } of BONES) {
    const bone = bones[child];
    if (!bone) continue;
    if (!isFiniteQuat(bone.quaternion)) allFinite = false;
    const w = Math.min(1, Math.max(-1, Math.abs(bone.quaternion.w)));
    maxBendDeg = Math.max(maxBendDeg, THREE.MathUtils.radToDeg(2 * Math.acos(w)));
  }
  check(`[${label}] all quaternions finite (no NaN/Infinity)`, allFinite);
  // pure rigid rotation (no actual finger bend introduced) -> residual
  // per-bone rotation should stay small even at extreme root orientations,
  // confirming the root/finger separation holds up on real geometry too
  check(`[${label}] residual finger rotation stays small with no real bend applied (max=${maxBendDeg.toFixed(2)}deg)`, maxBendDeg < 3.0);
}

// --- one scenario with a REAL bend added on top of a rotation, on real geometry ---
{
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0.3, 1, 0).normalize(), THREE.MathUtils.degToRad(35));
  let liveSkeleton = rotateSkeletonAbout(bindSkeleton, bindSkeleton.WRIST, q);
  // curl the index finger: rotate INDEX_PIP/DIP/TIP about INDEX_MCP by 50deg
  // around an axis roughly perpendicular to the finger, in the now-rotated live frame
  const mcp = liveSkeleton.INDEX_MCP.clone();
  const fingerDir = liveSkeleton.INDEX_TIP.clone().sub(mcp).normalize();
  const arbitrary = Math.abs(fingerDir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const bendAxis = new THREE.Vector3().crossVectors(fingerDir, arbitrary).normalize();
  const bendQuat = new THREE.Quaternion().setFromAxisAngle(bendAxis, THREE.MathUtils.degToRad(50));
  for (const key of ['INDEX_PIP', 'INDEX_DIP', 'INDEX_TIP'] as JointName[]) {
    liveSkeleton = { ...liveSkeleton, [key]: liveSkeleton[key].clone().sub(mcp).applyQuaternion(bendQuat).add(mcp) };
  }

  const liveBasis = computePalmBasis(liveSkeleton);
  const qAlign = alignmentQuaternion(liveBasis, bindBasis);
  const bones = makeBones();
  bones.WRIST!.quaternion.copy(qAlign.clone().invert());
  const alignedLive = rotateSkeletonAbout(liveSkeleton, liveSkeleton.WRIST, qAlign);
  applyRetargeting(bones, bindDirs, alignedLive);

  const w = Math.min(1, Math.max(-1, Math.abs(bones.INDEX_PIP!.quaternion.w)));
  const pipBend = THREE.MathUtils.radToDeg(2 * Math.acos(w));
  check(
    `real geometry: rotation + real 50deg index curl recovers a real bend at INDEX_PIP, not ~0 (got ${pipBend.toFixed(2)}deg)`,
    pipBend > 10
  );
  check('real geometry: other fingers (RING_MCP) stay near bind (no cross-contamination)', (() => {
    const wr = Math.min(1, Math.max(-1, Math.abs(bones.RING_MCP!.quaternion.w)));
    return THREE.MathUtils.radToDeg(2 * Math.acos(wr)) < 5;
  })());
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
