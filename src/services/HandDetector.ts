import { useEffect, useRef } from 'react';
import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { useStore } from '../store/useStore';
import { HandLandmarkFilter } from '../core/OneEuroFilter';

// Same CDN-hosted WASM runtime the official tasks-vision examples use; loaded
// once and cached by the browser across sessions.
const WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export const useHandDetector = (videoRef: React.RefObject<HTMLVideoElement | null>) => {
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const filterRef = useRef(new HandLandmarkFilter());
  const wasHandDetectedRef = useRef(false);

  // Store actions pulled at the hook's top level (not inside the effect) --
  // Zustand setters are stable, but grabbing them inside a nested callback
  // violates Rules of Hooks and only "worked" by accident before.
  const setHandsDetected = useStore((s) => s.setHandsDetected);
  const setTracking = useStore((s) => s.setTracking);
  const setLandmarks = useStore((s) => s.setLandmarks);
  const setWorldLandmarks = useStore((s) => s.setWorldLandmarks);
  const setModelLoading = useStore((s) => s.setModelLoading);
  const setModelLoadError = useStore((s) => s.setModelLoadError);
  // Reactive on purpose (unlike the per-frame reads elsewhere): this is a
  // low-frequency on/off toggle, not a value that changes every frame, so
  // subscribing here to start/stop the whole effect is the correct tool --
  // without it, stopCamera() had no way to actually stop tracking (found on
  // review: the loop kept calling detectForVideo against a stream whose
  // tracks had already been stopped).
  const cameraEnabled = useStore((s) => s.cameraEnabled);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !cameraEnabled) return;

    let cancelled = false;

    const init = async () => {
      setModelLoading(true);
      setModelLoadError(null);
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 1, // single hand by design (Phase 1 decision) -- also removes
          // the need for any custom "which hand do we lock onto" logic,
          // MediaPipe only ever returns its single most confident hand.
          minHandDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
        setModelLoading(false);
        rafIdRef.current = requestAnimationFrame(onVideoFrame);
      } catch (err) {
        if (cancelled) return;
        setModelLoading(false);
        setModelLoadError(err instanceof Error ? err.message : 'Failed to load hand tracking model');
      }
    };

    const onVideoFrame = (nowMs: number) => {
      const landmarker = landmarkerRef.current;
      if (landmarker && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        let result: HandLandmarkerResult | null = null;
        try {
          result = landmarker.detectForVideo(video, nowMs);
        } catch {
          // a single bad frame shouldn't kill the loop
        }
        if (result) {
          const detected = result.worldLandmarks.length > 0;
          setHandsDetected(detected);
          setTracking(detected);
          setLandmarks(result.landmarks ?? []);

          const firstHand = result.worldLandmarks[0];
          if (detected && firstHand) {
            if (!wasHandDetectedRef.current) {
              // hand just (re)acquired -- reset filter so stale velocity
              // from before the gap doesn't cause a snap/kick on reacquire
              filterRef.current.reset();
            }
            const filtered = filterRef.current.filter(firstHand, nowMs / 1000);
            setWorldLandmarks(filtered);
          } else {
            setWorldLandmarks(null);
          }
          wasHandDetectedRef.current = detected;
        }
      }
      rafIdRef.current = requestAnimationFrame(onVideoFrame);
    };

    init();

    return () => {
      cancelled = true;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current); // fixes the leaked-loop bug from the audit
        rafIdRef.current = null;
      }
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      // Also clear tracking-derived state so the UI/renderer don't keep
      // showing a "hand detected" from the instant before the camera stopped.
      setHandsDetected(false);
      setTracking(false);
      setWorldLandmarks(null);
    };
  }, [videoRef, cameraEnabled, setHandsDetected, setTracking, setLandmarks, setWorldLandmarks, setModelLoading, setModelLoadError]);
};
