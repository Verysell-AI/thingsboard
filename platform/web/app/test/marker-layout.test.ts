import { describe, expect, it } from 'vitest';
import { spreadMarkers } from '~/lib/marker-layout';

describe('spreadMarkers', () => {
  it('leaves markers that are already far enough apart untouched', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(spreadMarkers(pts, 40)).toEqual(pts);
  });

  it('pushes the dataset wall pair (30 apart) out to the minimum distance', () => {
    const [a, b] = spreadMarkers(
      [
        { x: 24, y: 156 },
        { x: 54, y: 156 },
      ],
      40,
    );
    expect(Math.hypot(b!.x - a!.x, b!.y - a!.y)).toBeCloseTo(40);
    expect(a!.y).toBe(156);
  });

  it('separates coincident markers and keeps everything inside the room', () => {
    const room = { x: 0, y: 0, w: 100, h: 100 };
    const out = spreadMarkers(
      [
        { x: 2, y: 50 },
        { x: 2, y: 50 },
        { x: 2, y: 50 },
      ],
      30,
      room,
      15,
    );
    for (const p of out) {
      expect(p.x).toBeGreaterThanOrEqual(15);
      expect(p.x).toBeLessThanOrEqual(85);
    }
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++)
        expect(Math.hypot(out[i]!.x - out[j]!.x, out[i]!.y - out[j]!.y)).toBeGreaterThan(20);
  });

  it('is deterministic for the same input', () => {
    const pts = [
      { x: 10, y: 10 },
      { x: 20, y: 12 },
      { x: 30, y: 8 },
    ];
    expect(spreadMarkers(pts, 25)).toEqual(spreadMarkers(pts, 25));
  });
});
