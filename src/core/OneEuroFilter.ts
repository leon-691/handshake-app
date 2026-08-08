/**
 * Pose Filtering stage.
 *
 * One Euro Filter: adaptive low-pass filter tuned for interactive/human-input
 * signals. Two tuning knobs:
 *  - minCutoff: baseline smoothing when the signal is nearly still (lower = smoother, more lag)
 *  - beta: how much the filter "opens up" (reduces smoothing) during fast movement
 *          (higher = less lag on fast motion, but more jitter tolerated)
 *
 * Reference: Casiez, Roussel, Vogel (2012), "1â‚¬ Filter: A Simple Speed-based
 * Low-pass Filter for Noisy Input in Interactive Systems".
 */

class LowPassFilter {
  private y: number | null = null;
  private s: number | null = null;

  filter(value: number, alpha: number): number {
    if (this.s === null) {
      this.s = value;
    } else {
      this.s = alpha * value + (1 - alpha) * this.s;
    }
    this.y = value;
    return this.s;
  }

  lastValue(): number | null {
    return this.y;
  }

  reset(): void {
    this.y = null;
    this.s = null;
  }
}

export class OneEuroFilter1D {
  private xFilter = new LowPassFilter();
  private dxFilter = new LowPassFilter();
  private lastTime: number | null = null;

  constructor(
    private minCutoff = 1.0,
    private beta = 0.0,
    private dCutoff = 1.0
  ) {}

  private alpha(cutoff: number, dt: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(value: number, timestampSeconds: number): number {
    if (this.lastTime === null) {
      this.lastTime = timestampSeconds;
      this.xFilter.filter(value, 1); // seed, alpha=1 => passthrough on first sample
      return value;
    }
    const dt = Math.max(timestampSeconds - this.lastTime, 1e-6);
    this.lastTime = timestampSeconds;

    const prevX = this.xFilter.lastValue() ?? value;
    const dValue = (value - prevX) / dt;
    const edValue = this.dxFilter.filter(dValue, this.alpha(this.dCutoff, dt));

    const cutoff = this.minCutoff + this.beta * Math.abs(edValue);
    return this.xFilter.filter(value, this.alpha(cutoff, dt));
  }

  reset(): void {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTime = null;
  }
}

/** Filters an (x, y, z) point stream — one 1D filter per axis. */
export class OneEuroFilterVec3 {
  private fx: OneEuroFilter1D;
  private fy: OneEuroFilter1D;
  private fz: OneEuroFilter1D;

  constructor(minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
    this.fx = new OneEuroFilter1D(minCutoff, beta, dCutoff);
    this.fy = new OneEuroFilter1D(minCutoff, beta, dCutoff);
    this.fz = new OneEuroFilter1D(minCutoff, beta, dCutoff);
  }

  filter(x: number, y: number, z: number, t: number): [number, number, number] {
    return [this.fx.filter(x, t), this.fy.filter(y, t), this.fz.filter(z, t)];
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }
}

/**
 * Filters all 21 hand landmarks as a batch. Recreated (or `.reset()`) whenever
 * tracking is lost and reacquired, so stale velocity estimates don't leak
 * across a tracking gap.
 */
export class HandLandmarkFilter {
  private filters: OneEuroFilterVec3[];

  // beta > 0 lets fast finger flicks cut through the smoothing instead of lagging;
  // minCutoff keeps a still hand from visibly jittering. These are reasonable
  // starting values -- real tuning needs a live camera, which this environment
  // doesn't have, so treat them as a starting point rather than final.
  constructor(
    private minCutoff = 0.7,
    private beta = 0.4,
    private dCutoff = 1.0
  ) {
    this.filters = Array.from(
      { length: 21 },
      () => new OneEuroFilterVec3(this.minCutoff, this.beta, this.dCutoff)
    );
  }

  filter(points: Array<{ x: number; y: number; z: number }>, timestampSeconds: number) {
    return points.map((p, i) => {
      const f = this.filters[i];
      if (!f) return p;
      const [x, y, z] = f.filter(p.x, p.y, p.z, timestampSeconds);
      return { x, y, z };
    });
  }

  reset(): void {
    this.filters.forEach((f) => f.reset());
  }
}
