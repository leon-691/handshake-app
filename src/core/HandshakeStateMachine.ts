/**
 * Pure decision logic for the handshake completion state machine, split out
 * of the React hook (useHandshakeState.ts) specifically so it can be unit
 * tested without needing a browser/DOM -- this environment has neither.
 */

export type InteractionState = 'idle' | 'detecting' | 'engaged' | 'completed' | 'error';

export interface HandshakeFrameInput {
  handsDetected: boolean;
  worldLandmarks: Array<{ x: number; y: number; z: number }> | null;
  nowMs: number;
}

export interface HandshakeInternalState {
  interactionState: InteractionState;
  prevPose: Array<{ x: number; y: number; z: number }> | null;
  lastMovementTimeMs: number;
}

export const STILLNESS_WINDOW_MS = 3000;
export const STILLNESS_THRESHOLD = 0.004;

export function initialHandshakeState(nowMs: number): HandshakeInternalState {
  return { interactionState: 'idle', prevPose: null, lastMovementTimeMs: nowMs };
}

/** One tick of the state machine. `completed`/`error` are left alone here -- the reset-to-idle timeout is a separate concern (real wall-clock delay), handled outside this pure step. */
export function stepHandshakeState(
  state: HandshakeInternalState,
  input: HandshakeFrameInput
): { next: HandshakeInternalState; progress: number } {
  const { handsDetected, worldLandmarks, nowMs } = input;

  if (state.interactionState === 'completed' || state.interactionState === 'error') {
    return { next: state, progress: 0 };
  }

  if (!handsDetected || !worldLandmarks) {
    if (state.interactionState === 'engaged') {
      return { next: { ...state, interactionState: 'completed', prevPose: null }, progress: 0 };
    }
    if (state.interactionState !== 'idle') {
      return { next: { ...state, interactionState: 'idle', prevPose: null }, progress: 0 };
    }
    return { next: state, progress: 0 };
  }

  if (state.interactionState !== 'engaged') {
    return {
      next: { interactionState: 'engaged', prevPose: worldLandmarks, lastMovementTimeMs: nowMs },
      progress: 0,
    };
  }

  let lastMovementTimeMs = state.lastMovementTimeMs;
  const prev = state.prevPose;
  if (prev && prev.length === worldLandmarks.length) {
    let totalMovement = 0;
    for (let i = 0; i < worldLandmarks.length; i++) {
      const a = prev[i];
      const b = worldLandmarks[i];
      if (!a || !b) continue;
      totalMovement += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    if (totalMovement > STILLNESS_THRESHOLD) {
      lastMovementTimeMs = nowMs;
    }
  }

  const stillnessElapsed = nowMs - lastMovementTimeMs;
  const progress = Math.min(1, Math.max(0, stillnessElapsed / STILLNESS_WINDOW_MS));

  if (stillnessElapsed >= STILLNESS_WINDOW_MS) {
    return {
      next: { interactionState: 'completed', prevPose: null, lastMovementTimeMs },
      progress,
    };
  }

  return {
    next: { interactionState: 'engaged', prevPose: worldLandmarks, lastMovementTimeMs },
    progress,
  };
}
