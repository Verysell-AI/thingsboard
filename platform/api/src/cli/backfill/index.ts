import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq, gte, isNotNull, lt, lte } from 'drizzle-orm';
import { zonedDayKey } from '@platform/shared/clock';
import {
  createRng,
  initialAcState,
  initialFloorMeterState,
  initialLaptopState,
  initialLightState,
  initialOccupancyState,
  initialPlugState,
  initialRoomMeterState,
  stepAc,
  stepFloorMeter,
  stepLaptop,
  stepLight,
  stepOccupancy,
  stepPlug,
  stepRoomMeter,
  type AcState,
  type FloorMeterState,
  type LaptopState,
  type LightState,
  type OccupancyState,
  type PlugState,
  type RoomMeterState,
} from '@platform/shared/behaviours';
import {
  PersonasSchema,
  type EmployeeSeed,
  type Persona,
  type Room,
} from '@platform/shared/dataset';
import type { Container } from '../../container.js';
import {
  assets,
  automationRuns,
  bookings,
  deviceNightlyStats,
  employees,
  locations,
  roomDailyStats,
  roomHourlyStats,
  type AssetRow,
  type LocationRow,
} from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import { runWithContext } from '../../lib/context.js';
import { ROOM_BASE_LOAD_W } from '../../services/rooms/waste.service.js';
import { generateBookingCalendar, type GeneratedBooking } from '../dataset-bookings.js';
import {
  AUTOMATION_OFF_MIN,
  DAY_MS,
  PRE_AUTOMATION_OFF_MIN,
  SWEEP_MIN,
  buildCalendar,
  firstArrivalOf,
  present,
  roomAt,
  scheduleFor,
  type BackfillDay,
  type DayBooking,
  type RoomDayInput,
  type Schedule,
} from './calendar.js';
import { TelemetryWriter } from './writer.js';

export interface BackfillOptions {
  tenant: string;
  weeks: number;
  dataset?: string;
  /** Delete the range's telemetry from the IoT core first (statistics and runs are always replaced). */
  purge?: boolean;
  log?: (message: string) => void;
}

export interface BackfillResult {
  tenant: string;
  from: string;
  to: string;
  days: number;
  slots: number;
  devices: number;
  points: number;
  requests: number;
  bookings: number;
  sweepRuns: number;
  elapsedMs: number;
}

/** Telemetry keys written per device family, for --purge. */
const KEYS: Record<string, string[]> = {
  light: ['state', 'power_w'],
  ac: ['state', 'setpoint_c', 'room_temp_c', 'power_w', 'current_a', 'runtime_h'],
  occupancy: ['occupied', 'count'],
  plug: ['state', 'power_w', 'energy_kwh'],
  room_meter: ['power_w', 'energy_kwh', 'voltage_v', 'pf'],
  floor_meter: ['power_w', 'energy_kwh', 'current_a', 'voltage_v', 'pf'],
  laptop: ['battery', 'cpu', 'user', 'ap'],
};
/** Cumulative keys whose live points inside the range are replaced by the backfilled series. */
const COUNTER_KEYS: Record<string, string[]> = {
  ac: ['runtime_h'],
  plug: ['energy_kwh'],
  room_meter: ['energy_kwh'],
  floor_meter: ['energy_kwh'],
};
/** The degrading unit's current rises to this multiple of nominal over the last two weeks. */
const FILTER_DRIFT = 0.27;
const FILTER_DRIFT_DAYS = 14;
const NIGHT_START_HOUR = 22;
const NIGHT_END_HOUR = 6;

type Behaviour =
  | { kind: 'light'; state: LightState }
  | { kind: 'ac'; state: AcState; degrading: boolean }
  | { kind: 'occupancy'; state: OccupancyState }
  | { kind: 'plug'; state: PlugState; appliance: string; sweepable: boolean }
  | { kind: 'room_meter'; state: RoomMeterState }
  | { kind: 'floor_meter'; state: FloorMeterState; floor: number }
  | { kind: 'laptop'; state: LaptopState; employeeId: string | null };

