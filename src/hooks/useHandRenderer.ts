import { useEffect } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useStore } from '../store/useStore';
import { JOINT_NAMES, type JointName, skeletonFromWorldLandmarks } from '../core/HandSkeleton';
import { captureBindPose, precomputeBindDirs, applyRetargeting, type BindDirs } from '../core/Retargeting';
import { PoseDelayBuffer } from '../core/PoseBuffer';

// Built from BASE_URL (not a hardcoded '/models/hand.glb') for the same
// reason vite.config.ts sets base:'./' -- a plain string here isn't
// rewritten by Vite's bundler the way static imports are, so under a
// GitHub Pages subpath it would 404 even after the HTML/JS path fix.
const MODEL_URL = `${import.meta.env.BASE_URL}models/hand.glb`;

// Phase 1 spec: "delay kecil +-20-40ms agar terasa alami" -- picked the
// midpoint. This is a perceptual/feel parameter that genuinely needs a real
// camera + screen to tune; not verified live, isolated here to make that easy.
const RESPONSE_DELAY_MS = 30;

// How long the "reaches in from the opposite side" entry animation takes.
// Not specified numerically in Phase 1 (only the steady-state 20-40ms
// response delay was) -- this is our own reasonable choice for a hand
// extending into frame, flagged so it's easy to challenge/retune.
const ENTRY_DURATION_MS = 500;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export const useHandRenderer = (canvasRef: React.RefObject<HTMLCanvasElement | null>) => {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new THREE.Scene();
    scene.background = null; // was THREE.Color(0x0f0f0f) -- that opaque fill defeated the
    // renderer's alpha:true and hid the camera video the canvas is meant to composite over.

    const camera = new THREE.PerspectiveCamera(
      45,
      Math.max(canvas.clientWidth, 1) / Math.max(canvas.clientHeight, 1),
      0.1,
      1000
    );
    camera.position.set(0, 0, 4);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    keyLight.position.set(1, 2, 3);
    scene.add(hemiLight, keyLight);

    const handGroup = new THREE.Group();
    scene.add(handGroup);

    let bones: Partial<Record<JointName, THREE.Bone>> = {};
    let bindDirs: BindDirs = {};
    let rootBone: THREE.Bone | null = null;
    let modelLoaded = false;
    let disposed = false;

    const loader = new GLTFLoader();
    loader.load(
      MODEL_URL,
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        handGroup.add(model);
        // Freshly-added bones haven't had their matrixWorld computed yet --
        // without this, captureBindPose() reads stale/identity transforms
        // instead of the model's actual authored bind pose (found on
        // self-review; would have silently produced a broken bind pose).
        model.updateMatrixWorld(true);

        model.traverse((obj) => {
          if ((obj as THREE.Bone).isBone) {
            const bone = obj as THREE.Bone;
            if ((JOINT_NAMES as readonly string[]).includes(bone.name)) {
              bones[bone.name as JointName] = bone;
            }
          }
        });
        rootBone = bones.WRIST ?? null;
        const bindPose = captureBindPose(bones);
        bindDirs = precomputeBindDirs(bindPose);
        modelLoaded = Object.keys(bindDirs).length > 0;

        if (!modelLoaded) {
          console.warn(
            '[useHandRenderer] hand.glb loaded but no bones matched the expected joint names -- retargeting will be a no-op.'
          );
        }
      },
      undefined,
      (err) => {
        console.error('[useHandRenderer] failed to load hand model:', err);
      }
    );

    const tmpSkeletonPos = new THREE.Vector3();
    const poseBuffer = new PoseDelayBuffer(200);
    let wasHandPresent = false;
    let entryStartTimeMs: number | null = null;
    const entryStartPos = new THREE.Vector3();
    const lastTargetPos = new THREE.Vector3();

    const animate = () => {
      if (disposed) return;
      rafId = requestAnimationFrame(animate);
      const nowMs = performance.now();

      // Read the store directly instead of subscribing via the hook, so this
      // effect (and the Three.js scene/renderer it owns) is created ONCE --
      // not torn down and rebuilt on every landmark update like the previous
      // version did (its effect depended on `landmarks`, re-running ~every frame).
      const { worldLandmarks, landmarks } = useStore.getState();
      const handPresent = !!(worldLandmarks && worldLandmarks.length === 21);

      if (handPresent) {
        poseBuffer.push(nowMs, worldLandmarks);
      }

      if (!handPresent && wasHandPresent) {
        // hand left frame -- next re-entry should replay the from-the-side
        // animation rather than resume mid-way through a stale one
        entryStartTimeMs = null;
        poseBuffer.reset();
      }

      // Hide the virtual hand entirely rather than leaving it frozen in its
      // last pose when there's no active hand to drive it (camera off, hand
      // out of frame, or model still loading) -- found missing on review.
      handGroup.visible = modelLoaded && handPresent;

      if (modelLoaded && handPresent) {
        // Pose Filtering already smoothed jitter (in HandDetector); this
        // delay buffer adds the deliberate small lag from the spec so the
        // virtual hand reads as reacting to the tracked hand rather than
        // being a perfect, instantaneous mirror of it.
        const delayed = poseBuffer.sampleDelayed(nowMs, RESPONSE_DELAY_MS) ?? worldLandmarks;
        const live = skeletonFromWorldLandmarks(delayed);
        applyRetargeting(bones, bindDirs, live);

        // On-screen placement uses the normalized (image-space) landmark for
        // the wrist, NOT worldLandmarks -- worldLandmarks are metric/relative
        // to the hand's own centroid and carry no on-screen position info.
        const firstHand = landmarks?.[0];
        const wrist2D = firstHand?.[0];
        if (rootBone && wrist2D) {
          tmpSkeletonPos.set((wrist2D.x - 0.5) * 4, (0.5 - wrist2D.y) * 4, 0);
          lastTargetPos.copy(tmpSkeletonPos);

          if (!wasHandPresent) {
            // Hand just (re)appeared: start the virtual hand from the
            // opposite horizontal side (mirror the X around screen center,
            // per "muncul dari sisi berlawanan" in the spec) and ease it in
            // to meet the tracked position, instead of snapping there.
            entryStartTimeMs = nowMs;
            entryStartPos.set(-tmpSkeletonPos.x, tmpSkeletonPos.y, tmpSkeletonPos.z);
            handGroup.position.copy(entryStartPos);
          }

          if (entryStartTimeMs !== null) {
            const t = Math.min(1, (nowMs - entryStartTimeMs) / ENTRY_DURATION_MS);
            handGroup.position.lerpVectors(entryStartPos, lastTargetPos, easeOutCubic(t));
            if (t >= 1) entryStartTimeMs = null; // entry finished, follow live position directly from here
          } else {
            handGroup.position.copy(lastTargetPos);
          }
        }
      }
      wasHandPresent = handPresent;

      renderer.render(scene, camera);
    };
    let rafId = requestAnimationFrame(animate);

    const handleResize = () => {
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      handGroup.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = (obj as THREE.Mesh).material;
        if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((m) => m.dispose());
      });
      handGroup.clear();
      bones = {};
      renderer.dispose();
    };
    // Intentionally empty dep array beyond canvasRef itself: this effect owns
    // the Three.js lifecycle exactly once. Live data is read via getState()
    // inside the render loop above.
  }, [canvasRef]);
};
