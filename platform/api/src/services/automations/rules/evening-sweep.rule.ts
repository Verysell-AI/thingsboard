import { zonedDayKey, zonedMinutesOfDay } from '@platform/shared/clock';
import { parseAutomationParams, type Decision } from '@platform/shared/dto';
import type { Rule, RuleContext } from '../context.js';
import { parseHHMM, sweepDecisions } from './sweep.js';

/** True on a date listed by an enabled holiday mode; the holiday rule then owns the sweep. */
export function isHoliday(ctx: RuleContext, today: string): boolean {
  const holiday = ctx.automations.holiday_mode;
  if (!holiday?.enabled) return false;
  return parseAutomationParams('holiday_mode', holiday.params).dates.includes(today);
}

/**
 * The 8 PM sweep. Fires once per business day once the clock (platform zone) passes `time`; a
 * manual run ("Run now", "Leaving now") ignores the time gate. A zone-scoped manual run does not
 * count as the day's sweep, so the scheduled one still happens.
 */
export const eveningSweepRule: Rule<'evening_sweep'> = {
  key: 'evening_sweep',
  evaluate(ctx, params) {
    const today = zonedDayKey(ctx.now, ctx.timeZone);
    if (isHoliday(ctx, today))
      return [{ kind: 'note', message: `${today} is a holiday; holiday mode runs the sweep` }];
    if (!ctx.manual) {
      if (zonedMinutesOfDay(ctx.now, ctx.timeZone) < parseHHMM(params.time))
        return [{ kind: 'note', message: `not due until ${params.time}` }];
      if (ctx.lastActedDay.evening_sweep === today)
        return [{ kind: 'note', message: `already swept on ${today}` }];
    }
    const outcome = sweepDecisions(ctx, {
      graceMinutes: params.graceMinutes,
      notifyLateWorkers: true,
      reason: ctx.scope?.zone ? `zone ${ctx.scope.zone} released` : `evening sweep ${params.time}`,
    });
    const summary: Decision = {
      kind: 'summary',
      data: {
        ...(ctx.scope ? {} : { actedDay: today }),
        sweepDay: today,
        zonesKept: outcome.zonesKept,
        estimatedKwhSaved: outcome.estimatedKwhSaved,
        estimatedCostSaved: outcome.estimatedCostSaved,
      },
    };
    return [...outcome.decisions, summary];
  },
};
