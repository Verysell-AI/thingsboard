import { sql } from 'drizzle-orm';
import { zonedDateParts, zonedDayKey } from '@platform/shared/clock';
import type { DeviceLiveState } from '@platform/shared/dto';
import type { Db } from '../../db/index.js';
import { roomDailyStats, roomHourlyStats, type LocationRow } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import type { RedisLike } from '../../lib/redis.js';
import type { BookingWithRefs } from '../bookings/bookings.service.js';
import type { RoomPresence } from './presence.service.js';

/** A room wastes energy once it has been empty this long with lights or AC still on. */
export const WASTE_IDLE_MS = 10 * 60_000;
/** Standing load of a room (meter, sensors) that is not counted as waste. */
export const ROOM_BASE_LOAD_W = 15;
/** Longest interval integrated in one step, so a time-machine jump does not invent hours of waste. */
const MAX_STEP_MS = 15 * 60_000;

export interface RoomWaste {
  room: string;
  wasting: boolean;
  wastingSinceMinutes: number | null;
  wastedKwhToday: number;
}

export interface RoomTickInput {
  room: LocationRow;
  presence: RoomPresence | undefined;
  lightsOn: boolean;
  acOn: boolean;
  powerW: number | null;
  /** Room-meter cumulative energy counter (kWh) right now, when the meter reports. */
  energyKwh: number | null;
  bookedNow: boolean;
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Local day key (YYYY-MM-DD) of a business instant. */
export function dayKey(ms: number, timeZone: string): string {
  return zonedDayKey(ms, timeZone);
}

/** Whether a room is wasting right now. Pure. */
export function isWasting(
  presence: RoomPresence | undefined,
  lightsOn: boolean,
  acOn: boolean,
  now: number,
): boolean {
  if (!presence || presence.occupied || presence.emptySince === null) return false;
  if (now - presence.emptySince < WASTE_IDLE_MS) return false;
  return lightsOn || acOn;
}

/** Energy (kWh) wasted over `dtMs` at `powerW` above the room's base load. Pure. */
export function wasteIncrementKwh(powerW: number | null, dtMs: number): number {
  if (powerW === null || dtMs <= 0) return 0;
  const excess = Math.max(0, powerW - ROOM_BASE_LOAD_W);
  return (excess * Math.min(dtMs, MAX_STEP_MS)) / 3_600_000_000;
}

/** Live room facts the waste and stats integrators need, from a live snapshot. Pure. */
export function roomFacts(devices: DeviceLiveState[], roomCode: string) {
  const inRoom = devices.filter((d) => d.room === roomCode);
  const meter = inRoom.find((d) => d.deviceType === 'room_meter');
  return {
    lightsOn: inRoom.some((d) => d.deviceType === 'light' && num(d.values.state) === 1),
    acOn: inRoom.some((d) => d.deviceType === 'ac' && num(d.values.state) === 1),
    powerW: meter ? num(meter.values.power_w) : null,
    sweepablePlugsOn: inRoom.filter((d) => d.deviceType === 'plug' && num(d.values.state) === 1),
  };
}

export function bookedNow(bookings: BookingWithRefs[], roomId: string, now: number): boolean {
  return bookings.some(
    (b) =>
      b.booking.roomId === roomId &&
      b.booking.status === 'ACTIVE' &&
      b.booking.start.getTime() <= now &&
      b.booking.end.getTime() > now,
  );
}

const wasteKey = (tenant: string, room: string, day: string) => `waste:${tenant}:${room}:${day}`;
const lastTickKey = (tenant: string) => `stats:${tenant}:lastTick`;
/** First meter reading seen on a business day; kWh today = current counter − this. */
const dayStartKey = (tenant: string, room: string, day: string) =>
  `stats:${tenant}:${room}:${day}:kwh0`;

/**
 * Wasted-energy counters and the room daily statistics. Waste is integrated on every automation
 * tick from the room meter while the room is empty with lights or AC on; the daily statistics
 * (occupied and booked minutes, ghost count, kWh, wasted kWh) are upserted per business day.
 */
export class WasteService {
  constructor(
    private readonly db: Db,
    private readonly redis: RedisLike,
    private readonly timeZone: string,
  ) {}

  /** Current waste figures for rooms without integrating anything. */
  async wasteFor(
    tenantKey: string,
    rooms: { code: string; presence: RoomPresence | undefined; lightsOn: boolean; acOn: boolean }[],
    now: number,
  ): Promise<Map<string, RoomWaste>> {
    const day = dayKey(now, this.timeZone);
    const out = new Map<string, RoomWaste>();
    for (const r of rooms) {
      const raw = await this.redis.hgetall(wasteKey(tenantKey, r.code, day));
      const wasting = isWasting(r.presence, r.lightsOn, r.acOn, now);
      out.set(r.code, {
        room: r.code,
        wasting,
        wastingSinceMinutes:
          wasting && r.presence?.emptySince
            ? Math.floor((now - r.presence.emptySince) / 60_000)
            : null,
        wastedKwhToday: Math.round(Number(raw?.kwh ?? 0) * 1000) / 1000,
      });
    }
    return out;
  }

  /** Forgets the day-start meter readings so "kWh today" restarts from the current counters. */
  async resetDayStarts(tenantKey: string): Promise<number> {
    const keys = await this.redis.keys(`stats:${tenantKey}:*:kwh0`);
    if (keys.length) await this.redis.del(...keys);
    return keys.length;
  }

