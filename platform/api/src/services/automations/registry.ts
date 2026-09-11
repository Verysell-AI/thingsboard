import type { AutomationKey } from '@platform/shared/dto';
import type { Rule } from './context.js';
import { eveningSweepRule } from './rules/evening-sweep.rule.js';
import { ghostBookingRule } from './rules/ghost-booking.rule.js';
import { holidayModeRule } from './rules/holiday-mode.rule.js';
import { peakSheddingRule } from './rules/peak-shedding.rule.js';
import { precoolRule } from './rules/precool.rule.js';
import { roomAutoOffRule } from './rules/room-auto-off.rule.js';

/** Rules by automation key; keys without a rule are reported as "not available" by the engine. */
export const RULES: Partial<Record<AutomationKey, Rule>> = {
  room_auto_off: roomAutoOffRule as Rule,
  ghost_booking: ghostBookingRule as Rule,
  evening_sweep: eveningSweepRule as Rule,
  holiday_mode: holidayModeRule as Rule,
  precool: precoolRule as Rule,
  peak_shedding: peakSheddingRule as Rule,
};

export function ruleFor(key: AutomationKey): Rule | undefined {
  return RULES[key];
}
