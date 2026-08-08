import { create } from 'zustand';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

interface State {
  // Camera state
  videoStream: MediaStream | null;
  isCameraReady: boolean;
  cameraEnabled: boolean;
  cameraError: string | null;
  isStreaming: boolean;

  // Hand tracking state
  landmarks: NormalizedLandmark[][] | null; // normalized image-space landmarks, one array per detected hand
  worldLandmarks: Array<{ x: number; y: number; z: number }> | null; // filtered, metric, single hand -- feeds Skeleton/Retargeting
  handsDetected: boolean;
  isTracking: boolean;
  isModelLoading: boolean; // HandLandmarker WASM + model still downloading/initializing
  modelLoadError: string | null;

  // Interaction state
  interactionState: 'idle' | 'detecting' | 'engaged' | 'completed' | 'error';
  progress: number; // 0 to 1

  // UI state
  showPermissions: boolean;

  // Actions
  setVideoStream: (stream: MediaStream | null) => void;
  setCameraReady: (ready: boolean) => void;
  setCameraEnabled: (enabled: boolean) => void;
  setCameraError: (error: string | null) => void;
  setStreaming: (streaming: boolean) => void;
  setLandmarks: (landmarks: NormalizedLandmark[][] | null) => void;
  setWorldLandmarks: (landmarks: Array<{ x: number; y: number; z: number }> | null) => void;
  setHandsDetected: (detected: boolean) => void;
  setTracking: (tracking: boolean) => void;
  setModelLoading: (loading: boolean) => void;
  setModelLoadError: (error: string | null) => void;
  setInteractionState: (state: 'idle' | 'detecting' | 'engaged' | 'completed' | 'error') => void;
  setProgress: (progress: number) => void;
  setShowPermissions: (show: boolean) => void;

  // Reset
  reset: () => void;
}

export const useStore = create<State>((set) => ({
  // Initial state
  videoStream: null,
  isCameraReady: false,
  cameraEnabled: false,
  cameraError: null,
  isStreaming: false,

  landmarks: null,
  worldLandmarks: null,
  handsDetected: false,
  isTracking: false,
  isModelLoading: true,
  modelLoadError: null,

  interactionState: 'idle',
  progress: 0,

  showPermissions: false,

  // Actions
  setVideoStream: (stream) => set({ videoStream: stream }),
  setCameraReady: (ready) => set({ isCameraReady: ready }),
  setCameraEnabled: (enabled) => set({ cameraEnabled: enabled }),
  setCameraError: (error) => set({ cameraError: error }),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  setLandmarks: (landmarks) => set({ landmarks: landmarks }),
  setWorldLandmarks: (landmarks) => set({ worldLandmarks: landmarks }),
  setHandsDetected: (detected) => set({ handsDetected: detected }),
  setTracking: (tracking) => set({ isTracking: tracking }),
  setModelLoading: (loading) => set({ isModelLoading: loading }),
  setModelLoadError: (error) => set({ modelLoadError: error }),
  setInteractionState: (state) => set({ interactionState: state }),
  setProgress: (progress) => set({ progress: Math.min(1, Math.max(0, progress)) }),
  setShowPermissions: (show) => set({ showPermissions: show }),

  // Reset
  reset: () =>
    set({
      videoStream: null,
      isCameraReady: false,
      cameraEnabled: false,
      cameraError: null,
      isStreaming: false,
      landmarks: null,
      worldLandmarks: null,
      handsDetected: false,
      isTracking: false,
      isModelLoading: true,
      modelLoadError: null,
      interactionState: 'idle',
      progress: 0,
      showPermissions: false,
    }),
}));