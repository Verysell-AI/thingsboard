import { zonedMinutesOfDay } from '@platform/shared/clock';
import type { Decision, PeakSheddingState, ShedStep, ShedUndo } from '@platform/shared/dto';
import { isOn, roomHeld, type Rule, type RuleContext } from '../context.js';
import { parseHHMM } from './sweep.js';

const SETPOINT_STEP_C = 2;
const DEFAULT_SETPOINT_C = 22;
const OPERATIONS = ['TENANT_ADMIN', 'OPS_MANAGER'];

export function emptyShedState(): PeakSheddingState {
  return { status: 'NORMAL', level: 0, sinceMs: null, belowSinceMs: null, steps: [], lastKw: null };
}

/** Whether the platform-zone time of day falls inside "HH:MM-HH:MM" (a window may cross midnight). */
export function inWindow(now: number, timeZone: string, window: string): boolean {
  const [from, to] = window.split('-');
  if (!from || !to) return true;
  const minutes = zonedMinutesOfDay(now, timeZone);
  const start = parseHHMM(from);
  const end = parseHHMM(to);
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Commands for one shedding step plus the commands that undo them. Pure. */
export function shedStep(
  ctx: RuleContext,
  step: ShedStep,
  reason: string,
): { commands: Decision[]; undo: ShedUndo[] } {
  const commands: Decision[] = [];
  const undo: ShedUndo[] = [];
  const command = (
    room: string,
    d: { assetId: string; code: string },
    method: 'setState' | 'setSetpoint',
    params: Record<string, unknown>,
    restore: Record<string, unknown>,
  ) => {
    commands.push({
      kind: 'command',
      room,
      deviceCode: d.code,
      assetId: d.assetId,
      method,
      params,
      reason,
    });
    undo.push({ assetId: d.assetId, deviceCode: d.code, room, method, params: restore });
  };
  for (const state of ctx.rooms) {
    const room = state.room;
    if (room.critical || roomHeld(room, ctx.holds, ctx.now)) continue;
    switch (step) {
      case 'unoccupied_rooms': {
        if (state.presence?.occupied || ctx.people.some((p) => p.room === room.code)) continue;
        for (const d of state.devices)
          if ((d.deviceType === 'ac' || d.deviceType === 'light') && isOn(d))
            command(room.code, d, 'setState', { state: 0 }, { state: 1 });
        break;
      }
      case 'pantry': {
        if (room.kind !== 'pantry') continue;
        for (const d of state.devices)
          if (d.deviceType === 'plug' && d.sweepable && isOn(d))
            command(room.code, d, 'setState', { state: 0 }, { state: 1 });
        break;
      }
      case 'open_plan_ac_setpoint+2': {
        if (room.kind !== 'open_plan') continue;
        for (const d of state.devices) {
          if (d.deviceType !== 'ac' || !isOn(d)) continue;
          const current = num(d.values.setpoint_c) ?? DEFAULT_SETPOINT_C;
          command(
            room.code,
            d,
            'setSetpoint',
            { setpoint_c: current + SETPOINT_STEP_C },
            { setpoint_c: current },
          );
        }
        break;
      }
    }
  }
  return { commands, undo };
}

/** Commands that reverse every applied step, last command first. Pure. */
export function restoreDecisions(state: PeakSheddingState, reason: string): Decision[] {
  return [...state.steps]
    .reverse()
    .flatMap((s) => [...s.undo].reverse())
    .map((u) => ({
      kind: 'command' as const,
      room: u.room,
      deviceCode: u.deviceCode,
      assetId: u.assetId,
      method: u.method,
      params: u.params,
      reason,
    }));
}

/**
 * Peak shedding: while the building load is above `thresholdKw` inside the window (or on a manual
 * "Shed now"), apply the next step of `order` on each run; once the load has stayed below
 * threshold − restoreBelowPct % for restoreAfterMinutes (or on "Restore"), undo every step in
 * reverse. The state machine NORMAL → SHEDDING → RECOVERING → NORMAL is persisted by the engine
 * from the `summary.shedState` this rule returns.
 */
export const peakSheddingRule: Rule<'peak_shedding'> = {
  key: 'peak_shedding',
  evaluate(ctx, params) {
    const out: Decision[] = [];
    const prev = ctx.shedState;
    const kw = ctx.buildingPowerW === null ? null : ctx.buildingPowerW / 1000;
    const active = inWindow(ctx.now, ctx.timeZone, params.window);
    const over = kw !== null && kw > params.thresholdKw;
    const under = kw !== null && kw < params.thresholdKw * (1 - params.restoreBelowPct / 100);
    let next: PeakSheddingState = { ...prev, lastKw: kw, steps: [...prev.steps] };
    const finish = (note?: string) => {
      if (note) out.push({ kind: 'note', message: note });
      out.push({ kind: 'summary', data: { shedState: next, buildingKw: kw, inWindow: active } });
      return out;
    };

    const restoreAll = (why: string) => {
      const cmds = restoreDecisions(prev, why);
      out.push(...cmds);
      if (cmds.length > 0)
        out.push({
          kind: 'notify',
          roles: OPERATIONS,
          notificationKind: 'peak.shedding',
          title: 'Peak shedding ended',
          body: `${why}; ${cmds.length} device(s) restored.`,
          subject: 'peak:restore',
        });
      next = { ...emptyShedState(), lastKw: kw };
    };
    const shedNext = (why: string) => {
      const step = params.order[prev.level];
      if (!step) return finish(`all ${params.order.length} shedding steps already applied`);
      const { commands, undo } = shedStep(ctx, step, why);
      out.push(...commands);
      next = {
        status: 'SHEDDING',
        level: prev.level + 1,
        sinceMs: prev.sinceMs ?? ctx.now,
        belowSinceMs: null,
        steps: [...prev.steps, { step, undo }],
        lastKw: kw,
      };
      out.push({
        kind: 'notify',
        roles: OPERATIONS,
        notificationKind: 'peak.shedding',
        title: `Peak shedding step ${next.level}: ${step}`,
        body: `${why}; ${commands.length} command(s) sent.`,
        subject: `peak:step:${next.level}`,
      });
      return finish();
    };

    if (ctx.action === 'restore') {
      if (prev.level === 0) return finish('nothing to restore');
      restoreAll('restored by hand');
      return finish();
    }
    if (ctx.action === 'shed') return shedNext('shed by hand');

    if (prev.level === 0) {
      if (!active) return finish(`outside the ${params.window} window`);
      if (!over)
        return finish(
          kw === null
            ? 'no floor meter reports'
            : `${kw.toFixed(1)} kW is under ${params.thresholdKw} kW`,
        );
      return shedNext(`${kw!.toFixed(1)} kW exceeds ${params.thresholdKw} kW`);
    }
    // shedding or recovering
    if (over && active) {
      next.status = 'SHEDDING';
      next.belowSinceMs = null;
      return shedNext(`${kw!.toFixed(1)} kW still exceeds ${params.thresholdKw} kW`);
    }
    if (under) {
      const belowSince = prev.belowSinceMs ?? ctx.now;
      if (ctx.now - belowSince >= params.restoreAfterMinutes * 60_000) {
        restoreAll(
          `load under ${(params.thresholdKw * (1 - params.restoreBelowPct / 100)).toFixed(1)} kW for ${params.restoreAfterMinutes} min`,
        );
        return finish();
      }
      next.status = 'RECOVERING';
      next.belowSinceMs = belowSince;
      return finish(
        `recovering: ${Math.floor((ctx.now - belowSince) / 60_000)} of ${params.restoreAfterMinutes} min under the restore threshold`,
      );
    }
    next.status = 'SHEDDING';
    next.belowSinceMs = null;
    return finish(
      kw === null
        ? 'no floor meter reports'
        : `${kw.toFixed(1)} kW between the restore and shedding thresholds`,
    );
  },
};
