import { describe, expect, it } from 'vitest';
import { HOME_CLEAR_MINUTES, advanceDwell, type LaptopDwell } from './misplaced.service.js';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const meeting = new Set(['1.1', '1.2']);

describe('advanceDwell', () => {
  it('accumulates minutes in a foreign room and flags at the threshold', () => {
    let dwell: LaptopDwell | null = null;
    let t = NOW;
    let flagged: string | null = null;
    for (let i = 0; i < 100 && !flagged; i++) {
      t += 10 * MIN;
      const r = advanceDwell(dwell, '1.P', '1.O', meeting, t, 8 * 60, false);
      dwell = r.next;
      flagged = r.decision.flag;
    }
    expect(flagged).toBe('1.P');
    expect(dwell!.rooms['1.P']).toBeGreaterThanOrEqual(480);
  });

  it('never flags meeting rooms or the desk room and caps long gaps', () => {
    const start = advanceDwell(null, '1.1', '1.O', meeting, NOW, 60, false).next;
    const inMeeting = advanceDwell(start, '1.1', '1.O', meeting, NOW + 3 * 3_600_000, 60, false);
    expect(inMeeting.decision.flag).toBeNull();
    expect(inMeeting.next.rooms['1.1']).toBe(15); // a 3-hour gap counts as 15 minutes
    const home = advanceDwell(
      inMeeting.next,
      '1.O',
      '1.O',
      meeting,
      NOW + 4 * 3_600_000,
      60,
      false,
    );
    expect(home.decision.flag).toBeNull();
    expect(home.next.homeMinutes).toBe(15);
  });

  it('clears a flagged laptop after an hour back at its desk and resets the counters', () => {
    let dwell: LaptopDwell = { rooms: { '1.P': 600 }, homeMinutes: 0, lastTs: NOW };
    let cleared = false;
    let t = NOW;
    for (let i = 0; i < 20 && !cleared; i++) {
      t += 10 * MIN;
      const r = advanceDwell(dwell, '1.O', '1.O', meeting, t, 480, true);
      dwell = r.next;
      cleared = r.decision.clear;
    }
    expect(cleared).toBe(true);
    expect(dwell.homeMinutes).toBeGreaterThanOrEqual(HOME_CLEAR_MINUTES);
    expect(dwell.rooms['1.P']).toBe(0);
  });

  it('does nothing for an offline laptop', () => {
    const r = advanceDwell(
      { rooms: {}, homeMinutes: 5, lastTs: NOW },
      null,
      '1.O',
      meeting,
      NOW + MIN,
      480,
      false,
    );
    expect(r.decision).toEqual({ flag: null, clear: false });
    expect(r.next.homeMinutes).toBe(5);
  });
});
