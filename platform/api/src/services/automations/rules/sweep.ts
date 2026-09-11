import { zonedDateParts, zonedTimeToEpoch } from '@platform/shared/clock';
import type { Decision } from '@platform/shared/dto';
import { names, peopleByZone } from '../../locations/zones.service.js';
import { ROOM_BASE_LOAD_W } from '../../rooms/waste.service.js';
import {
  inScope,
  roomHeld,
  switchOffDecisions,
  type RuleContext,
  type RoomState,
} from '../context.js';

/** The morning report is built at this hour; savings are estimated until then. */
export const MORNING_HOUR = 7;
/** Longest stretch savings are estimated for (a sweep at 20:00 counts until 07:00). */
const MAX_ESTIMATE_HOURS = 11;

export interface SweepOptions {
  /** A booking starting within this many minutes keeps its room on. */
  graceMinutes: number;
  /** Kept zones get a late-worker notification with Still working / Leaving now actions. */
  notifyLateWorkers: boolean;
  /** Free-text reason attached to every command. */
  reason: string;
}

export interface SweepOutcome {
  decisions: Decision[];
  roomsOff: string[];
  zonesKept: { zone: string; employee: string | null }[];
  estimatedKwhSaved: number;
  estimatedCostSaved: number;
}

/** Minutes of the day (platform zone) as "HH:MM" → number. */
export function parseHHMM(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Hours from `now` to the next 07:00 in the zone, capped so estimates stay plausible. */
export function hoursUntilMorning(now: number, timeZone: string): number {
  const parts = zonedDateParts(now, timeZone);
  let morning = zonedTimeToEpoch({ ...parts, hour: MORNING_HOUR, minute: 0, second: 0 }, timeZone);
  if (morning <= now) morning += 24 * 3_600_000;
  return Math.min(MAX_ESTIMATE_HOURS, (morning - now) / 3_600_000);
}

function bookingKeepsRoom(
  ctx: RuleContext,
  state: RoomState,
  graceMs: number,
): { title: string } | null {
  for (const b of ctx.bookings) {
    if (b.booking.roomId !== state.room.id || b.booking.status !== 'ACTIVE') continue;
    const start = b.booking.start.getTime();
    const end = b.booking.end.getTime();
    if (end <= ctx.now) continue;
    if (start <= ctx.now + graceMs) return { title: b.booking.title };
  }
  return null;
}

/**
 * The whole-office sweep decision: every non-critical room in scope is switched off unless a
 * laptop is online in it, a sensor sees people, a booking is running or about to start, the room
 * is held, or its zone is kept for someone still working. Pure; shared by the evening sweep, the
 * holiday sweep and the "Leaving now" zone sweep.
 */
export function sweepDecisions(ctx: RuleContext, opts: SweepOptions): SweepOutcome {
  const decisions: Decision[] = [];
  const graceMs = opts.graceMinutes * 60_000;
  const kept = peopleByZone(ctx.people.filter((p) => p.zone));
  const roomsOff: string[] = [];
  let excessW = 0;

  for (const state of ctx.rooms) {
    const room = state.room;
    if (!inScope(room, ctx.scope)) continue;
    const skip = (reason: string, detail?: string) =>
      decisions.push({ kind: 'skip', room: room.code, reason, ...(detail ? { detail } : {}) });
    if (room.critical) {
      skip('critical_room');
      continue;
    }
    if (roomHeld(room, ctx.holds, ctx.now)) {
      skip('manual_hold');
      continue;
    }
    const here = ctx.people.filter((p) => p.room === room.code);
    if (here.length > 0) {
      skip('laptop_online', names(here).join(', '));
      continue;
    }
    if (state.presence?.occupied) {
      skip('occupied');
      continue;
    }
    const booking = bookingKeepsRoom(ctx, state, graceMs);
    if (booking) {
      skip('booking_within_grace', booking.title);
      continue;
    }
    if (room.zone && kept.has(room.zone)) {
      skip('zone_kept_for', names(kept.get(room.zone)!).join(', '));
      continue;
    }
    const off = switchOffDecisions(state, opts.reason);
    if (off.length === 0) {
      skip('already_off');
      continue;
    }
    decisions.push(...off);
    roomsOff.push(room.code);
    if (state.powerW !== null) excessW += Math.max(0, state.powerW - ROOM_BASE_LOAD_W);
  }

  const zonesKept = [...kept.entries()]
    .filter(([zone]) => ctx.rooms.some((r) => r.room.zone === zone && inScope(r.room, ctx.scope)))
    .map(([zone, people]) => ({ zone, employee: names(people).join(', ') || null }));

  if (opts.notifyLateWorkers) {
    for (const { zone, employee } of zonesKept) {
      const userIds = [
        ...new Set(
          (kept.get(zone) ?? []).map((p) => p.userId).filter((u): u is string => u !== null),
        ),
      ];
      if (userIds.length === 0) continue;
      decisions.push({
        kind: 'notify',
        userIds,
        notificationKind: 'sweep.late_worker',
        title: `Still working in ${zone}?`,
        body: `The evening sweep kept zone ${zone} on for ${employee ?? 'you'}. Tap "Still working" to keep it for another hour, or "Leaving now" to switch it off.`,
        subject: `sweep:${zone}`,
        actions: [
          { key: 'snooze', label: 'Still working' },
          { key: 'leave', label: 'Leaving now' },
        ],
      });
    }
  }

  const hours = hoursUntilMorning(ctx.now, ctx.timeZone);
  const estimatedKwhSaved = Math.round(((excessW * hours) / 1000) * 1000) / 1000;
  const estimatedCostSaved = Math.round(estimatedKwhSaved * ctx.tenant.tariffPerKwh * 100) / 100;
  return { decisions, roomsOff, zonesKept, estimatedKwhSaved, estimatedCostSaved };
}
