import type { Decision } from '@platform/shared/dto';
import { bookedNow } from '../../rooms/waste.service.js';
import { inScope, roomHeld, switchOffDecisions, type Rule } from '../context.js';

/**
 * A meeting room that has been empty (no people, no laptops) for `idleMinutes` with no booking
 * running has its lights, AC and sweepable plugs switched off. Critical rooms and held rooms are
 * never touched; every other room gets an explicit skip reason so the run explains itself.
 */
export const roomAutoOffRule: Rule<'room_auto_off'> = {
  key: 'room_auto_off',
  evaluate(ctx, params) {
    const out: Decision[] = [];
    for (const state of ctx.rooms) {
      const room = state.room;
      if (room.kind !== 'meeting' || !inScope(room, ctx.scope)) continue;
      const skip = (reason: string) => out.push({ kind: 'skip', room: room.code, reason });
      if (room.critical) {
        skip('critical_room');
        continue;
      }
      if (roomHeld(room, ctx.holds, ctx.now)) {
        skip('manual_hold');
        continue;
      }
      if (!state.lightsOn && !state.acOn && switchOffDecisions(state, '').length === 0) {
        skip('already_off');
        continue;
      }
      const presence = state.presence;
      if (!presence || presence.occupied) {
        skip(presence && presence.laptopsOnline > 0 ? 'laptop_online' : 'occupied');
        continue;
      }
      if (bookedNow(ctx.bookings, room.id, ctx.now)) {
        skip('booking_within_grace');
        continue;
      }
      const idleMs = presence.emptySince === null ? 0 : ctx.now - presence.emptySince;
      if (idleMs < params.idleMinutes * 60_000) {
        skip('not_idle_long_enough');
        continue;
      }
      out.push(...switchOffDecisions(state, `empty for ${Math.floor(idleMs / 60_000)} min`));
    }
    return out;
  },
};
