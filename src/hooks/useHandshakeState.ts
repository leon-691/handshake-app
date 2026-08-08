import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { initialHandshakeState, stepHandshakeState, type HandshakeInternalState } from '../core/HandshakeStateMachine';

/**
 * Handshake completion state machine (replaces the old useGestureProcessor,
 * which computed an unrelated pinch-distance "progress" value -- there was
 * no code anywhere actually deciding when a handshake was happening or done).
 *
 * Per the Phase 1 decisions, a handshake is considered complete when EITHER
 * tracking is lost, or the pose hasn't changed significantly for ~3 seconds.
 * The actual decision logic lives in core/HandshakeStateMachine.ts (pure,
 * unit-tested in scripts/verify-handshake-state.ts) -- this hook is just the
 * React/store wiring around it.
 */
const RESET_DELAY_MS = 4000; // pause after "completed" before returning to idle, so the UI can show its own completion feedback in that window

export const useHandshakeState = () => {
  const interactionState = useStore((s) => s.interactionState);
  const setInteractionState = useStore((s) => s.setInteractionState);
  const setProgress = useStore((s) => s.setProgress);

  const machineRef = useRef<HandshakeInternalState>(initialHandshakeState(performance.now()));
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let rafId: number;
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const { handsDetected, worldLandmarks } = useStore.getState();
      const { next, progress } = stepHandshakeState(machineRef.current, {
        handsDetected,
        worldLandmarks,
        nowMs: performance.now(),
      });
      if (next !== machineRef.current) {
        machineRef.current = next;
        if (next.interactionState !== useStore.getState().interactionState) {
          setInteractionState(next.interactionState);
        }
      }
      setProgress(progress);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [setInteractionState, setProgress]);

  // Auto-reset back to idle a few seconds after completion, so a new
  // handshake can start without a page refresh (Phase 1 default, accepted).
  useEffect(() => {
    if (interactionState !== 'completed') return;
    resetTimeoutRef.current = setTimeout(() => {
      machineRef.current = initialHandshakeState(performance.now());
      setInteractionState('idle');
    }, RESET_DELAY_MS);
    return () => {
      if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
    };
  }, [interactionState, setInteractionState]);
};
