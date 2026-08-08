export interface TimedPose {
  timeMs: number;
  points: Array<{ x: number; y: number; z: number }>;
}

/**
 * Linearly interpolates between two same-length point arrays. Pure function,
 * unit tested directly in scripts/verify-pose-buffer.ts.
 */
export function lerpPoints(
  a: Array<{ x: number; y: number; z: number }>,
  b: Array<{ x: number; y: number; z: number }>,
  t: number
): Array<{ x: number; y: number; z: number }> {
  const n = Math.min(a.length, b.length);
  const out: Array<{ x: number; y: number; z: number }> = new Array(n);
  for (let i = 0; i < n; i++) {
    const pa = a[i];
    const pb = b[i];
    out[i] = pa && pb
      ? { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t, z: pa.z + (pb.z - pa.z) * t }
      : (pa ?? pb ?? { x: 0, y: 0, z: 0 });
  }
  return out;
}

/**
 * Given a time-ordered list of samples, returns the pose at `targetTimeMs`,
 * interpolated between the two samples that straddle it. Clamps to the
 * oldest/newest sample if the target is outside the buffered range (rather
 * than extrapolating, which could overshoot on sudden motion changes).
 */
export function sampleAt(buffer: TimedPose[], targetTimeMs: number): TimedPose['points'] | null {
  if (buffer.length === 0) return null;
  const first = buffer[0];
  const last = buffer[buffer.length - 1];
  if (!first || !last) return null;
  if (targetTimeMs <= first.timeMs) return first.points;
  if (targetTimeMs >= last.timeMs) return last.points;

  for (let i = 0; i < buffer.length - 1; i++) {
    const cur = buffer[i];
    const next = buffer[i + 1];
    if (!cur || !next) continue;
    if (targetTimeMs >= cur.timeMs && targetTimeMs <= next.timeMs) {
      const span = next.timeMs - cur.timeMs;
      const t = span > 0 ? (targetTimeMs - cur.timeMs) / span : 0;
      return lerpPoints(cur.points, next.points, t);
    }
  }
  return last.points;
}

/** Bounded ring-ish buffer: keeps only enough recent history to satisfy the requested max delay, discarding older samples every push. */
export class PoseDelayBuffer {
  private samples: TimedPose[] = [];

  constructor(private maxAgeMs: number) {}

  push(timeMs: number, points: TimedPose['points']): void {
    this.samples.push({ timeMs, points });
    const cutoff = timeMs - this.maxAgeMs;
    while (this.samples.length > 1 && (this.samples[0]?.timeMs ?? Infinity) < cutoff) {
      this.samples.shift();
    }
  }

  /** Pose as it was `delayMs` ago, interpolated. */
  sampleDelayed(nowMs: number, delayMs: number): TimedPose['points'] | null {
    return sampleAt(this.samples, nowMs - delayMs);
  }

  reset(): void {
    this.samples = [];
  }
}
