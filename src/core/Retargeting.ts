import * as THREE from 'three';
import { BONES, type HandSkeleton, type JointName } from './HandSkeleton';

/**
 * Retargeting stage (spec calls this "Inverse Kinematics"; see the Phase 1
 * note on why this is bone-direction retargeting rather than a classical IK
 * solve -- MediaPipe already gives us every joint's position, so there's no
 * under-determined chain to solve for).
 *
 * IMPORTANT CORRECTNESS NOTE (found on self-review, not from live testing --
 * there is no browser/camera in this environment):
 * An earlier version of this file computed each bone's rotation by aligning
 * WORLD-space bind/live direction vectors and assigning the result straight
 * to bone.quaternion (a LOCAL rotation). That is only correct for bones
 * whose parent never rotates. Once a parent bone (e.g. an MCP joint) has
 * itself been retargeted, its children (PIP/DIP/TIP) need the live target
 * direction expressed in THAT PARENT's current world orientation, or the
 * parent's rotation gets double-applied and fingers over-rotate compounding
 * out toward the fingertips. Fixed below by walking the hierarchy
 * parent-before-child and tracking each joint's accumulated world rotation
 * explicitly, rather than trusting Three.js's (not-yet-updated-mid-loop)
 * matrixWorld or re-deriving from raw world vectors.
 */

/** Captured once, right after the model loads, from its authored bind pose. */
export type BindPose = Partial<Record<JointName, THREE.Vector3>>;

export function captureBindPose(bones: Partial<Record<JointName, THREE.Bone>>): BindPose {
  const pose: BindPose = {};
  for (const name of Object.keys(bones) as JointName[]) {
    const bone = bones[name];
    // Caller must have run updateMatrixWorld(true) on the model before this --
    // freshly-loaded bones haven't had their matrixWorld computed yet, and
    // getWorldPosition() would silently return stale/identity data otherwise.
    if (bone) pose[name] = bone.getWorldPosition(new THREE.Vector3());
  }
  return pose;
}

// Precomputed once when the bind pose is captured (see precomputeBindDirs).
export type BindDirs = Partial<Record<JointName, THREE.Vector3>>;

export function precomputeBindDirs(bindPose: BindPose): BindDirs {
  const dirs: BindDirs = {};
  for (const { parent, child } of BONES) {
    const p = bindPose[parent];
    const c = bindPose[child];
    if (!p || !c) continue;
    dirs[child] = c.clone().sub(p).normalize();
  }
  return dirs;
}

const _targetLocal = new THREE.Vector3();
const _liveDir = new THREE.Vector3();
const _invParentQuat = new THREE.Quaternion();
const _quat = new THREE.Quaternion();
const _worldQuat: Partial<Record<JointName, THREE.Quaternion>> = {};

/**
 * Applies live tracking to the model's skeleton in place. Call once per
 * rendered frame with the current filtered HandSkeleton.
 *
 * `rootWorldQuat` is the world rotation of whatever the skeleton root's
 * parent is (handGroup) -- pass identity unless that group is itself
 * rotated. BONES must be ordered parent-before-child (true for the
 * finger chains as defined in HandSkeleton.ts: each finger's own array
 * literal is already MCP->PIP->DIP->TIP in order).
 */
export function applyRetargeting(
  bones: Partial<Record<JointName, THREE.Bone>>,
  bindDirs: BindDirs,
  live: HandSkeleton,
  rootWorldQuat: THREE.Quaternion = new THREE.Quaternion()
): void {
  _worldQuat.WRIST = rootWorldQuat;

  for (const { parent, child } of BONES) {
    const bone = bones[child];
    const bindDirLocal = bindDirs[child];
    const parentWorldQuat = _worldQuat[parent];
    const liveParent = live[parent];
    const liveChild = live[child];
    if (!bone || !bindDirLocal || !parentWorldQuat || !liveParent || !liveChild) continue;

    _liveDir.subVectors(liveChild, liveParent).normalize();

    // bring the live world-space direction into the parent's current local
    // frame before comparing it to the (also parent-local) bind direction
    _invParentQuat.copy(parentWorldQuat).invert();
    _targetLocal.copy(_liveDir).applyQuaternion(_invParentQuat);

    _quat.setFromUnitVectors(bindDirLocal, _targetLocal);
    bone.quaternion.copy(_quat);

    // accumulate for this bone's own children, if any
    const childWorldQuat = _worldQuat[child] ?? new THREE.Quaternion();
    childWorldQuat.copy(parentWorldQuat).multiply(_quat);
    _worldQuat[child] = childWorldQuat;
  }
}

/** Root placement: moves the whole hand using wrist position only (no rotation yet -- stylized approach doesn't need forearm orientation matching). */
export function applyRootPlacement(
  rootBone: THREE.Bone,
  live: HandSkeleton,
  targetPosition: THREE.Vector3
): void {
  rootBone.position.copy(targetPosition);
  void live; // reserved: wrist-forward direction could orient the root later if needed
}
