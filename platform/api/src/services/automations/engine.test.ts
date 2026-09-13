import { describe, expect, it } from 'vitest';
import type { Decision } from '@platform/shared/dto';
import { worthRecording } from './engine.js';
import { emptyShedState } from './rules/peak-shedding.rule.js';

const skip: Decision = { kind: 'skip', room: '1.1', reason: 'occupied' };
const note: Decision = { kind: 'note', message: 'outside the window' };
const command: Decision = {
  kind: 'command',
  room: '1.1',
  deviceCode: 'LIGHT-1.1',
  assetId: 'a1',
  method: 'setState',
  params: { state: 0 },
  reason: 'empty',
};

describe('worthRecording keeps the history to ticks that did something', () => {
  const normal = emptyShedState();

  it('drops scheduled ticks that only skipped or noted', () => {
    expect(worthRecording('schedule', [], normal)).toBe(false);
    expect(worthRecording('schedule', [skip, skip, note], normal)).toBe(false);
  });

  it('keeps every trigger other than the schedule', () => {
    expect(worthRecording('manual', [skip], normal)).toBe(true);
    expect(worthRecording('leave', [], normal)).toBe(true);
    expect(worthRecording('backfill', [note], normal)).toBe(true);
  });

  it('keeps ticks that sent a command, released a booking or notified someone', () => {
    expect(worthRecording('schedule', [skip, command], normal)).toBe(true);
    expect(
      worthRecording(
        'schedule',
        [{ kind: 'release_booking', room: '1.2', bookingId: 'b1', reason: 'ghost' }],
        normal,
      ),
    ).toBe(true);
    expect(
      worthRecording(
        'schedule',
        [
          {
            kind: 'notify',
            roles: ['OPS_MANAGER'],
            notificationKind: 'sweep.late_worker',
            title: 'Still there?',
            body: '',
          },
        ],
        normal,
      ),
    ).toBe(true);
  });

  it('keeps the tick that closes a sweep day', () => {
    expect(
      worthRecording('schedule', [{ kind: 'summary', data: { actedDay: '2026-09-13' } }], normal),
    ).toBe(true);
    expect(
      worthRecording('schedule', [{ kind: 'summary', data: { sweepDay: '2026-09-13' } }], normal),
    ).toBe(false);
  });

  it('keeps peak-shedding ticks only when the state machine moves', () => {
    const shedding = { ...normal, status: 'SHEDDING' as const, level: 1 };
    const sameState: Decision = {
      kind: 'summary',
      data: { shedState: { ...shedding, lastKw: 140 }, buildingKw: 140, inWindow: true },
    };
    const recovering: Decision = {
      kind: 'summary',
      data: { shedState: { ...shedding, status: 'RECOVERING' }, buildingKw: 90, inWindow: true },
    };
    expect(worthRecording('schedule', [note, sameState], shedding)).toBe(false);
    expect(worthRecording('schedule', [note, recovering], shedding)).toBe(true);
    expect(worthRecording('schedule', [sameState], normal)).toBe(true);
  });
});
