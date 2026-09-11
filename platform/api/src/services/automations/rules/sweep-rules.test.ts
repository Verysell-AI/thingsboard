import { describe, expect, it } from 'vitest';
import type { HoldRow } from '../../../db/schema/index.js';
import type { PersonPresence } from '../context.js';
import { eveningSweepRule } from './evening-sweep.rule.js';
import { MIN, NOW, TENANT, asset, booking, ctx, id, room } from './fixtures.js';
import { holidayModeRule } from './holiday-mode.rule.js';
import { precoolRule } from './precool.rule.js';
import { hoursUntilMorning, sweepDecisions } from './sweep.js';

// NOW is 12:00 in Dubai; the evening sweep is due at 20:00 = NOW + 8 h
const EVENING = NOW + 8 * 60 * MIN;
const TZ = 'Asia/Dubai';

const r11 = room('1.1', { zone: '1.West' });
const r12 = room('1.2', { zone: '1.West' });
const r13 = room('1.3', { zone: '1.East' });
const open = room('1.O', { kind: 'open_plan', zone: '1.West' });
const pantry = room('1.P', { kind: 'pantry', zone: '1.East' });
const server = room('2.S', { kind: 'server', critical: true, zone: '2.East', floor: 2 });
const rooms = [r11, r12, r13, open, pantry, server];
const assets = [
  asset('LIGHT-1.1', 'light', r11.id),
  asset('AC-1.1', 'ac', r11.id),
  asset('LIGHT-1.2', 'light', r12.id),
  asset('LIGHT-1.3', 'light', r13.id),
  asset('LIGHT-1.O', 'light', open.id),
  asset('AC-1.O', 'ac', open.id),
  asset('PLUG-1.P-COFFEE', 'plug', pantry.id, true),
  asset('PLUG-1.P-FRIDGE', 'plug', pantry.id, false),
  asset('LIGHT-2.S', 'light', server.id),
  asset('RM-1.1', 'room_meter', r11.id),
];
const allOn = assets.map((a) => ({
  code: a.code,
  values: a.code.startsWith('RM-') ? { power_w: 615 } : { state: 1 },
}));
const empty = { emptySince: NOW - 60 * MIN };
const everyoneGone = {
  '1.1': empty,
  '1.2': empty,
  '1.3': empty,
  '1.O': empty,
  '1.P': empty,
  '2.S': empty,
};
const late: PersonPresence = {
  laptopCode: 'LAPTOP-E009',
  room: '1.O',
  zone: '1.West',
  employeeId: id(9),
  employeeName: 'Yusuf Rahman',
  userId: id(109),
};
const params = { time: '20:00', graceMinutes: 15 };

function reasons(decisions: ReturnType<typeof sweepDecisions>['decisions']) {
  return Object.fromEntries(
    decisions.flatMap((d) => (d.kind === 'skip' ? [[d.room, d.reason]] : [])),
  );
}

