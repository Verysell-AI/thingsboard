import { describe, expect, it } from 'vitest';
import type { PeakSheddingState } from '@platform/shared/dto';
import { MIN, NOW, asset, ctx, room } from './fixtures.js';
import {
  emptyShedState,
  inWindow,
  peakSheddingRule,
  restoreDecisions,
} from './peak-shedding.rule.js';

const r11 = room('1.1');
const open = room('1.O', { kind: 'open_plan' });
const pantry = room('1.P', { kind: 'pantry' });
const server = room('2.S', { kind: 'server', critical: true, floor: 2 });
const rooms = [r11, open, pantry, server];
const assets = [
  asset('LIGHT-1.1', 'light', r11.id),
  asset('AC-1.1', 'ac', r11.id),
  asset('AC-1.O', 'ac', open.id),
  asset('LIGHT-1.O', 'light', open.id),
  asset('PLUG-1.P-COFFEE', 'plug', pantry.id, true),
  asset('PLUG-1.P-FRIDGE', 'plug', pantry.id, false),
  asset('AC-2.S', 'ac', server.id),
];
const live = [
  { code: 'LIGHT-1.1', values: { state: 1 } },
  { code: 'AC-1.1', values: { state: 1 } },
  { code: 'AC-1.O', values: { state: 1, setpoint_c: 23 } },
  { code: 'LIGHT-1.O', values: { state: 1 } },
  { code: 'PLUG-1.P-COFFEE', values: { state: 1 } },
  { code: 'PLUG-1.P-FRIDGE', values: { state: 1 } },
  { code: 'AC-2.S', values: { state: 1 } },
];
const presences = {
  '1.1': { emptySince: NOW - 30 * MIN },
  '1.O': { occupied: true, laptopsOnline: 3, emptySince: null },
  '1.P': { emptySince: NOW - 30 * MIN },
  '2.S': { emptySince: NOW - 30 * MIN },
};
const params = {
  thresholdKw: 150,
  window: '12:00-14:00',
  order: ['unoccupied_rooms', 'pantry', 'open_plan_ac_setpoint+2'] as const,
  restoreBelowPct: 10,
  restoreAfterMinutes: 10,
};
const p = { ...params, order: [...params.order] };

function state(decisions: ReturnType<typeof peakSheddingRule.evaluate>): PeakSheddingState {
  const s = decisions.find((d) => d.kind === 'summary');
  return (s && s.kind === 'summary' ? s.data.shedState : undefined) as PeakSheddingState;
}
const commands = (d: ReturnType<typeof peakSheddingRule.evaluate>) =>
  d.flatMap((x) =>
    x.kind === 'command' ? [`${x.deviceCode}:${x.method}:${JSON.stringify(x.params)}`] : [],
  );

describe('inWindow', () => {
  it('handles windows inside a day and across midnight', () => {
    expect(inWindow(NOW, 'Asia/Dubai', '12:00-14:00')).toBe(true); // 12:00
    expect(inWindow(NOW - 60 * MIN, 'Asia/Dubai', '12:00-14:00')).toBe(false);
    expect(inWindow(NOW + 11 * 60 * MIN, 'Asia/Dubai', '22:00-06:00')).toBe(true); // 23:00
    expect(inWindow(NOW, 'Asia/Dubai', '22:00-06:00')).toBe(false);
  });
});

