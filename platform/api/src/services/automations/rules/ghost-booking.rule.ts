import type { Decision } from '@platform/shared/dto';
import { inScope, type Rule } from '../context.js';

/**
 * A booking whose room is still empty `graceMinutes` after it started is released so the room
 * shows Free again. Releasing notifies the organiser (BookingsService.release); a room that was
 * occupied at some point after the start keeps its booking.
 */
export const ghostBookingRule: Rule<'ghost_booking'> = {
  key: 'ghost_booking',
  evaluate(ctx, params) {
    const out: Decision[] = [];
    const graceMs = params.graceMinutes * 60_000;
    for (const b of ctx.bookings) {
      if (b.booking.status !== 'ACTIVE') continue;
      const start = b.booking.start.getTime();
      const end = b.booking.end.getTime();
      if (start > ctx.now || end <= ctx.now) continue;
      const state = ctx.rooms.find((r) => r.room.id === b.booking.roomId);
      if (!state || !inScope(state.room, ctx.scope)) continue;
      const presence = state.presence;
      if (!presence || presence.occupied) continue;
      if (ctx.now - start < graceMs) continue;
      if (presence.emptySince !== null && presence.emptySince > start) continue;
      const minutes = Math.floor((ctx.now - start) / 60_000);
      out.push({
        kind: 'release_booking',
        bookingId: b.booking.id,
        room: b.roomCode,
        reason: `nobody arrived ${minutes} min after the start`,
      });
    }
    return out;
  },
};
