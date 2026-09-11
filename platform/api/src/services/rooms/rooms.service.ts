import { and, eq, inArray, isNotNull, type SQL } from 'drizzle-orm';
import {
  deriveRoomStatus,
  type Booking,
  type RoomDetail,
  type RoomView,
} from '@platform/shared/dto';
import type { DeviceLiveState } from '@platform/shared/dto';
import type { Db } from '../../db/index.js';
import { assets, locations, type AssetRow, type LocationRow } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import { notFound } from '../../lib/errors.js';
import {
  startOfDay,
  toBookingDto,
  type BookingWithRefs,
  type BookingsService,
} from '../bookings/bookings.service.js';
import type { ClockService } from '../clock/clock.service.js';
import type { HistoryService } from '../energy/history.service.js';
import type { LiveStateService } from '../live/live-state.service.js';
import type { PresenceService, RoomPresence } from './presence.service.js';
import type { RoomWaste, WasteService } from './waste.service.js';

/** What a room view needs from live state: devices in the room and laptops located there. */
export interface RoomLiveInput {
  devices: DeviceLiveState[];
  bookings: BookingWithRefs[];
  now: number;
  tariffPerKwh: number;
  /** Room-meter energy_kwh at local midnight, when known. */
  energyAtMidnightKwh: number | null;
  /** Platform presence (sensor + placed laptops); falls back to the raw live state when absent. */
  presence?: RoomPresence;
  waste?: RoomWaste;
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Pure assembly of a room's live view; exported for tests. */
export function buildRoomView(room: LocationRow, input: RoomLiveInput): RoomView {
  const inRoom = input.devices.filter((d) => d.room === room.code);
  const sensor = inRoom.find((d) => d.deviceType === 'occupancy');
  const rawLaptops = inRoom.filter((d) => d.deviceType === 'laptop' && d.online).length;
  const laptopsOnline = input.presence?.laptopsOnline ?? rawLaptops;
  const sensorCount = sensor ? Math.max(0, Math.round(num(sensor.values.count) ?? 0)) : 0;
  const peopleCount = input.presence?.count ?? sensorCount;
  const sensorOccupied = sensor ? num(sensor.values.occupied) === 1 : false;
  const occupied = input.presence?.occupied ?? (sensorOccupied || laptopsOnline > 0);
  const lightsOn = inRoom.some((d) => d.deviceType === 'light' && num(d.values.state) === 1);
  const acOn = inRoom.some((d) => d.deviceType === 'ac' && num(d.values.state) === 1);
  const meter = inRoom.find((d) => d.deviceType === 'room_meter');
  const powerW = meter ? num(meter.values.power_w) : null;
  const latestKwh = meter ? num(meter.values.energy_kwh) : null;
  const energyTodayKwh =
    latestKwh !== null && input.energyAtMidnightKwh !== null
      ? Math.max(0, Math.round((latestKwh - input.energyAtMidnightKwh) * 1000) / 1000)
      : null;
  const active = input.bookings.filter((b) => b.booking.status === 'ACTIVE');
  const current =
    active.find(
      (b) => b.booking.start.getTime() <= input.now && b.booking.end.getTime() > input.now,
    ) ?? null;
  const next =
    active
      .filter((b) => b.booking.start.getTime() > input.now)
      .sort((a, b) => a.booking.start.getTime() - b.booking.start.getTime())[0] ?? null;
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    floor: room.floor,
    zone: room.zone,
    kind: (room.kind as RoomView['kind']) ?? null,
    capacity: room.capacity,
    critical: room.critical,
    status: deriveRoomStatus({ occupied, currentBooking: current !== null }),
    occupied,
    peopleCount,
    laptopsOnline,
    lightsOn,
    acOn,
    powerW,
    energyTodayKwh,
    costToday:
      energyTodayKwh === null ? null : Math.round(energyTodayKwh * input.tariffPerKwh * 100) / 100,
    wastingSinceMinutes: input.waste?.wastingSinceMinutes ?? null,
    wastedKwhToday: input.waste?.wastedKwhToday ?? null,
    currentBooking: current ? toBookingDto(current) : null,
    nextBooking: next ? toBookingDto(next) : null,
  };
}

export class RoomsService {
  constructor(
    private readonly db: Db,
    private readonly clock: ClockService,
    private readonly live: LiveStateService,
    private readonly bookingsSvc: BookingsService,
    private readonly history: HistoryService,
    private readonly timeZone: string,
    private readonly presence: PresenceService,
    private readonly waste: WasteService,
  ) {}