describe('peak_shedding', () => {
  it('does nothing under the threshold or outside the window', () => {
    const under = peakSheddingRule.evaluate(
      ctx(rooms, assets, live, presences, [], [], { buildingPowerW: 120_000 }),
      p,
    );
    expect(commands(under)).toEqual([]);
    expect(state(under)).toMatchObject({ status: 'NORMAL', level: 0, lastKw: 120 });
    const outside = peakSheddingRule.evaluate(
      ctx(rooms, assets, live, presences, [], [], { buildingPowerW: 200_000, now: NOW - 60 * MIN }),
      p,
    );
    expect(commands(outside)).toEqual([]);
    expect(outside.find((d) => d.kind === 'note')).toMatchObject({
      message: expect.stringContaining('outside'),
    });
  });

  it('sheds one step per run in order, skipping occupied and critical rooms, and remembers how to undo', () => {
    const first = peakSheddingRule.evaluate(
      ctx(rooms, assets, live, presences, [], [], { buildingPowerW: 160_000 }),
      p,
    );
    expect(commands(first)).toEqual([
      'LIGHT-1.1:setState:{"state":0}',
      'AC-1.1:setState:{"state":0}',
    ]);
    const s1 = state(first);
    expect(s1).toMatchObject({ status: 'SHEDDING', level: 1, sinceMs: NOW });
    expect(s1.steps[0]?.undo.map((u) => u.deviceCode)).toEqual(['LIGHT-1.1', 'AC-1.1']);
    expect(first.find((d) => d.kind === 'notify')).toMatchObject({
      notificationKind: 'peak.shedding',
      title: expect.stringContaining('step 1'),
    });

    const second = peakSheddingRule.evaluate(
      ctx(rooms, assets, live, presences, [], [], {
        buildingPowerW: 158_000,
        now: NOW + MIN,
        shedState: s1,
      }),
      p,
    );
    expect(commands(second)).toEqual(['PLUG-1.P-COFFEE:setState:{"state":0}']);
    const s2 = state(second);
    expect(s2.level).toBe(2);

    const third = peakSheddingRule.evaluate(
      ctx(rooms, assets, live, presences, [], [], {
        buildingPowerW: 156_000,
        now: NOW + 2 * MIN,
        shedState: s2,
      }),
      p,
    );
    expect(commands(third)).toEqual(['AC-1.O:setSetpoint:{"setpoint_c":25}']);
    const s3 = state(third);
    expect(s3.level).toBe(3);
    expect(s3.steps[2]?.undo[0]).toMatchObject({
      method: 'setSetpoint',
      params: { setpoint_c: 23 },
    });

    const exhausted = peakSheddingRule.evaluate(
      ctx(rooms, assets, live, presences, [], [], {
        buildingPowerW: 155_000,
        now: NOW + 3 * MIN,
        shedState: s3,
      }),
      p,
    );
    expect(commands(exhausted)).toEqual([]);
    expect(state(exhausted).level).toBe(3);
  });

  it('restores in reverse after the load has stayed low long enough', () => {
    const shed: PeakSheddingState = {
      status: 'SHEDDING',
      level: 2,
      sinceMs: NOW,
      belowSinceMs: null,
      steps: [
        {
          step: 'unoccupied_rooms',
          undo: [
            {
              assetId: assets[0]!.id,
              deviceCode: 'LIGHT-1.1',
              room: '1.1',
              method: 'setState',
              params: { state: 1 },
            },
          ],
        },
        {
          step: 'pantry',
          undo: [
            {
              assetId: assets[4]!.id,
              deviceCode: 'PLUG-1.P-COFFEE',
              room: '1.P',
              method: 'setState',
              params: { state: 1 },
            },
          ],
        },
      ],
      lastKw: 158,
    };
    // between the thresholds: hold
    const holding = peakSheddingRule.evaluate(
      ctx(rooms, assets, live, presences, [], [], {
        buildingPowerW: 140_000,
        now: NOW + 5 * MIN,
        shedState: shed,
      }),
      p,
    );
    expect(commands(holding)).toEqual([]);
    expect(state(holding)).toMatchObject({ status: 'SHEDDING', belowSinceMs: null });
    // under 135 kW: recovering starts
    const rec = peakSheddingRule.evaluate(
      ctx(rooms, assets, live, presences, [], [], {
        buildingPowerW: 130_000,
        now: NOW + 6 * MIN,
        shedState: shed,
      }),
      p,
    );
    expect(commands(rec)).toEqual([]);
    expect(state(rec)).toMatchObject({
      status: 'RECOVERING',
      belowSinceMs: NOW + 6 * MIN,
      level: 2,
    });
    // ten minutes later: restore everything, latest step first
    const done = peakSheddingRule.evaluate(
      ctx(rooms, assets, live, presences, [], [], {
        buildingPowerW: 130_000,
        now: NOW + 16 * MIN,
        shedState: state(rec),
      }),
      p,
    );
    expect(commands(done)).toEqual([
      'PLUG-1.P-COFFEE:setState:{"state":1}',
      'LIGHT-1.1:setState:{"state":1}',
    ]);
    expect(state(done)).toMatchObject({ status: 'NORMAL', level: 0, steps: [] });
    expect(done.find((d) => d.kind === 'notify')).toMatchObject({ title: 'Peak shedding ended' });
    // a load spike while recovering goes back to shedding the next step
    const spike = peakSheddingRule.evaluate(
      ctx(rooms, assets, live, presences, [], [], {
        buildingPowerW: 170_000,
        now: NOW + 8 * MIN,
        shedState: state(rec),
      }),
      p,
    );
    expect(state(spike)).toMatchObject({ status: 'SHEDDING', level: 3, belowSinceMs: null });
  });

  it('obeys manual shed and restore regardless of load and window', () => {
    const shed = peakSheddingRule.evaluate(
      ctx(rooms, assets, live, presences, [], [], {
        buildingPowerW: 50_000,
        now: NOW - 3 * 60 * MIN,
        action: 'shed',
        manual: true,
      }),
      p,
    );
    expect(commands(shed)).toHaveLength(2);
    expect(state(shed).level).toBe(1);
    const restore = peakSheddingRule.evaluate(
      ctx(rooms, assets, live, presences, [], [], {
        buildingPowerW: 200_000,
        action: 'restore',
        manual: true,
        shedState: state(shed),
      }),
      p,
    );
    expect(commands(restore)).toEqual([
      'AC-1.1:setState:{"state":1}',
      'LIGHT-1.1:setState:{"state":1}',
    ]);
    expect(state(restore)).toEqual({ ...emptyShedState(), lastKw: 200 });
    const nothing = peakSheddingRule.evaluate(
      ctx(rooms, assets, live, presences, [], [], { action: 'restore', manual: true }),
      p,
    );
    expect(nothing.find((d) => d.kind === 'note')).toMatchObject({ message: 'nothing to restore' });
    expect(restoreDecisions(emptyShedState(), 'x')).toEqual([]);
  });
});
