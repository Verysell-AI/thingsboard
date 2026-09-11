import { zonedDayKey } from '@platform/shared/clock';
import type { Decision } from '@platform/shared/dto';
import { inScope, isOn, roomHeld, type Rule } from '../context.js';
import { isHoliday } from './evening-sweep.rule.js';

/**
 * A meeting room's AC starts `leadMinutes` before its first booking of the day at `setpointC`, so
 * the room is comfortable when people arrive. Nothing happens once the first booking has started
 * (rooms in use are the occupants' business), on holidays, or in held or critical rooms.
 */
export const precoolRule: Rule<'precool'> = {
  key: 'precool',
  evaluate(ctx, params) {
    const out: Decision[] = [];
    const today = zonedDayKey(ctx.now, ctx.timeZone);
    const holiday = isHoliday(ctx, today);
    const leadMs = params.leadMinutes * 60_000;
    for (const state of ctx.rooms) {
      const room = state.room;
      if (room.kind !== 'meeting' || !inScope(room, ctx.scope)) continue;
      const acUnits = state.devices.filter((d) => d.deviceType === 'ac');
      if (acUnits.length === 0) continue;
      const skip = (reason: string, detail?: string) =>
        out.push({ kind: 'skip', room: room.code, reason, ...(detail ? { detail } : {}) });
      if (room.critical) {
        skip('critical_room');
        continue;
      }
      if (holiday) {
        skip('holiday');
        continue;
      }
      if (roomHeld(room, ctx.holds, ctx.now)) {
        skip('manual_hold');
        continue;
      }
      const first = ctx.bookings
        .filter((b) => b.booking.roomId === room.id && b.booking.status === 'ACTIVE')
        .sort((a, b) => a.booking.start.getTime() - b.booking.start.getTime())[0];
      if (!first) {
        skip('no_booking');
        continue;
      }
      const start = first.booking.start.getTime();
      if (start <= ctx.now) {
        skip('not_due', 'first booking already started');
        continue;
      }
      if (start - ctx.now > leadMs) {
        skip('not_due', `first booking at ${first.booking.start.toISOString()}`);
        continue;
      }
      if (acUnits.every(isOn)) {
        skip('already_on');
        continue;
      }
      const minutes = Math.round((start - ctx.now) / 60_000);
      for (const ac of acUnits.filter((d) => !isOn(d))) {
        const reason = `pre-cool: "${first.booking.title}" starts in ${minutes} min`;
        out.push({
          kind: 'command',
          room: room.code,
          deviceCode: ac.code,
          assetId: ac.assetId,
          method: 'setState',
          params: { state: 1 },
          reason,
        });
        out.push({
          kind: 'command',
          room: room.code,
          deviceCode: ac.code,
          assetId: ac.assetId,
          method: 'setSetpoint',
          params: { setpoint_c: params.setpointC },
          reason,
        });
      }
    }
    return out;
  },
};
