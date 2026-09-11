import { describe, expect, it } from 'vitest';
import { AUTOMATION_PARAMS } from '@platform/shared/dto';
import { isWasting, paramFields, paramsFromForm, summarizeRun } from '~/lib/automations';
import { initialLiveState, liveReducer } from '~/lib/live-store';

describe('paramFields derives form controls from the Zod schemas', () => {
  it('reads numbers with bounds and defaults', () => {
    expect(paramFields('room_auto_off')).toEqual([
      { key: 'idleMinutes', kind: 'number', min: 1, max: 240, integer: true, default: 15 },
    ]);
    const precool = paramFields('precool');
    expect(precool.map((f) => f.key)).toEqual(['leadMinutes', 'setpointC']);
    expect(precool[1]).toMatchObject({
      kind: 'number',
      min: 16,
      max: 30,
      integer: false,
      default: 22,
    });
  });

  it('recognises times, time windows, ordered enum lists and date lists', () => {
    expect(paramFields('evening_sweep')).toEqual([
      { key: 'time', kind: 'time', default: '20:00' },
      { key: 'graceMinutes', kind: 'number', min: 0, max: 240, integer: true, default: 15 },
    ]);
    const peak = paramFields('peak_shedding');
    expect(peak.find((f) => f.key === 'window')).toEqual({
      key: 'window',
      kind: 'timeRange',
      default: '12:00-14:00',
    });
    expect(peak.find((f) => f.key === 'order')).toEqual({
      key: 'order',
      kind: 'enumList',
      options: ['unoccupied_rooms', 'pantry', 'open_plan_ac_setpoint+2'],
      default: ['unoccupied_rooms', 'pantry', 'open_plan_ac_setpoint+2'],
    });
    expect(paramFields('holiday_mode')).toEqual([
      { key: 'dates', kind: 'dateList', default: [] },
      { key: 'sweepTime', kind: 'time', default: '00:01' },
    ]);
  });

  it('turns form strings back into JSON the schema accepts', () => {
    const fields = paramFields('peak_shedding');
    const params = paramsFromForm(fields, {
      thresholdKw: '120',
      window: '11:30-14:00',
      order: ['pantry', 'unoccupied_rooms'],
      restoreBelowPct: '',
      restoreAfterMinutes: 5,
    });
    expect(params).toEqual({
      thresholdKw: 120,
      window: '11:30-14:00',
      order: ['pantry', 'unoccupied_rooms'],
      restoreAfterMinutes: 5,
    });
    expect(AUTOMATION_PARAMS.peak_shedding.safeParse(params).success).toBe(true);
  });
});

describe('summarizeRun', () => {
  it('reads counts from the summary and falls back to the decisions list', () => {
    const view = summarizeRun({
      trigger: 'manual',
      summary: {
        businessTime: 1_000,
        roomsOff: ['1.1', '1.2'],
        roomsSkipped: [{ room: '2.S', reason: 'critical_room' }, { room: '1.3' }],
        decisions: [
          {
            kind: 'command',
            room: '1.1',
            deviceCode: 'LIGHT-1.1',
            assetId: '00000000-0000-4000-8000-000000000001',
            method: 'setState',
            params: { state: 0 },
            reason: 'idle',
          },
          {
            kind: 'release_booking',
            bookingId: '00000000-0000-4000-8000-000000000002',
            room: '1.4',
            reason: 'ghost',
          },
        ],
      },
    });
    expect(view.businessTime).toBe(1_000);
    expect(view.trigger).toBe('manual');
    expect(view.roomsOff).toEqual(['1.1', '1.2']);
    expect(view.roomsSkipped).toEqual([
      { room: '2.S', reason: 'critical_room' },
      { room: '1.3', reason: '' },
    ]);
    expect(view.commandsSent).toBe(1);
    expect(view.released).toBe(1);
    expect(summarizeRun({ trigger: 'schedule', summary: {} })).toMatchObject({
      businessTime: null,
      trigger: 'schedule',
      roomsOff: [],
      commandsSent: 0,
    });
  });
});

describe('presence and waste', () => {
  it('keeps the latest presence per room from live events', () => {
    let state = liveReducer(initialLiveState, {
      type: 'event',
      event: {
        id: '1-0',
        tenantKey: 'alpha',
        ts: 1,
        kind: 'room.presence',
        room: '1.1',
        occupied: true,
        laptopsOnline: 2,
        count: 3,
      },
    });
    state = liveReducer(state, {
      type: 'event',
      event: {
        id: '2-0',
        tenantKey: 'alpha',
        ts: 2,
        kind: 'room.presence',
        room: '1.1',
        occupied: false,
        laptopsOnline: 0,
        count: 0,
      },
    });
    expect(state.presence['1.1']).toEqual({ occupied: false, count: 0, laptopsOnline: 0, ts: 2 });
    expect(state.events).toHaveLength(2);
    expect(state.lastEventId).toBe('2-0');
  });

  it('shows the waste badge only for rooms the API flags', () => {
    expect(isWasting({ wastingSinceMinutes: null })).toBe(false);
    expect(isWasting({ wastingSinceMinutes: 0 })).toBe(false);
    expect(isWasting({ wastingSinceMinutes: 12 })).toBe(true);
  });
});
