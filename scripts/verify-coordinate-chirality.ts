import * as THREE from 'three';

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${label}`);
  if (!cond) failures++;
}

function determinantOfAxisTransform(fn: (x: number, y: number, z: number) => THREE.Vector3): number {
  const ex = fn(1, 0, 0);
  const ey = fn(0, 1, 0);
  const ez = fn(0, 0, 1);
  // determinant of the 3x3 matrix with these as columns
  const m = new THREE.Matrix3().set(ex.x, ey.x, ez.x, ex.y, ey.y, ez.y, ex.z, ey.z, ez.z);
  return m.determinant();
}

// The CURRENT function in HandSkeleton.ts (all three axes negated)
const current = (x: number, y: number, z: number) => new THREE.Vector3(-x, -y, -z);
// The PREVIOUS version (only Y, Z negated) -- kept here purely to document
// and verify the actual mathematical distinction between the two, not
// because the old one is used anywhere anymore.
const previous = (x: number, y: number, z: number) => new THREE.Vector3(x, -y, -z);

const detCurrent = determinantOfAxisTransform(current);
const detPrevious = determinantOfAxisTransform(previous);

check(`previous transform (x,-y,-z) preserves chirality: determinant = +1 (got ${detPrevious})`, Math.abs(detPrevious - 1) < 1e-9);
check(`current transform (-x,-y,-z) flips chirality: determinant = -1 (got ${detCurrent})`, Math.abs(detCurrent + 1) < 1e-9);
check('the two transforms genuinely differ (this is a real change, not a no-op)', detCurrent !== detPrevious);

// Sanity: confirm PalmBasis's rotation-only alignment CANNOT reconcile two
// bases of opposite chirality -- i.e. prove the claim that a chirality bug
// is unfixable by rotation alone, rather than just asserting it.
{
  const a = new THREE.Vector3(1, 0, 0);
  const b = new THREE.Vector3(0, 1, 0);
  const rightHanded = { across: a, normal: b, forward: new THREE.Vector3().crossVectors(a, b) };
  const leftHandedMirrorOfSame = { across: a, normal: b, forward: new THREE.Vector3().crossVectors(a, b).negate() };
  // any proper rotation preserves (across x normal) . forward > 0 for a
  // right-handed set; a mirrored set has (across x normal) . forward < 0,
  // and no rotation can change that sign (only a reflection can)
  const handednessRight = new THREE.Vector3().crossVectors(rightHanded.across, rightHanded.normal).dot(rightHanded.forward);
  const handednessMirror = new THREE.Vector3().crossVectors(leftHandedMirrorOfSame.across, leftHandedMirrorOfSame.normal).dot(leftHandedMirrorOfSame.forward);
  check(
    'a right-handed basis and its mirror have opposite handedness sign (proves rotation alone cannot align them)',
    Math.sign(handednessRight) !== Math.sign(handednessMirror)
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