describe('sweepDecisions', () => {
  it('switches every non-critical empty room off and explains the rest', () => {
    const c = ctx(rooms, assets, allOn, everyoneGone, [], [], { now: EVENING });
    const out = sweepDecisions(c, { graceMinutes: 15, notifyLateWorkers: true, reason: 'test' });
    expect(out.roomsOff.sort()).toEqual(['1.1', '1.2', '1.3', '1.O', '1.P']);
    expect(reasons(out.decisions)).toEqual({ '2.S': 'critical_room' });
    const commands = out.decisions.filter((d) => d.kind === 'command');
    // the fridge is not sweepable
    expect(commands.map((d) => (d.kind === 'command' ? d.deviceCode : '')).sort()).toEqual([
      'AC-1.1',
      'AC-1.O',
      'LIGHT-1.1',
      'LIGHT-1.2',
      'LIGHT-1.3',
      'LIGHT-1.O',
      'PLUG-1.P-COFFEE',
    ]);
    // 600 W excess in 1.1 (the only room with a meter) for 11 h = 6.6 kWh at 0.44
    expect(out.estimatedKwhSaved).toBeCloseTo(6.6, 3);
    expect(out.estimatedCostSaved).toBeCloseTo(2.9, 2);
    expect(out.zonesKept).toEqual([]);
  });

  it('keeps the whole zone of an online laptop and tells its owner', () => {
    const c = ctx(
      rooms,
      assets,
      allOn,
      {
        ...everyoneGone,
        '1.O': { occupied: true, laptopsOnline: 1, laptopCodes: ['LAPTOP-E009'], emptySince: null },
      },
      [],
      [],
      {
        now: EVENING,
        people: [late],
      },
    );
    const out = sweepDecisions(c, { graceMinutes: 15, notifyLateWorkers: true, reason: 'test' });
    expect(reasons(out.decisions)).toEqual({
      '1.O': 'laptop_online',
      '1.1': 'zone_kept_for',
      '1.2': 'zone_kept_for',
      '2.S': 'critical_room',
    });
    expect(out.decisions.find((d) => d.kind === 'skip' && d.room === '1.1')).toMatchObject({
      detail: 'Yusuf Rahman',
    });
    expect(out.roomsOff.sort()).toEqual(['1.3', '1.P']);
    expect(out.zonesKept).toEqual([{ zone: '1.West', employee: 'Yusuf Rahman' }]);
    const notify = out.decisions.find((d) => d.kind === 'notify');
    expect(notify).toMatchObject({
      notificationKind: 'sweep.late_worker',
      userIds: [id(109)],
      subject: 'sweep:1.West',
      actions: [
        { key: 'snooze', label: 'Still working' },
        { key: 'leave', label: 'Leaving now' },
      ],
    });
  });

  it('respects occupancy, bookings within grace, holds and dark rooms', () => {
    const hold: HoldRow = {
      id: id(1),
      tenantId: TENANT,
      scopeType: 'FLOOR',
      scopeId: '1',
      until: new Date(EVENING + 60 * MIN),
      reason: 'event tonight',
      createdAt: new Date(0),
    };
    const held = ctx(rooms, assets, allOn, everyoneGone, [], [hold], { now: EVENING });
    const heldOut = sweepDecisions(held, {
      graceMinutes: 15,
      notifyLateWorkers: false,
      reason: 't',
    });
    expect(heldOut.roomsOff).toEqual([]);
    expect(new Set(Object.values(reasons(heldOut.decisions)))).toEqual(
      new Set(['manual_hold', 'critical_room']),
    );

    const soon = booking(r12, 8 * 60 + 10); // starts 10 min after the sweep
    const later = booking(r13, 8 * 60 + 40); // starts 40 min after the sweep
    const c = ctx(
      rooms,
      assets,
      allOn,
      { ...everyoneGone, '1.1': { occupied: true, count: 2, emptySince: null } },
      [soon, later],
      [],
      { now: EVENING },
    );
    const out = sweepDecisions(c, { graceMinutes: 15, notifyLateWorkers: false, reason: 't' });
    expect(reasons(out.decisions)).toMatchObject({
      '1.1': 'occupied',
      '1.2': 'booking_within_grace',
    });
    expect(out.roomsOff).toContain('1.3');

    const dark = ctx(rooms, assets, [], everyoneGone, [], [], { now: EVENING });
    const darkOut = sweepDecisions(dark, {
      graceMinutes: 15,
      notifyLateWorkers: false,
      reason: 't',
    });
    expect(darkOut.roomsOff).toEqual([]);
    expect(reasons(darkOut.decisions)['1.1']).toBe('already_off');
  });

  it('honours a zone scope', () => {
    const c = ctx(rooms, assets, allOn, everyoneGone, [], [], {
      now: EVENING,
      scope: { zone: '1.East' },
    });
    const out = sweepDecisions(c, { graceMinutes: 15, notifyLateWorkers: false, reason: 't' });
    expect(out.roomsOff.sort()).toEqual(['1.3', '1.P']);
    expect(out.decisions.some((d) => 'room' in d && d.room === '1.1')).toBe(false);
  });

  it('estimates savings until 07:00, capped at eleven hours', () => {
    expect(hoursUntilMorning(EVENING, TZ)).toBeCloseTo(11, 5);
    expect(hoursUntilMorning(NOW, TZ)).toBeCloseTo(11, 5); // noon → capped
    expect(hoursUntilMorning(NOW + 17 * 60 * MIN, TZ)).toBeCloseTo(2, 5); // 05:00 → 2 h
  });
});