  private async liveContext(
    tenant: { id: string; key: string },
    now: number,
    rooms: LocationRow[],
  ) {
    const snapshot = await this.live.snapshot(tenant.key);
    const presence = await this.presence.presence(tenant);
    const facts = rooms.map((r) => {
      const inRoom = snapshot.filter((d) => d.room === r.code);
      return {
        code: r.code,
        presence: presence.get(r.code),
        lightsOn: inRoom.some((d) => d.deviceType === 'light' && num(d.values.state) === 1),
        acOn: inRoom.some((d) => d.deviceType === 'ac' && num(d.values.state) === 1),
      };
    });
    const waste = await this.waste.wasteFor(tenant.key, facts, now);
    return { snapshot, presence, waste };
  }

  /** Counter reading at local midnight: the minimum of the cumulative meter since then. */
  private async midnightReading(
    tenantKey: string,
    meter: AssetRow | undefined,
    dayStart: number,
    now: number,
  ): Promise<number | null> {
    if (!meter?.tbDeviceId) return null;
    try {
      return await this.history.aggregate(
        tenantKey,
        meter.tbDeviceId,
        'energy_kwh',
        dayStart,
        Math.max(now, dayStart + 60_000),
        'MIN',
      );
    } catch {
      return null;
    }
  }

  async list(
    tenant: { id: string; key: string; tariffPerKwh: number },
    filter: { floor?: number; kind?: string },
  ): Promise<RoomView[]> {
    const now = await this.clock.now(tenant.key);
    const dayStart = startOfDay(now, this.timeZone);
    return withTenant(this.db, tenant.id, async (tx) => {
      const conds: SQL[] = [eq(locations.type, 'ROOM')];
      if (filter.floor !== undefined) conds.push(eq(locations.floor, filter.floor));
      if (filter.kind) conds.push(eq(locations.kind, filter.kind));
      const rooms = await tx
        .select()
        .from(locations)
        .where(and(...conds))
        .orderBy(locations.code);
      const roomIds = rooms.map((r) => r.id);
      const dayBookings = await this.bookingsSvc.inRange(tx, dayStart, dayStart + 36 * 3_600_000, {
        roomIds,
        status: ['ACTIVE'],
      });
      const meters = roomIds.length
        ? await tx
            .select()
            .from(assets)
            .where(and(eq(assets.deviceType, 'room_meter'), inArray(assets.locationId, roomIds)))
        : [];
      const { snapshot, presence, waste } = await this.liveContext(tenant, now, rooms);
      const out: RoomView[] = [];
      for (const room of rooms) {
        const meter = meters.find((m) => m.locationId === room.id);
        out.push(
          buildRoomView(room, {
            devices: snapshot,
            bookings: dayBookings.filter((b) => b.booking.roomId === room.id),
            now,
            tariffPerKwh: tenant.tariffPerKwh,
            energyAtMidnightKwh: await this.midnightReading(tenant.key, meter, dayStart, now),
            presence: presence.get(room.code),
            waste: waste.get(room.code),
          }),
        );
      }
      return out;
    });
  }

  async detail(
    tenant: { id: string; key: string; tariffPerKwh: number },
    id: string,
  ): Promise<RoomDetail> {
    const now = await this.clock.now(tenant.key);
    const dayStart = startOfDay(now, this.timeZone);
    return withTenant(this.db, tenant.id, async (tx) => {
      const room = (
        await tx
          .select()
          .from(locations)
          .where(and(eq(locations.id, id), eq(locations.type, 'ROOM')))
          .limit(1)
      )[0];
      if (!room) throw notFound('Room not found');
      const dayBookings = await this.bookingsSvc.inRange(tx, dayStart, dayStart + 24 * 3_600_000, {
        roomIds: [room.id],
      });
      const deviceRows = await tx
        .select()
        .from(assets)
        .where(and(isNotNull(assets.tbDeviceId), eq(assets.locationId, room.id)))
        .orderBy(assets.code);
      const meter = deviceRows.find((d) => d.deviceType === 'room_meter');
      const { snapshot, presence, waste } = await this.liveContext(tenant, now, [room]);
      const view = buildRoomView(room, {
        devices: snapshot,
        bookings: dayBookings,
        now,
        tariffPerKwh: tenant.tariffPerKwh,
        energyAtMidnightKwh: await this.midnightReading(tenant.key, meter, dayStart, now),
        presence: presence.get(room.code),
        waste: waste.get(room.code),
      });
      const bookingsToday: Booking[] = dayBookings.map(toBookingDto);
      return {
        ...view,
        bookingsToday,
        devices: deviceRows.map((d) => ({
          assetId: d.id,
          code: d.code,
          type: d.deviceType ?? d.type,
          name: d.name,
          appliance: typeof d.meta.appliance === 'string' ? d.meta.appliance : null,
        })),
      };
    });
  }
}
