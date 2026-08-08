import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../store/useStore';

export const useCameraService = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const setCameraEnabled = useStore((s) => s.setCameraEnabled);
  const setCameraError = useStore((s) => s.setCameraError);
  const setStreaming = useStore((s) => s.setStreaming);

  const startCamera = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Media Devices API not supported');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
      });

      setStream(stream);
      setCameraEnabled(true);
      setStreaming(true);
      setCameraError(null);
    } catch (err) {
      console.error('Error accessing camera:', err);
      setCameraEnabled(false);
      setStreaming(false);
      // Distinguish "you said no" from "there's no camera" / other failures --
      // the UI can show a genuinely actionable message instead of a generic one.
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
        setCameraError('permission-denied');
      } else if (err instanceof DOMException && (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError')) {
        setCameraError('no-camera');
      } else {
        setCameraError(err instanceof Error ? err.message : 'Unknown camera error');
      }
    }
  }, [setCameraEnabled, setCameraError, setStreaming]);

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null; // otherwise the element keeps referencing
      // a stream whose tracks are already stopped -- harmless on its own, but
      // paired with the readyState checks elsewhere it's cleaner to just clear it
    }
    setStream(null);
    setCameraEnabled(false);
    setStreaming(false);
  }, [stream, setCameraEnabled, setStreaming]);

  // Handle page visibility to pause/resume camera to save battery
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Page is hidden, pause camera
        stopCamera();
      } else {
        // Page is visible, resume camera if previously enabled
        // We could rely on user to press start again, but we can auto-resume
        // if we want to keep camera active across tabs; we choose to stop and require restart.
        // For simplicity, we do nothing here; user must press start again.
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [stopCamera]);

  // Update video element when stream changes
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return { videoRef, stream, startCamera, stopCamera };
};