describe('evening_sweep', () => {
  it('waits for its time, then sweeps once per business day', () => {
    const early = eveningSweepRule.evaluate(ctx(rooms, assets, allOn, everyoneGone), params);
    expect(early).toEqual([{ kind: 'note', message: 'not due until 20:00' }]);

    const due = eveningSweepRule.evaluate(
      ctx(rooms, assets, allOn, everyoneGone, [], [], { now: EVENING }),
      params,
    );
    expect(due.filter((d) => d.kind === 'command').length).toBeGreaterThan(0);
    const summary = due.find((d) => d.kind === 'summary');
    expect(summary).toMatchObject({
      data: { actedDay: '2026-09-07', sweepDay: '2026-09-07', estimatedKwhSaved: 6.6 },
    });

    const again = eveningSweepRule.evaluate(
      ctx(rooms, assets, allOn, everyoneGone, [], [], {
        now: EVENING + 5 * MIN,
        lastActedDay: { evening_sweep: '2026-09-07' },
      }),
      params,
    );
    expect(again).toEqual([{ kind: 'note', message: 'already swept on 2026-09-07' }]);
  });

  it('runs at any time by hand, and a zone-scoped run does not count as the day’s sweep', () => {
    const manual = eveningSweepRule.evaluate(
      ctx(rooms, assets, allOn, everyoneGone, [], [], {
        manual: true,
        lastActedDay: { evening_sweep: '2026-09-07' },
      }),
      params,
    );
    expect(manual.filter((d) => d.kind === 'command').length).toBeGreaterThan(0);
    const scoped = eveningSweepRule.evaluate(
      ctx(rooms, assets, allOn, everyoneGone, [], [], { manual: true, scope: { zone: '1.West' } }),
      params,
    );
    const summary = scoped.find((d) => d.kind === 'summary');
    expect(summary && summary.kind === 'summary' ? summary.data.actedDay : 'x').toBeUndefined();
  });

  it('leaves holidays to holiday mode', () => {
    const c = ctx(rooms, assets, allOn, everyoneGone, [], [], {
      now: EVENING,
      automations: { holiday_mode: { enabled: true, params: { dates: ['2026-09-07'] } } },
    });
    expect(eveningSweepRule.evaluate(c, params)[0]).toMatchObject({ kind: 'note' });
    expect(eveningSweepRule.evaluate(c, params)[0]).toMatchObject({
      message: expect.stringContaining('holiday'),
    });
  });
});

describe('holiday_mode', () => {
  const holiday = { dates: ['2026-09-07'], sweepTime: '00:01' };
  it('sweeps listed dates from the sweep time, ignoring others', () => {
    const other = holidayModeRule.evaluate(ctx(rooms, assets, allOn, everyoneGone), {
      ...holiday,
      dates: ['2026-12-25'],
    });
    expect(other).toEqual([{ kind: 'note', message: '2026-09-07 is not a holiday' }]);
    const swept = holidayModeRule.evaluate(ctx(rooms, assets, allOn, everyoneGone), holiday);
    expect(swept.filter((d) => d.kind === 'command').length).toBeGreaterThan(0);
    expect(swept.find((d) => d.kind === 'summary')).toMatchObject({
      data: { actedDay: '2026-09-07', holiday: '2026-09-07' },
    });
    // no late-worker notifications on a holiday, but an online laptop still keeps its room
    const withLaptop = holidayModeRule.evaluate(
      ctx(
        rooms,
        assets,
        allOn,
        {
          ...everyoneGone,
          '1.O': {
            occupied: true,
            laptopsOnline: 1,
            laptopCodes: ['LAPTOP-E009'],
            emptySince: null,
          },
        },
        [],
        [],
        { people: [late] },
      ),
      holiday,
    );
    expect(withLaptop.some((d) => d.kind === 'notify')).toBe(false);
    expect(withLaptop.find((d) => d.kind === 'skip' && d.room === '1.O')).toMatchObject({
      reason: 'laptop_online',
    });
    const done = holidayModeRule.evaluate(
      ctx(rooms, assets, allOn, everyoneGone, [], [], {
        lastActedDay: { holiday_mode: '2026-09-07' },
      }),
      holiday,
    );
    expect(done[0]).toMatchObject({ kind: 'note' });
  });
});

