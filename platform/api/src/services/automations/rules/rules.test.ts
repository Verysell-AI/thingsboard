import { describe, expect, it } from 'vitest';
import type { HoldRow } from '../../../db/schema/index.js';
import { ghostBookingRule } from './ghost-booking.rule.js';
import { MIN, NOW, TENANT, asset, booking, ctx, id, room } from './fixtures.js';
import { roomAutoOffRule } from './room-auto-off.rule.js';

const r11 = room('1.1');
const light = asset('LIGHT-1.1', 'light', r11.id);
const ac = asset('AC-1.1', 'ac', r11.id);
const proj = asset('PLUG-1.1-PROJ', 'plug', r11.id, true);
const fixed = asset('PLUG-1.1-FIXED', 'plug', r11.id, false);
const allOn = [
  { code: 'LIGHT-1.1', values: { state: 1 } },
  { code: 'AC-1.1', values: { state: 1 } },
  { code: 'PLUG-1.1-PROJ', values: { state: 1 } },
  { code: 'PLUG-1.1-FIXED', values: { state: 1 } },
];
const params = { idleMinutes: 15 };

describe('room_auto_off', () => {
  it('switches off lights, AC and sweepable plugs of a room empty long enough', () => {
    const c = ctx([r11], [light, ac, proj, fixed], allOn, { '1.1': {} });
    const d = roomAutoOffRule.evaluate(c, params);
    const commands = d.filter((x) => x.kind === 'command');
    expect(commands.map((x) => (x.kind === 'command' ? x.deviceCode : ''))).toEqual([
      'LIGHT-1.1',
      'AC-1.1',
      'PLUG-1.1-PROJ',
    ]);
    expect(commands.every((x) => x.kind === 'command' && x.params.state === 0)).toBe(true);
  });

  it.each([
    ['not idle long enough', { emptySince: NOW - 5 * MIN }, 'not_idle_long_enough'],
    [
      'laptop present',
      { occupied: true, laptopsOnline: 1, laptopCodes: ['LAPTOP-E001'], emptySince: null },
      'laptop_online',
    ],
    ['sensor sees people', { occupied: true, count: 2, emptySince: null }, 'occupied'],
  ] as const)('skips when %s', (_label, p, reason) => {
    const c = ctx([r11], [light, ac], allOn.slice(0, 2), { '1.1': p });
    expect(roomAutoOffRule.evaluate(c, params)).toEqual([{ kind: 'skip', room: '1.1', reason }]);
  });

  it('skips a booked room, a critical room, a held room and an already dark room', () => {
    const booked = ctx([r11], [light, ac], allOn.slice(0, 2), { '1.1': {} }, [booking(r11, -10)]);
    expect(roomAutoOffRule.evaluate(booked, params)[0]).toMatchObject({
      reason: 'booking_within_grace',
    });

    const server = room('2.S', { critical: true, kind: 'meeting' });
    const sLight = asset('LIGHT-2.S', 'light', server.id);
    const critical = ctx([server], [sLight], [{ code: 'LIGHT-2.S', values: { state: 1 } }], {
      '2.S': {},
    });
    expect(roomAutoOffRule.evaluate(critical, params)).toEqual([
      { kind: 'skip', room: '2.S', reason: 'critical_room' },
    ]);

    const hold: HoldRow = {
      id: id(1),
      tenantId: TENANT,
      scopeType: 'ZONE',
      scopeId: '1.West',
      until: new Date(NOW + 60 * MIN),
      reason: 'late worker',
      createdAt: new Date(0),
    };
    const held = ctx([r11], [light], allOn.slice(0, 1), { '1.1': {} }, [], [hold]);
    expect(roomAutoOffRule.evaluate(held, params)[0]).toMatchObject({ reason: 'manual_hold' });

    const dark = ctx(
      [r11],
      [light, ac],
      [
        { code: 'LIGHT-1.1', values: { state: 0 } },
        { code: 'AC-1.1', values: { state: 0 } },
      ],
      { '1.1': {} },
    );
    expect(roomAutoOffRule.evaluate(dark, params)[0]).toMatchObject({ reason: 'already_off' });
  });

  it('ignores open-plan rooms and rooms outside the scope', () => {
    const open = room('1.O', { kind: 'open_plan' });
    const oLight = asset('LIGHT-1.O', 'light', open.id);
    const c = ctx(
      [open, r11],
      [oLight, light],
      [
        { code: 'LIGHT-1.O', values: { state: 1 } },
        { code: 'LIGHT-1.1', values: { state: 1 } },
      ],
      { '1.O': {}, '1.1': {} },
    );
    expect(roomAutoOffRule.evaluate(c, params).map((d) => d.room)).toEqual(['1.1']);
    expect(roomAutoOffRule.evaluate({ ...c, scope: { zone: '2.East' } }, params)).toEqual([]);
  });
});

describe('ghost_booking', () => {
  const grace = { graceMinutes: 10 };
  it('releases a booking nobody came to once the grace period has passed', () => {
    const c = ctx([r11], [light], [], { '1.1': { emptySince: NOW - 60 * MIN } }, [
      booking(r11, -12),
    ]);
    const d = ghostBookingRule.evaluate(c, grace);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ kind: 'release_booking', room: '1.1' });
  });

  it('waits during the grace period, keeps occupied rooms and rooms someone visited after the start', () => {
    const early = ctx([r11], [light], [], { '1.1': {} }, [booking(r11, -5)]);
    expect(ghostBookingRule.evaluate(early, grace)).toEqual([]);
    const busy = ctx(
      [r11],
      [light],
      [],
      { '1.1': { occupied: true, count: 3, emptySince: null } },
      [booking(r11, -20)],
    );
    expect(ghostBookingRule.evaluate(busy, grace)).toEqual([]);
    const visited = ctx([r11], [light], [], { '1.1': { emptySince: NOW - 3 * MIN } }, [
      booking(r11, -20),
    ]);
    expect(ghostBookingRule.evaluate(visited, grace)).toEqual([]);
    const released = ctx([r11], [light], [], { '1.1': {} }, [booking(r11, -20, 'RELEASED')]);
    expect(ghostBookingRule.evaluate(released, grace)).toEqual([]);
  });
});