interface Device {
  asset: AssetRow;
  room: LocationRow | null;
  behaviour: Behaviour;
  rng: () => number;
  powerW: number;
  /** Night accumulator: evening date → [sum of power, samples, samples above 5 W]. */
  nights: Map<string, [number, number, number]>;
}

interface Person {
  id: string;
  code: string;
  name: string;
  roomCode: string | null;
  zone: string | null;
  persona: Persona;
  laptop: Device | null;
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Writes `weeks` of plausible history for every device of a tenant, stepping the shared pure
 * behaviours over a synthetic calendar (personas, bookings, weekends, two holidays, the evening
 * sweep active only in the last four weeks), and fills the room daily and hourly statistics, the
 * device night statistics, the historical sweep runs and the booking history from the same loop.
 */
export async function runBackfill(
  container: Container,
  opts: BackfillOptions,
): Promise<BackfillResult> {
  const started = Date.now();
  const log = opts.log ?? (() => undefined);
  const { config } = container;
  const tz = config.TIME_ZONE;
  const tenant = await container.tenants.byKey(opts.tenant);
  if (!tenant) throw new Error(`tenant ${opts.tenant} not found`);
  const personasFile = join(config.DATASETS_DIR, opts.dataset ?? 'office-demo', 'personas.json');
  const personas = PersonasSchema.parse(JSON.parse(await readFile(personasFile, 'utf8'))).personas;
  const now = Date.now();
  const days = buildCalendar(now, opts.weeks, tz, tenant.key);
  if (days.length === 0) throw new Error('nothing to backfill');
  const rangeFrom = days[0]!.dayStartMs;
  const rangeTo = days[days.length - 1]!.dayStartMs + DAY_MS;

  const ctx = { requestId: 'cli:backfill', tenantId: tenant.id, tenantKey: tenant.key };
  return runWithContext(ctx, async () => {
    // ---- world from the database -------------------------------------------------------------
    const { roomRows, zoneRows, floorRows, assetRows, employeeRows } = await withTenant(
      container.db.app,
      tenant.id,
      async (tx) => ({
        roomRows: await tx.select().from(locations).where(eq(locations.type, 'ROOM')),
        zoneRows: await tx.select().from(locations).where(eq(locations.type, 'ZONE')),
        floorRows: await tx.select().from(locations).where(eq(locations.type, 'FLOOR')),
        assetRows: await tx.select().from(assets).where(isNotNull(assets.tbDeviceId)),
        employeeRows: await tx.select().from(employees),
      }),
    );
    const roomById = new Map(roomRows.map((r) => [r.id, r]));
    const roomByCode = new Map(roomRows.map((r) => [r.code, r]));
    const floorById = new Map(floorRows.map((f) => [f.id, f]));
    const apByZone = new Map(
      zoneRows.map((z) => [z.code, z.geometry?.accessPoint ?? `AP-${z.code}`]),
    );

    const devices: Device[] = [];
    for (const a of assetRows) {
      const room = a.locationId ? (roomById.get(a.locationId) ?? null) : null;
      const rng = createRng(`${tenant.key}:${a.code}:backfill`);
      const nominal = num(a.meta.nominalPowerW, 60);
      let behaviour: Behaviour | null = null;
      switch (a.deviceType) {
        case 'light':
          behaviour = { kind: 'light', state: initialLightState(nominal) };
          break;
        case 'ac':
          behaviour = {
            kind: 'ac',
            state: initialAcState(nominal, num(a.meta.nominalCurrentA, nominal / 230 / 0.92)),
            degrading: a.meta.filterDegrading === true || a.code === 'AC-2.3',
          };
          break;
        case 'occupancy':
          behaviour = { kind: 'occupancy', state: initialOccupancyState() };
          break;
        case 'plug':
          behaviour = {
            kind: 'plug',
            state: initialPlugState(nominal, num(a.meta.standbyPowerW, 0), { on: 1 }),
            appliance: String(a.meta.appliance ?? 'other'),
            sweepable: a.meta.sweepable !== false,
          };
          break;
        case 'room_meter':
          behaviour = { kind: 'room_meter', state: initialRoomMeterState() };
          break;
        case 'floor_meter': {
          const floor = a.locationId
            ? (floorById.get(a.locationId)?.floor ?? num(a.meta.floor, 1))
            : num(a.meta.floor, 1);
          behaviour = {
            kind: 'floor_meter',
            state: initialFloorMeterState(num(a.meta.coreLoadW, 600)),
            floor,
          };
          break;
        }
        case 'laptop':
          behaviour = {
            kind: 'laptop',
            state: initialLaptopState(String(a.meta.user ?? a.code.toLowerCase()), 80),
            employeeId: a.custodianEmployeeId,
          };
          break;
        default:
          break;
      }
      if (behaviour) devices.push({ asset: a, room, behaviour, rng, powerW: 0, nights: new Map() });
    }
    const laptopByEmployee = new Map(
      devices
        .filter(
          (d) =>
            d.behaviour.kind === 'laptop' &&
            (d.behaviour as { employeeId: string | null }).employeeId,
        )
        .map((d) => [(d.behaviour as { employeeId: string }).employeeId, d]),
    );
    const people: Person[] = employeeRows.map((e) => ({
      id: e.id,
      code: e.code,
      name: e.name,
      roomCode: e.deskRoomId ? (roomById.get(e.deskRoomId)?.code ?? null) : null,
      zone: e.zone,
      persona:
        personas.find((p) => p.key === e.persona) ?? personas.find((p) => p.key === 'standard')!,
      laptop: laptopByEmployee.get(e.id) ?? null,
    }));
    const lateWorker = people.find((p) => p.persona.key === 'late_worker') ?? null;
    const keptZones = new Set(
      people.filter((p) => p.persona.key === 'late_worker' && p.zone).map((p) => p.zone!),
    );
    log(`world: ${roomRows.length} rooms, ${devices.length} devices, ${people.length} people`);

    // ---- bookings for the past weeks ----------------------------------------------------------
    const datasetRooms = roomRows.map(
      (r) =>
        ({
          code: r.code,
          name: r.name,
          floor: r.floor ?? 1,
          kind: (r.kind ?? 'other') as Room['kind'],
          zone: r.zone ?? '',
          capacity: r.capacity ?? undefined,
          critical: r.critical,
          geometry: { x: 0, y: 0, w: 1, h: 1 },
        }) satisfies Room,
    );
    const seeds = employeeRows.map((e) => ({ code: e.code }) as EmployeeSeed);
    const datasetFrom = generateBookingCalendar({
      tenantKey: tenant.key,
      rooms: datasetRooms,
      employees: seeds,
      now,
      timeZone: tz,
    }).from;
    const generated: GeneratedBooking[] = [];
    for (let monday = rangeFrom; monday < datasetFrom; monday += 7 * DAY_MS) {
      const cal = generateBookingCalendar({
        tenantKey: tenant.key,
        rooms: datasetRooms,
        employees: seeds,
        now: monday + 12 * 3_600_000,
        timeZone: tz,
      });
      for (const b of cal.bookings)
        if (b.start >= rangeFrom && b.start < datasetFrom && b.start < cal.from + 7 * DAY_MS)
          generated.push(b);
    }
    const employeeIdByCode = new Map(employeeRows.map((e) => [e.code, e.id]));

    // ---- clear what an earlier run wrote for this range ----------------------------------------
    const fromDate = days[0]!.date;
    const toDate = days[days.length - 1]!.date;
    await withTenant(container.db.app, tenant.id, async (tx) => {
      await tx
        .delete(roomDailyStats)
        .where(and(gte(roomDailyStats.date, fromDate), lte(roomDailyStats.date, toDate)));
      await tx
        .delete(roomHourlyStats)
        .where(and(gte(roomHourlyStats.date, fromDate), lte(roomHourlyStats.date, toDate)));
      await tx
        .delete(deviceNightlyStats)
        .where(and(gte(deviceNightlyStats.date, fromDate), lte(deviceNightlyStats.date, toDate)));
      await tx
        .delete(automationRuns)
        .where(
          and(
            eq(automationRuns.trigger, 'backfill'),
            gte(automationRuns.startedAt, new Date(rangeFrom)),
            lt(automationRuns.startedAt, new Date(rangeTo)),
          ),
        );
      await tx
        .delete(bookings)
        .where(
          and(
            gte(bookings.start, new Date(rangeFrom)),
            lt(bookings.start, new Date(Math.min(datasetFrom, rangeTo))),
          ),
        );
    });
    const tb = container.tb.forTenant(tenant.key);
    if (opts.purge) {
      log('purging telemetry in range');
      for (const d of devices) {
        const keys = KEYS[d.asset.deviceType ?? ''] ?? [];
        if (keys.length) await tb.deleteTimeseries(d.asset.tbDeviceId!, keys, rangeFrom, rangeTo);
      }
    }
    // Cumulative counters must be one monotonic series: whatever the live world wrote inside the
    // range (and today, before the hand-off) would sit below the backfilled values, so it goes.
    for (const d of devices) {
      const counterKeys = COUNTER_KEYS[d.asset.deviceType ?? ''] ?? [];
      if (counterKeys.length)
        await tb.deleteTimeseries(d.asset.tbDeviceId!, counterKeys, rangeFrom, now);
    }
    await container.waste.resetDayStarts(tenant.key);
    await withTenant(container.db.app, tenant.id, async (tx) => {
      const today = zonedDayKey(now, tz);
      await tx.delete(roomDailyStats).where(eq(roomDailyStats.date, today));
      await tx.delete(roomHourlyStats).where(eq(roomHourlyStats.date, today));
    });
    log(
      'live counter history inside the range removed; today’s statistics restart from the hand-off',
    );
    // booking history
    if (generated.length) {
      await withTenant(container.db.app, tenant.id, (tx) =>
        tx.insert(bookings).values(
          generated.map((b) => ({
            tenantId: tenant.id,
            roomId: roomByCode.get(b.roomCode)!.id,
            start: new Date(b.start),
            end: new Date(b.end),
            organiserId: employeeIdByCode.get(b.organiserCode) ?? null,
            title: b.title,
            attendance: b.attendance,
            status: (b.attendance === 'GHOST' ? 'RELEASED' : 'DONE') as 'RELEASED' | 'DONE',
          })),
        ),
      );
    }
    log(`bookings: ${generated.length} historical rows`);

    // ---- the loop -----------------------------------------------------------------------------
    const writer = new TelemetryWriter(tb);
    let slots = 0;
    let sweepRuns = 0;
    const driftFrom = rangeTo - FILTER_DRIFT_DAYS * DAY_MS;
    const devicesByRoom = new Map<string, Device[]>();
    for (const d of devices) {
      if (!d.room) continue;
      const list = devicesByRoom.get(d.room.code) ?? [];
      list.push(d);
      devicesByRoom.set(d.room.code, list);
    }
    const floorMeters = devices.filter((d) => d.behaviour.kind === 'floor_meter');

    for (const day of days) {
      const dayRng = createRng(`${tenant.key}:${day.date}`);
      const schedules = new Map<string, Schedule>(
        people.map((p) => [p.id, scheduleFor(p.persona, day, `${tenant.key}:${p.code}`)]),
      );
      const dayBookings = new Map<string, DayBooking[]>();
      for (const b of generated) {
        if (b.start < day.dayStartMs || b.start >= day.dayStartMs + DAY_MS) continue;
        const room = roomByCode.get(b.roomCode);
        const cap = room?.capacity ?? 6;
        const list = dayBookings.get(b.roomCode) ?? [];
        list.push({
          roomCode: b.roomCode,
          startMin: Math.round((b.start - day.dayStartMs) / 60_000),
          endMin: Math.round((b.end - day.dayStartMs) / 60_000),
          attendance: b.attendance,
          people: Math.max(2, Math.round(cap * (0.4 + dayRng() * 0.5))),
        });
        dayBookings.set(b.roomCode, list);
      }
      const roomInputs = new Map<string, RoomDayInput & { kept: boolean }>();
      for (const r of roomRows) {
        const deskPeople = people.filter((p) => p.roomCode === r.code);
        const deskPresence = (minute: number) =>
          deskPeople.filter((p) => present(schedules.get(p.id)!, minute)).length;
        roomInputs.set(r.code, {
          kind: r.kind,
          critical: r.critical,
          deskPresence,
          bookings: dayBookings.get(r.code) ?? [],
          firstArrival: firstArrivalOf(deskPresence),
          kept: r.zone !== null && keptZones.has(r.zone),
        });
      }
      const daily = new Map<
        string,
        {
          occ: number;
          booked: number;
          kwhStart: number | null;
          kwhEnd: number;
          waste: number;
          hourly: Map<number, [number, number]>;
        }
      >();
      const roomStateAtSweep = new Map<
        string,
        { on: boolean; occupied: boolean; powerW: number }
      >();
      const dt = day.slotMs / 1000;
      const slotMinutes = day.slotMs / 60_000;
      const roomPower = new Map<string, number>();

      for (let ts = day.dayStartMs; ts < day.dayStartMs + DAY_MS; ts += day.slotMs) {
        slots++;
        // let the event loop breathe so telemetry responses and their timers are handled
        await new Promise<void>((resolve) => setImmediate(resolve));
        const minute = Math.round((ts - day.dayStartMs) / 60_000);
        const hour = Math.floor(minute / 60);
        const inputs = { now: ts, dt };
        for (const r of roomRows) {
          const input = roomInputs.get(r.code)!;
          const plan = roomAt(input, day, minute);
          // rooms outside the late worker's zone are swept at 20:00 in the automation era
          const off = day.sweepEra
            ? input.kept
              ? AUTOMATION_OFF_MIN
              : SWEEP_MIN
            : PRE_AUTOMATION_OFF_MIN;
          const lightsOn = plan.lightsOn && minute < off;
          const acOn = r.critical || r.kind === 'server' ? true : plan.acOn && minute < off;
          if (minute === SWEEP_MIN - slotMinutes) {
            roomStateAtSweep.set(r.code, {
              on: lightsOn || (acOn && !r.critical),
              occupied: plan.occupied,
              powerW: roomPower.get(r.code) ?? 0,
            });
          }
          let sum = 0;
          const list = devicesByRoom.get(r.code) ?? [];
          for (const d of list) {
            const b = d.behaviour;
            switch (b.kind) {
              case 'light': {
                b.state = { ...b.state, on: lightsOn ? 1 : 0 };
                const res = stepLight(b.state, { ...inputs, rand: d.rng });
                b.state = res.state;
                d.powerW = num(res.telemetry.power_w, 0);
                await writer.push(d.asset.tbDeviceId!, { ts, values: res.telemetry });
                break;
              }
              case 'ac': {
                b.state = { ...b.state, on: acOn ? 1 : 0 };
                const res = stepAc(b.state, { ...inputs, rand: d.rng });
                let telemetry = res.telemetry;
                b.state = res.state;
                if (b.degrading && ts >= driftFrom) {
                  const factor =
                    1 + FILTER_DRIFT * Math.min(1, (ts - driftFrom) / (rangeTo - driftFrom));
                  telemetry = {
                    ...telemetry,
                    current_a: Math.round(num(telemetry.current_a, 0) * factor * 100) / 100,
                  };
                }
                d.powerW = num(telemetry.power_w, 0);
                await writer.push(d.asset.tbDeviceId!, { ts, values: telemetry });
                break;
              }
              case 'occupancy': {
                const res = stepOccupancy(b.state, {
                  ...inputs,
                  rand: d.rng,
                  presentCount: plan.people,
                });
                b.state = res.state;
                await writer.push(d.asset.tbDeviceId!, { ts, values: res.telemetry });
                break;
              }
              case 'plug': {
                const closedForNight =
                  day.sweepEra && b.sweepable && !input.kept && minute >= SWEEP_MIN;
                const on: 0 | 1 = closedForNight && b.appliance !== 'fridge' ? 0 : 1;
                let inUse = false;
                switch (b.appliance) {
                  case 'projector':
                    inUse = plan.booked && plan.occupied;
                    break;
                  case 'monitor':
                    inUse = plan.occupied && d.rng() < Math.min(1, plan.people / 6);
                    break;
                  case 'coffee_machine':
                    inUse =
                      !day.weekend &&
                      !day.holiday &&
                      minute >= 7 * 60 + 30 &&
                      minute < 17 * 60 &&
                      d.rng() < 0.3;
                    break;
                  case 'fridge':
                    inUse = d.rng() < 0.4;
                    break;
                  default:
                    inUse = plan.occupied && d.rng() < 0.5;
                }
                b.state = { ...b.state, on };
                const res = stepPlug(b.state, { ...inputs, rand: d.rng, inUse });
                b.state = res.state;
                d.powerW = num(res.telemetry.power_w, 0);
                await writer.push(d.asset.tbDeviceId!, { ts, values: res.telemetry });
                break;
              }
              default:
                break;
            }
            if (b.kind !== 'room_meter' && b.kind !== 'laptop') sum += d.powerW;
          }
          for (const d of list) {
            if (d.behaviour.kind !== 'room_meter') continue;
            const res = stepRoomMeter(d.behaviour.state, {
              ...inputs,
              rand: d.rng,
              devicesPowerW: sum,
            });
            d.behaviour.state = res.state;
            d.powerW = num(res.telemetry.power_w, 0);
            await writer.push(d.asset.tbDeviceId!, { ts, values: res.telemetry });
            const stat = daily.get(r.code) ?? {
              occ: 0,
              booked: 0,
              kwhStart: null,
              kwhEnd: 0,
              waste: 0,
              hourly: new Map(),
            };
            if (stat.kwhStart === null)
              stat.kwhStart =
                d.behaviour.state.energyKwh - (num(res.telemetry.power_w, 0) * dt) / 3_600_000;
            stat.kwhEnd = d.behaviour.state.energyKwh;
            if (plan.occupied) stat.occ += slotMinutes;
            if (plan.booked) stat.booked += slotMinutes;
            if (!plan.occupied && (lightsOn || acOn) && !r.critical)
              stat.waste += (Math.max(0, d.powerW - ROOM_BASE_LOAD_W) * dt) / 3_600_000;
            const h = stat.hourly.get(hour) ?? [0, 0];
            stat.hourly.set(hour, [
              h[0] + (plan.occupied ? slotMinutes : 0),
              h[1] + (plan.booked ? slotMinutes : 0),
            ]);
            daily.set(r.code, stat);
          }
          roomPower.set(r.code, sum + ROOM_BASE_LOAD_W);
          // night statistics per device
          const nightDate =
            hour >= NIGHT_START_HOUR
              ? day.date
              : hour < NIGHT_END_HOUR
                ? dateBefore(day.date)
                : null;
          if (nightDate)
            for (const d of list) {
              if (
                d.behaviour.kind === 'room_meter' ||
                d.behaviour.kind === 'occupancy' ||
                d.behaviour.kind === 'laptop'
              )
                continue;
              const acc = d.nights.get(nightDate) ?? [0, 0, 0];
              d.nights.set(nightDate, [
                acc[0] + d.powerW,
                acc[1] + 1,
                acc[2] + (d.powerW > 5 ? 1 : 0),
              ]);
            }
        }
        for (const fm of floorMeters) {
          const b = fm.behaviour as Extract<Behaviour, { kind: 'floor_meter' }>;
          const roomsPowerW = roomRows
            .filter((r) => r.floor === b.floor)
            .reduce((s, r) => s + (roomPower.get(r.code) ?? 0), 0);
          const res = stepFloorMeter(b.state, { ...inputs, rand: fm.rng, roomsPowerW });
          b.state = res.state;
          await writer.push(fm.asset.tbDeviceId!, { ts, values: res.telemetry });
        }
        for (const p of people) {
          if (!p.laptop || !present(schedules.get(p.id)!, minute)) continue;
          const b = p.laptop.behaviour as Extract<Behaviour, { kind: 'laptop' }>;
          const res = stepLaptop(b.state, {
            ...inputs,
            rand: p.laptop.rng,
            ap: apByZone.get(p.zone ?? '') ?? 'AP-1W',
            docked: true,
          });
          b.state = res.state;
          await writer.push(p.laptop.asset.tbDeviceId!, { ts, values: res.telemetry });
        }
      }

      // ---- statistics for the day --------------------------------------------------------------
      await withTenant(container.db.app, tenant.id, async (tx) => {
        for (const [code, stat] of daily) {
          const room = roomByCode.get(code)!;
          const ghosts = (dayBookings.get(code) ?? []).filter(
            (b) => b.attendance === 'GHOST',
          ).length;
          await tx.insert(roomDailyStats).values({
            tenantId: tenant.id,
            roomId: room.id,
            date: day.date,
            occupiedMinutes: Math.round(stat.occ),
            bookedMinutes: Math.round(stat.booked),
            ghostCount: ghosts,
            kwh: Math.max(0, stat.kwhEnd - (stat.kwhStart ?? 0)).toFixed(4),
            wastedKwh: stat.waste.toFixed(4),
          });
          const hourlyRows = [...stat.hourly.entries()]
            .filter(([, [occ, booked]]) => occ > 0 || booked > 0)
            .map(([hour, [occ, booked]]) => ({
              tenantId: tenant.id,
              roomId: room.id,
              date: day.date,
              hour,
              occupiedMinutes: Math.min(60, Math.round(occ)),
              bookedMinutes: Math.min(60, Math.round(booked)),
            }));
          if (hourlyRows.length) await tx.insert(roomHourlyStats).values(hourlyRows);
        }
        if (day.sweepEra && !day.weekend && !day.holiday) {
          const roomsOff: string[] = [];
          const roomsSkipped: { room: string; reason: string; detail: string | null }[] = [];
          let excessW = 0;
          for (const r of roomRows) {
            const s = roomStateAtSweep.get(r.code);
            const input = roomInputs.get(r.code)!;
            if (r.critical)
              roomsSkipped.push({ room: r.code, reason: 'critical_room', detail: null });
            else if (s?.occupied)
              roomsSkipped.push({
                room: r.code,
                reason: input.kept ? 'laptop_online' : 'occupied',
                detail: input.kept ? (lateWorker?.name ?? null) : null,
              });
            else if (input.kept)
              roomsSkipped.push({
                room: r.code,
                reason: 'zone_kept_for',
                detail: lateWorker?.name ?? null,
              });
            else if (s?.on) {
              roomsOff.push(r.code);
              excessW += Math.max(0, s.powerW - ROOM_BASE_LOAD_W);
            } else roomsSkipped.push({ room: r.code, reason: 'already_off', detail: null });
          }
          const sweepTs = day.dayStartMs + SWEEP_MIN * 60_000;
          const kwh = Math.round(((excessW * 11) / 1000) * 1000) / 1000;
          await tx.insert(automationRuns).values({
            tenantId: tenant.id,
            key: 'evening_sweep',
            trigger: 'backfill',
            startedAt: new Date(sweepTs),
            finishedAt: new Date(sweepTs + 3_000),
            summary: {
              businessTime: sweepTs,
              trigger: 'backfill',
              actedDay: day.date,
              sweepDay: day.date,
              roomsOff,
              roomsSkipped,
              commandsPlanned: roomsOff.length * 2,
              commandsSent: roomsOff.length * 2,
              commandsFailed: 0,
              released: [],
              notified: keptZones.size ? 1 : 0,
              zonesKept: [...keptZones].map((zone) => ({
                zone,
                employee: lateWorker?.name ?? null,
              })),
              estimatedKwhSaved: kwh,
              estimatedCostSaved: Math.round(kwh * Number(tenant.tariffPerKwh) * 100) / 100,
              ruleAvailable: true,
            },
          });
          sweepRuns++;
        }
      });
      if (day.weekday === 0 || day === days[days.length - 1]) {
        log(`${day.date}: ${writer.written} points written so far (${writer.requests} requests)`);
      }
    }
    await writer.flushAll();

    // ---- device night statistics -----------------------------------------------------------------
    const nightRows = [];
    for (const d of devices) {
      for (const [date, [sum, n, above]] of d.nights) {
        if (n === 0 || date < fromDate) continue;
        const slotH = (d.room && daySlotHours(days, date)) || 1;
        nightRows.push({
          tenantId: tenant.id,
          assetId: d.asset.id,
          date,
          avgNightPowerW: (sum / n).toFixed(2),
          hoursAbove5w: (above * slotH).toFixed(2),
        });
      }
    }
    for (let i = 0; i < nightRows.length; i += 500) {
      const chunk = nightRows.slice(i, i + 500);
      await withTenant(container.db.app, tenant.id, (tx) =>
        tx.insert(deviceNightlyStats).values(chunk).onConflictDoNothing(),
      );
    }
    log(
      `statistics: ${days.length} days, ${nightRows.length} device nights, ${sweepRuns} sweep runs`,
    );

    // ---- hand the counters to the live world -----------------------------------------------------
    // The simulator seeds cumulative counters from GET /internal/live/:tenant when it starts; that
    // endpoint applies these overrides once, so the live series continues from the backfilled values
    // even though the running simulator keeps overwriting the live state until it is restarted.
    const overrides: Record<string, string> = {};
    for (const d of devices) {
      const b = d.behaviour;
      const values: Record<string, number> = {};
      if (b.kind === 'plug' || b.kind === 'room_meter' || b.kind === 'floor_meter')
        values.energy_kwh = Math.round(b.state.energyKwh * 10_000) / 10_000;
      if (b.kind === 'ac') values.runtime_h = Math.round(b.state.runtimeH * 100) / 100;
      if (Object.keys(values).length) overrides[d.asset.code] = JSON.stringify(values);
    }
    await container.liveState.setCounterOverrides(tenant.key, overrides);
    await withTenant(container.db.app, tenant.id, (tx) =>
      container.audit.record(tx, {
        tenantId: tenant.id,
        action: 'dataset.backfill',
        entityType: 'tenant',
        entityId: tenant.id,
        after: {
          from: fromDate,
          to: toDate,
          weeks: opts.weeks,
          points: writer.written,
          purge: Boolean(opts.purge),
        },
      }),
    );

    return {
      tenant: tenant.key,
      from: fromDate,
      to: toDate,
      days: days.length,
      slots,
      devices: devices.length,
      points: writer.written,
      requests: writer.requests,
      bookings: generated.length,
      sweepRuns,
      elapsedMs: Date.now() - started,
    };
  });
}

function dateBefore(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Slot length in hours of the day the night statistics were sampled on. */
function daySlotHours(days: BackfillDay[], date: string): number {
  const day = days.find((d) => d.date === date);
  return day ? day.slotMs / 3_600_000 : 1;
}
