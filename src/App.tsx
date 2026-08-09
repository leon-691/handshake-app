import React, { useRef, useState } from 'react';
import { useCameraService } from './services/CameraService';
import { useHandDetector } from './services/HandDetector';
import { useHandshakeState } from './hooks/useHandshakeState';
import { useHandRenderer } from './hooks/useHandRenderer';
import { useLandmarkDebugOverlay } from './hooks/useLandmarkDebugOverlay';
import { useStore } from './store/useStore';
import './index.css';

function cameraErrorMessage(code: string | null): string | null {
  if (!code) return null;
  if (code === 'permission-denied') {
    return 'Camera access was denied. Please allow camera access in your browser settings and try again.';
  }
  if (code === 'no-camera') {
    return 'No camera was found on this device.';
  }
  return code; // fall back to whatever raw message was captured
}

const App: React.FC = () => {
  const { videoRef, stream, startCamera, stopCamera } = useCameraService();
  const {
    cameraEnabled,
    cameraError,
    interactionState,
    progress,
    handsDetected,
    isTracking,
    isModelLoading,
    modelLoadError,
  } = useStore();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showDebugLandmarks, setShowDebugLandmarks] = useState(true);

  useHandDetector(videoRef);
  useHandshakeState();
  useHandRenderer(canvasRef);
  useLandmarkDebugOverlay(debugCanvasRef, showDebugLandmarks);

  // The video/canvas pair is ALWAYS mounted -- it must be, so `videoRef`
  // actually has something to attach to before a stream ever exists.
  // (Found on review: the previous version only rendered <video> when
  // `stream && videoRef.current` was true, which can never become true --
  // videoRef.current can't exist until the element it's supposed to
  // attach to has rendered. That's a deadlock, not a loading state: the
  // camera could activate but the video element -- and everything
  // downstream of it, tracking included -- could never appear.)
  const showOverlay = !cameraEnabled || !!cameraError;
  const readableCameraError = cameraErrorMessage(cameraError);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Handshake App</h1>
        <div className="status-indicator">
          {cameraEnabled ? (
            <span className="status-online">Camera Active</span>
          ) : cameraError ? (
            <span className="status-error">Camera Error</span>
          ) : (
            <span className="status-offline">Camera Off</span>
          )}
        </div>
        <div className="detection-status">
          {isModelLoading ? (
            <span className="status-offline">Loading tracking model&hellip;</span>
          ) : modelLoadError ? (
            <span className="status-error">Tracking failed to load: {modelLoadError}</span>
          ) : stream ? (
            handsDetected ? (
              <span className="status-online">Hand Detected</span>
            ) : (
              <span className="status-offline">No Hand</span>
            )
          ) : (
            <span className="status-offline">Detection Off</span>
          )}
        </div>
      </header>

      <main className="app-main">
        <div className="video-container">
          <video ref={videoRef} autoPlay muted playsInline style={{ visibility: showOverlay ? 'hidden' : 'visible' }} />
          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              transform: 'scaleX(-1)', // must match the video's mirror -- the 3D hand's
              // on-screen X is computed from MediaPipe's raw (unmirrored) coordinates,
              // so the canvas needs the same CSS flip or it and the video disagree on
              // which side the hand is on.
              visibility: showOverlay ? 'hidden' : 'visible',
            }}
          />
          {showDebugLandmarks && (
            <canvas
              ref={debugCanvasRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                transform: 'scaleX(-1)', // same mirror as the video/3D layer, same reason
                visibility: showOverlay ? 'hidden' : 'visible',
              }}
            />
          )}

          {showOverlay && (
            <div className="placeholder">
              {readableCameraError ? (
                <p className="error-message">{readableCameraError}</p>
              ) : (
                <button className="btn-primary" onClick={startCamera}>
                  Enable Camera
                </button>
              )}
            </div>
          )}

          {cameraEnabled && (
            <button className="btn-stop" onClick={stopCamera}>
              Stop Camera
            </button>
          )}
        </div>
        <label className="debug-toggle">
          <input
            type="checkbox"
            checked={showDebugLandmarks}
            onChange={(e) => setShowDebugLandmarks(e.target.checked)}
          />
          Show tracking points (debug)
        </label>
      </main>

      <footer className="app-footer">
        <div className="interaction-status">
          <span>State: {interactionState}</span>
          {interactionState === 'engaged' && (
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress * 100}%` }}></div>
            </div>
          )}
        </div>
        <div className="hand-info">
          <span>Hand Detected: {handsDetected ? 'Yes' : 'No'}</span>
          <span>Tracking: {isTracking ? 'Yes' : 'No'}</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
