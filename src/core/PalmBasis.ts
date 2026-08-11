import * as THREE from 'three';
import type { HandSkeleton } from './HandSkeleton';

/**
 * An orthonormal reference frame derived from anatomically stable points
 * (wrist + the three MCP/knuckle joints), used to describe hand orientation
 * independent of whatever arbitrary coordinate convention the underlying
 * data happens to be expressed in.
 */
export interface PalmBasis {
  origin: THREE.Vector3;
  across: THREE.Vector3; // roughly index-side -> pinky-side across the knuckle row
  normal: THREE.Vector3; // palm normal (perpendicular to the knuckle row and to `forward`)
  forward: THREE.Vector3; // wrist -> middle-knuckle direction
}

/**
 * Builds a right-handed orthonormal basis via Gram-Schmidt from four
 * anatomically stable landmarks (MCPs move far less than fingertips do
 * across poses, which is exactly why they're used here rather than, say,
 * fingertips -- a stable reference is what makes this usable as an
 * orientation anchor at all).
 */
export function computePalmBasis(
  skeleton: HandSkeleton,
  wristKey: keyof HandSkeleton = 'WRIST',
  indexMcpKey: keyof HandSkeleton = 'INDEX_MCP',
  middleMcpKey: keyof HandSkeleton = 'MIDDLE_MCP',
  pinkyMcpKey: keyof HandSkeleton = 'PINKY_MCP'
): PalmBasis {
  const origin = skeleton[wristKey];
  const forward = skeleton[middleMcpKey].clone().sub(origin).normalize();
  const acrossRaw = skeleton[indexMcpKey].clone().sub(skeleton[pinkyMcpKey]).normalize();
  const normal = new THREE.Vector3().crossVectors(forward, acrossRaw).normalize();
  const across = new THREE.Vector3().crossVectors(normal, forward).normalize(); // re-orthogonalized
  return { origin, across, normal, forward };
}

function basisRotationMatrix(basis: PalmBasis): THREE.Matrix4 {
  return new THREE.Matrix4().makeBasis(basis.across, basis.normal, basis.forward);
}

/**
 * The rotation that converts a direction vector expressed in `from`'s
 * ambient space into the equivalent direction in `to`'s ambient space --
 * "equivalent" meaning it has the same across/normal/forward components
 * relative to each basis. This is what actually bridges MediaPipe's tracking
 * space and the GLB's native space: apply this to a live-space direction and
 * the result is directly comparable to a bind-pose (GLB-native) direction.
 */
export function alignmentQuaternion(from: PalmBasis, to: PalmBasis): THREE.Quaternion {
  const qFrom = new THREE.Quaternion().setFromRotationMatrix(basisRotationMatrix(from));
  const qTo = new THREE.Quaternion().setFromRotationMatrix(basisRotationMatrix(to));
  // to_ambient = qTo * (qFrom^-1 * from_ambient)  =>  combined = qTo * qFrom^-1
  return qTo.multiply(qFrom.clone().invert());
}

/** Rotates every landmark in `skeleton` about `pivot` by `q`, preserving relative geometry (bends) while re-expressing the whole skeleton in a different ambient coordinate convention. */
export function rotateSkeletonAbout(skeleton: HandSkeleton, pivot: THREE.Vector3, q: THREE.Quaternion): HandSkeleton {
  const out = {} as HandSkeleton;
  for (const key of Object.keys(skeleton) as Array<keyof HandSkeleton>) {
    out[key] = skeleton[key].clone().sub(pivot).applyQuaternion(q).add(pivot);
  }
  return out;
}