describe('precool', () => {
  const p = { leadMinutes: 30, setpointC: 22 };
  const acOff = [{ code: 'AC-1.1', values: { state: 0, setpoint_c: 24 } }];
  it('starts the AC within the lead time of the first booking of the day', () => {
    const soon = booking(r11, 20);
    const laterToday = booking(r11, 120);
    const out = precoolRule.evaluate(
      ctx(
        [r11],
        [asset('LIGHT-1.1', 'light', r11.id), asset('AC-1.1', 'ac', r11.id)],
        acOff,
        { '1.1': empty },
        [laterToday, soon],
      ),
      p,
    );
    expect(out.filter((d) => d.kind === 'command')).toEqual([
      expect.objectContaining({ deviceCode: 'AC-1.1', method: 'setState', params: { state: 1 } }),
      expect.objectContaining({
        deviceCode: 'AC-1.1',
        method: 'setSetpoint',
        params: { setpoint_c: 22 },
      }),
    ]);
  });

  it.each([
    ['no booking', [], 'no_booking'],
    ['first booking too far away', [booking(r11, 90)], 'not_due'],
    ['first booking already started', [booking(r11, -10), booking(r11, 20)], 'not_due'],
  ])('skips when %s', (_label, bookings, reason) => {
    const out = precoolRule.evaluate(
      ctx([r11], [asset('AC-1.1', 'ac', r11.id)], acOff, { '1.1': empty }, bookings),
      p,
    );
    expect(out).toEqual([expect.objectContaining({ kind: 'skip', room: '1.1', reason })]);
  });

  it('skips holidays, critical rooms, held rooms and running units', () => {
    const acAsset = asset('AC-1.1', 'ac', r11.id);
    const holiday = precoolRule.evaluate(
      ctx([r11], [acAsset], acOff, { '1.1': empty }, [booking(r11, 20)], [], {
        automations: { holiday_mode: { enabled: true, params: { dates: ['2026-09-07'] } } },
      }),
      p,
    );
    expect(holiday[0]).toMatchObject({ reason: 'holiday' });
    const on = precoolRule.evaluate(
      ctx([r11], [acAsset], [{ code: 'AC-1.1', values: { state: 1 } }], { '1.1': empty }, [
        booking(r11, 20),
      ]),
      p,
    );
    expect(on[0]).toMatchObject({ reason: 'already_on' });
    const crit = room('2.S', { critical: true });
    const critical = precoolRule.evaluate(
      ctx(
        [crit],
        [asset('AC-2.S', 'ac', crit.id)],
        [{ code: 'AC-2.S', values: { state: 0 } }],
        { '2.S': empty },
        [booking(crit, 20)],
      ),
      p,
    );
    expect(critical[0]).toMatchObject({ reason: 'critical_room' });
    const hold: HoldRow = {
      id: id(2),
      tenantId: TENANT,
      scopeType: 'ROOM',
      scopeId: '1.1',
      until: new Date(NOW + 60 * MIN),
      reason: 'x',
      createdAt: new Date(0),
    };
    const held = precoolRule.evaluate(
      ctx([r11], [acAsset], acOff, { '1.1': empty }, [booking(r11, 20)], [hold]),
      p,
    );
    expect(held[0]).toMatchObject({ reason: 'manual_hold' });
  });
});