  /** Total wasted kWh today across rooms. */
  async wastedToday(tenantKey: string, roomCodes: string[], now: number): Promise<number> {
    const day = dayKey(now, this.timeZone);
    let total = 0;
    for (const code of roomCodes) {
      const raw = await this.redis.hgetall(wasteKey(tenantKey, code, day));
      total += Number(raw?.kwh ?? 0);
    }
    return Math.round(total * 1000) / 1000;
  }

  /** One integration step for every room; called by the automation tick. */
  async tick(
    tenant: { id: string; key: string },
    now: number,
    rooms: RoomTickInput[],
  ): Promise<Map<string, RoomWaste>> {
    const day = dayKey(now, this.timeZone);
    const lastRaw = await this.redis.get(lastTickKey(tenant.key));
    const last = lastRaw ? Number(lastRaw) : null;
    const dtMs = last !== null && now > last ? Math.min(now - last, MAX_STEP_MS) : 0;
    await this.redis.set(lastTickKey(tenant.key), String(now), 'EX', 7 * 86_400);

    const hour = zonedDateParts(now, this.timeZone).hour;
    const out = new Map<string, RoomWaste>();
    const statRows: (typeof roomDailyStats.$inferInsert & { dtMinutes: number })[] = [];
    for (const r of rooms) {
      const key = wasteKey(tenant.key, r.room.code, day);
      const raw = await this.redis.hgetall(key);
      const wasting = isWasting(r.presence, r.lightsOn, r.acOn, now);
      let kwh = Number(raw?.kwh ?? 0);
      const lastTs = raw?.lastTs ? Number(raw.lastTs) : null;
      if (wasting && lastTs !== null && now > lastTs)
        kwh += wasteIncrementKwh(r.powerW, now - lastTs);
      await this.redis.hset(key, { kwh: String(kwh), lastTs: String(now) });
      // energy today: the counter minus the first reading seen this business day
      let energyTodayKwh: number | null = null;
      if (r.energyKwh !== null) {
        const startKey = dayStartKey(tenant.key, r.room.code, day);
        const startRaw = await this.redis.get(startKey);
        let start = startRaw === null ? null : Number(startRaw);
        if (start === null || r.energyKwh < start) {
          start = r.energyKwh;
          await this.redis.set(startKey, String(start), 'EX', 3 * 86_400);
        }
        energyTodayKwh = Math.max(0, r.energyKwh - start);
      }
      out.set(r.room.code, {
        room: r.room.code,
        wasting,
        wastingSinceMinutes:
          wasting && r.presence?.emptySince
            ? Math.floor((now - r.presence.emptySince) / 60_000)
            : null,
        wastedKwhToday: Math.round(kwh * 1000) / 1000,
      });
      const dtMinutes = dtMs / 60_000;
      statRows.push({
        tenantId: tenant.id,
        roomId: r.room.id,
        date: day,
        occupiedMinutes: r.presence?.occupied ? Math.round(dtMinutes) : 0,
        bookedMinutes: r.bookedNow ? Math.round(dtMinutes) : 0,
        kwh: energyTodayKwh === null ? '0' : energyTodayKwh.toFixed(4),
        wastedKwh: kwh.toFixed(4),
        dtMinutes,
      });
    }
    if (statRows.length) {
      await withTenant(this.db, tenant.id, async (tx) => {
        for (const row of statRows) {
          const { dtMinutes: _dt, ...values } = row;
          await tx
            .insert(roomDailyStats)
            .values(values)
            .onConflictDoUpdate({
              target: [roomDailyStats.tenantId, roomDailyStats.roomId, roomDailyStats.date],
              set: {
                occupiedMinutes: sql`${roomDailyStats.occupiedMinutes} + ${values.occupiedMinutes}`,
                bookedMinutes: sql`${roomDailyStats.bookedMinutes} + ${values.bookedMinutes}`,
                kwh: sql`greatest(${roomDailyStats.kwh}, ${values.kwh}::numeric)`,
                wastedKwh: values.wastedKwh,
              },
            });
          if (values.occupiedMinutes || values.bookedMinutes) {
            await tx
              .insert(roomHourlyStats)
              .values({
                tenantId: values.tenantId,
                roomId: values.roomId,
                date: values.date,
                hour,
                occupiedMinutes: values.occupiedMinutes,
                bookedMinutes: values.bookedMinutes,
              })
              .onConflictDoUpdate({
                target: [
                  roomHourlyStats.tenantId,
                  roomHourlyStats.roomId,
                  roomHourlyStats.date,
                  roomHourlyStats.hour,
                ],
                set: {
                  occupiedMinutes: sql`least(60, ${roomHourlyStats.occupiedMinutes} + ${values.occupiedMinutes})`,
                  bookedMinutes: sql`least(60, ${roomHourlyStats.bookedMinutes} + ${values.bookedMinutes})`,
                },
              });
          }
        }
      });
    }
    return out;
  }

  /** Counts a released ghost booking against the room's day. */
  async incrementGhost(tenant: { id: string; key: string }, roomId: string, now: number) {
    const day = dayKey(now, this.timeZone);
    await withTenant(this.db, tenant.id, (tx) =>
      tx
        .insert(roomDailyStats)
        .values({ tenantId: tenant.id, roomId, date: day, ghostCount: 1 })
        .onConflictDoUpdate({
          target: [roomDailyStats.tenantId, roomDailyStats.roomId, roomDailyStats.date],
          set: { ghostCount: sql`${roomDailyStats.ghostCount} + 1` },
        }),
    );
  }
}
