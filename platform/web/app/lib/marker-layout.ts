/** A point on the plan; carries an index back to the device it belongs to. */
export interface MarkerPoint {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Push markers apart until no two centres are closer than `minDist`, then keep them inside
 * `bounds` (inset by `margin`). The dataset places wall devices 30 units apart, tighter than a chip
 * when chips are drawn large enough to read; this keeps the plan legible without touching the data.
 * Deterministic for a given input order, so a re-render never makes markers jump.
 */
export function spreadMarkers<T extends MarkerPoint>(
  points: readonly T[],
  minDist: number,
  bounds?: Bounds,
  margin = 0,
  iterations = 12,
): T[] {
  const out = points.map((p) => ({ ...p }));
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!;
        const b = out[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= minDist) continue;
        if (d === 0) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const shift = (minDist - d) / 2;
        a.x -= (dx / d) * shift;
        a.y -= (dy / d) * shift;
        b.x += (dx / d) * shift;
        b.y += (dy / d) * shift;
        moved = true;
      }
    }
    if (bounds) {
      for (const p of out) {
        p.x = Math.min(Math.max(p.x, bounds.x + margin), bounds.x + bounds.w - margin);
        p.y = Math.min(Math.max(p.y, bounds.y + margin), bounds.y + bounds.h - margin);
      }
    }
    if (!moved) break;
  }
  return out;
}
