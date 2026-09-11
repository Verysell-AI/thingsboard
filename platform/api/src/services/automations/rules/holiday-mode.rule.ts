import { zonedDayKey, zonedMinutesOfDay } from '@platform/shared/clock';
import type { Decision } from '@platform/shared/dto';
import type { Rule } from '../context.js';
import { parseHHMM, sweepDecisions } from './sweep.js';

/**
 * On a listed date the office is swept at `sweepTime` (00:01 by default) instead of in the
 * evening, and pre-cool stays off (the pre-cool rule checks the same dates). Nobody is expected in,
 * so no grace period and no late-worker notifications; a laptop that is online still keeps its room.
 */
export const holidayModeRule: Rule<'holiday_mode'> = {
  key: 'holiday_mode',
  evaluate(ctx, params) {
    const today = zonedDayKey(ctx.now, ctx.timeZone);
    if (!params.dates.includes(today))
      return [{ kind: 'note', message: `${today} is not a holiday` }];
    if (!ctx.manual) {
      if (zonedMinutesOfDay(ctx.now, ctx.timeZone) < parseHHMM(params.sweepTime))
        return [{ kind: 'note', message: `holiday sweep due at ${params.sweepTime}` }];
      if (ctx.lastActedDay.holiday_mode === today)
        return [{ kind: 'note', message: `holiday sweep already done on ${today}` }];
    }
    const outcome = sweepDecisions(ctx, {
      graceMinutes: 0,
      notifyLateWorkers: false,
      reason: `holiday ${today}`,
    });
    const summary: Decision = {
      kind: 'summary',
      data: {
        ...(ctx.scope ? {} : { actedDay: today }),
        sweepDay: today,
        holiday: today,
        zonesKept: outcome.zonesKept,
        estimatedKwhSaved: outcome.estimatedKwhSaved,
        estimatedCostSaved: outcome.estimatedCostSaved,
      },
    };
    return [...outcome.decisions, summary];
  },
};
