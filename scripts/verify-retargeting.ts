import * as THREE from 'three';
import { precomputeBindDirs, applyRetargeting } from '../src/core/Retargeting';
import type { JointName } from '../src/core/HandSkeleton';

// Synthetic bind pose: a straight chain pointing +Y, unit-length bones.
// (Using real finger-chain names so applyRetargeting's BONES list finds them.)
const bindPose: Partial<Record<JointName, THREE.Vector3>> = {
  WRIST: new THREE.Vector3(0, 0, 0),
  INDEX_MCP: new THREE.Vector3(0, 1, 0),
  INDEX_PIP: new THREE.Vector3(0, 2, 0),
  INDEX_DIP: new THREE.Vector3(0, 3, 0),
  INDEX_TIP: new THREE.Vector3(0, 4, 0),
};
const bindDirs = precomputeBindDirs(bindPose);

// Live pose: MCP bends 90 degrees into +X, PIP CONTINUES STRAIGHT in that
// same new direction (no additional bend at the PIP joint itself).
const live: Partial<Record<JointName, THREE.Vector3>> = {
  WRIST: new THREE.Vector3(0, 0, 0),
  INDEX_MCP: new THREE.Vector3(1, 0, 0),
  INDEX_PIP: new THREE.Vector3(2, 0, 0),   // straight continuation of the MCP bend
  INDEX_DIP: new THREE.Vector3(2, 0, -1),  // THEN a genuine 90 degree bend at DIP
  INDEX_TIP: new THREE.Vector3(2, 0, -2),  // continuing straight after the DIP bend
};

const bones: Partial<Record<JointName, THREE.Bone>> = {};
for (const name of Object.keys(bindPose) as JointName[]) {
  const b = new THREE.Bone();
  b.name = name;
  bones[name] = b;
}

applyRetargeting(bones, bindDirs, live as any);

function angleDeg(q: THREE.Quaternion): number {
  const w = Math.min(1, Math.max(-1, q.w));
  return THREE.MathUtils.radToDeg(2 * Math.acos(Math.abs(w)));
}

console.log('INDEX_MCP local rotation (expect ~90deg, the real bend):', angleDeg(bones.INDEX_MCP!.quaternion).toFixed(2));
console.log('INDEX_PIP local rotation (expect ~0deg -- straight continuation, NOT compounded):', angleDeg(bones.INDEX_PIP!.quaternion).toFixed(2));
console.log('INDEX_DIP local rotation (expect ~90deg, the real second bend):', angleDeg(bones.INDEX_DIP!.quaternion).toFixed(2));
console.log('INDEX_TIP local rotation (expect ~0deg -- straight continuation after DIP):', angleDeg(bones.INDEX_TIP!.quaternion).toFixed(2));

// Independent cross-check: forward-kinematics the resulting local quaternions
// back out to world positions and compare against the intended `live` targets.
function fk() {
  const world: Partial<Record<JointName, { pos: THREE.Vector3; quat: THREE.Quaternion }>> = {
    WRIST: { pos: new THREE.Vector3(0, 0, 0), quat: new THREE.Quaternion() },
  };
  const order: JointName[] = ['INDEX_MCP', 'INDEX_PIP', 'INDEX_DIP', 'INDEX_TIP'];
  const parentOf: Record<string, JointName> = {
    INDEX_MCP: 'WRIST', INDEX_PIP: 'INDEX_MCP', INDEX_DIP: 'INDEX_PIP', INDEX_TIP: 'INDEX_DIP',
  };
  for (const name of order) {
    const parent = world[parentOf[name]]!;
    const localOffset = bindPose[name]!.clone().sub(bindPose[parentOf[name]]!); // parent-local rest offset
    const rotatedOffset = localOffset.clone().applyQuaternion(bones[name]!.quaternion).applyQuaternion(parent.quat);
    const pos = parent.pos.clone().add(rotatedOffset);
    const quat = parent.quat.clone().multiply(bones[name]!.quaternion);
    world[name] = { pos, quat };
  }
  return world;
}

const world = fk();
for (const name of ['INDEX_MCP', 'INDEX_PIP', 'INDEX_DIP', 'INDEX_TIP'] as JointName[]) {
  const got = world[name]!.pos;
  const want = live[name]!;
  const err = got.distanceTo(want);
  console.log(
    `${name}: FK world pos = (${got.x.toFixed(2)}, ${got.y.toFixed(2)}, ${got.z.toFixed(2)}) ` +
    `vs target (${want.x.toFixed(2)}, ${want.y.toFixed(2)}, ${want.z.toFixed(2)})  error=${err.toFixed(4)}`
  );
}
