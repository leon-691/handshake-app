import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { PARENT_OF, JOINT_NAMES } from '../core/HandSkeleton';

// MediaPipe landmark index -> joint name, same order as HandSkeleton.ts,
// duplicated here only because that file's map is private; kept in sync by
// hand since both ultimately encode MediaPipe's fixed 21-point topology.
const INDEX_TO_JOINT = JOINT_NAMES;
const CONNECTIONS: Array<[number, number]> = [];
JOINT_NAMES.forEach((name, childIdx) => {
  const parent = PARENT_OF[name];
  if (!parent) return;
  const parentIdx = JOINT_NAMES.indexOf(parent);
  if (parentIdx >= 0) CONNECTIONS.push([parentIdx, childIdx]);
});

/**
 * Draws the raw normalized (image-space) landmarks + skeleton lines on a 2D
 * canvas overlay. This is a diagnostic tool, not part of the "real" UI --
 * it exists to answer one question directly, visually: is MediaPipe finding
 * the hand where it actually is on screen? If these dots track the real
 * hand correctly but the 3D model still doesn't, the bug is in
 * rendering/retargeting, not tracking. If the dots themselves are off, the
 * bug is upstream of anything this app's 3D code controls.
 */
export const useLandmarkDebugOverlay = (
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  enabled: boolean
) => {
  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId: number;
    const draw = () => {
      rafId = requestAnimationFrame(draw);
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const { landmarks } = useStore.getState();
      const hand = landmarks?.[0];
      if (!hand) return;

      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2;
      for (const [a, b] of CONNECTIONS) {
        const pa = hand[a];
        const pb = hand[b];
        if (!pa || !pb) continue;
        ctx.beginPath();
        ctx.moveTo(pa.x * canvas.width, pa.y * canvas.height);
        ctx.lineTo(pb.x * canvas.width, pb.y * canvas.height);
        ctx.stroke();
      }

      hand.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x * canvas.width, p.y * canvas.height, i === 0 ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? '#ff3d00' : '#00e5ff'; // wrist stands out in red
        ctx.fill();
      });
      void INDEX_TO_JOINT; // kept for readability/reference; not otherwise used
    };
    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [canvasRef, enabled]);
};
