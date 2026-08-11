import { useEffect } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useStore } from '../store/useStore';
import { JOINT_NAMES, type JointName, type HandSkeleton, skeletonFromWorldLandmarks } from '../core/HandSkeleton';
import { captureBindPose, precomputeBindDirs, applyRetargeting, type BindDirs } from '../core/Retargeting';
import { computePalmBasis, alignmentQuaternion, rotateSkeletonAbout, type PalmBasis } from '../core/PalmBasis';
import { PoseDelayBuffer } from '../core/PoseBuffer';
import { normalizedToWorld, normalizedSpanToWorld, type CameraParams } from '../core/ScreenSpace';

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

// Depth (world Z) the hand is placed at. MediaPipe doesn't give reliable
// absolute camera-to-hand distance (see Phase 1 notes on world-landmark
// limitations), so this is a fixed plane rather than derived per-frame --
// that's a real simplification, not a magic number standing in for a
// screen-space calculation like the old position formula was.
const HAND_DEPTH_Z = 0;

// MediaPipe landmark indices for WRIST and MIDDLE_FINGER_TIP -- used as the
// reference pair for both the model's own bind-pose size (measured from the
// loaded GLB, not hardcoded) and the live on-screen hand size.
const WRIST_IDX = 0;
const MIDDLE_TIP_IDX = 12;

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
    // updateStyle=false: let CSS (the .video-container/canvas rules) own the
    // canvas's DISPLAYED size; Three.js only controls the drawing-buffer
    // resolution. Found on review: the default (true) makes setSize() write
    // explicit pixel width/height directly onto canvas.style, which had been
    // silently overriding the CSS width:100%/height:100% -- and since it
    // only ran once at mount (before the video/container had a real size to
    // read), the canvas got locked to whatever near-zero/viewport-width
    // guess existed at that instant and never corrected itself except on an
    // actual window resize. This is what put the rendered hand outside the
    // video area.
    renderer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false);
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
    // Measured from the loaded model's own bind pose (WRIST -> MIDDLE_TIP
    // distance, in the GLB's native units) -- NOT a hardcoded constant, so a
    // different model swapped into public/models/hand.glb is sized correctly
    // automatically rather than needing this number hand-tuned again.
    let modelReferenceSize = 0;
    // Orthonormal reference frame from the model's OWN bind pose, computed
    // once at load. This is what makes retargeting correct at all: without
    // it, live (MediaPipe) directions and bind (GLB-native) directions were
    // being compared as if they shared a coordinate convention when they
    // don't -- see PalmBasis.ts for the full reasoning.
    let bindBasis: PalmBasis | null = null;

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

        // Root cause of the position bug: `model`'s WRIST bone has a large
        // non-zero LOCAL position baked in (inherited from the original,
        // never-recentered mesh coordinates -- measured directly from the
        // GLB as ~[-1.3, -1.63, 2.75]). Without this offset, the rendered
        // wrist position was `handGroup.position + thatOffset`, not
        // `handGroup.position` alone, so setting handGroup.position to the
        // tracked screen position never actually put the wrist there.
        // Canceling it here makes WRIST sit at local (0,0,0) relative to
        // handGroup, so handGroup.position alone is authoritative --
        // exactly the HandRoot/HandModel split suggested: handGroup is
        // HandRoot (follows tracked wrist), `model` is HandModel (carries
        // only this one-time recentering offset).
        if (bindPose.WRIST) {
          model.position.copy(bindPose.WRIST).negate();
          model.updateMatrixWorld(true);
        }

        if (bindPose.WRIST && bindPose.MIDDLE_TIP) {
          modelReferenceSize = bindPose.WRIST.distanceTo(bindPose.MIDDLE_TIP);
        }
        if (bindPose.WRIST && bindPose.INDEX_MCP && bindPose.MIDDLE_MCP && bindPose.PINKY_MCP) {
          // safe: the four keys computePalmBasis actually reads are all
          // confirmed present right above, even though BindPose's type is
          // Partial<HandSkeleton> in general
          bindBasis = computePalmBasis(bindPose as HandSkeleton);
        }
        if (!modelLoaded || modelReferenceSize === 0 || !bindBasis) {
          console.warn(
            '[useHandRenderer] hand.glb loaded but bones/reference-size/orientation-basis could not be established -- retargeting and scaling will be a no-op.'
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
    let smoothedScale = 0; // exponentially smoothed -- the raw per-frame
    // scale from a 2-landmark screen-space distance is noisier than
    // position (small pixel jitter in either point has an outsized effect
    // on a distance measurement), so this is smoothed the same conceptual
    // way OneEuroFilter smooths landmarks, just applied to a derived scalar.

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
        smoothedScale = 0;
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

        if (bindBasis) {
          // Bridge the two coordinate conventions (see PalmBasis.ts): find
          // the rotation between the live hand's own orientation and the
          // model's bind-pose orientation, apply the inverse to the WRIST
          // bone (so the whole forearm/hand visually points the right way),
          // and re-express the live skeleton in "GLB-native-equivalent"
          // terms before doing per-bone retargeting -- otherwise bind and
          // live directions are being compared across mismatched coordinate
          // systems, which is what produced the earlier twisted/broken poses.
          const liveBasis = computePalmBasis(live);
          const qAlign = alignmentQuaternion(liveBasis, bindBasis);
          if (bones.WRIST) {
            bones.WRIST.quaternion.copy(qAlign).invert();
          }
          const alignedLive = rotateSkeletonAbout(live, live.WRIST, qAlign);
          applyRetargeting(bones, bindDirs, alignedLive);
        }

        // On-screen placement/scale use the normalized (image-space)
        // landmarks, NOT worldLandmarks -- worldLandmarks are metric/relative
        // to the hand's own centroid and carry no on-screen position or
        // apparent-size information at all.
        const firstHand = landmarks?.[0];
        const wrist2D = firstHand?.[WRIST_IDX];
        const middleTip2D = firstHand?.[MIDDLE_TIP_IDX];
        if (rootBone && wrist2D) {
          const camParams: CameraParams = { fovDegrees: camera.fov, aspect: camera.aspect, cameraZ: camera.position.z };
          const worldPos = normalizedToWorld(wrist2D.x, wrist2D.y, HAND_DEPTH_Z, camParams);
          tmpSkeletonPos.set(worldPos.x, worldPos.y, HAND_DEPTH_Z);
          lastTargetPos.copy(tmpSkeletonPos);

          if (middleTip2D && modelReferenceSize > 0) {
            const liveScreenSpan = normalizedSpanToWorld(
              wrist2D.x, wrist2D.y, middleTip2D.x, middleTip2D.y, HAND_DEPTH_Z, camParams
            );
            const targetScale = liveScreenSpan / modelReferenceSize;
            // exponential smoothing (not a magic appearance number -- a
            // fixed-rate low-pass on a noisy derived scalar) plus a sane
            // numeric safety clamp against momentary degenerate landmarks
            // (e.g. wrist and fingertip briefly coinciding) rather than
            // ever letting scale hit zero/infinity.
            const clamped = Math.min(Math.max(targetScale, 0.05), 10);
            smoothedScale = smoothedScale === 0 ? clamped : smoothedScale + (clamped - smoothedScale) * 0.2;
            handGroup.scale.setScalar(smoothedScale);
          }

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
      renderer.setSize(width, height, false); // false: see the setSize call above
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    // ResizeObserver instead of only a window 'resize' listener: the canvas's
    // actual size can change for reasons that never fire a window resize
    // event at all -- e.g. the video finishing its metadata load and the
    // aspect-ratio'd container settling to its real size. This is what
    // actually keeps the canvas correctly sized going forward, the
    // window-resize listener alone was the gap that let the wrong initial
    // size stick.
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(canvas);
    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
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
