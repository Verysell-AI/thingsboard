import {
  AC_DEFAULT_SETPOINT_C,
  createRng,
  initialAcState,
  initialFloorMeterState,
  initialLaptopState,
  initialLightState,
  initialOccupancyState,
  initialPlugState,
  initialRoomMeterState,
  isAtWork,
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
  RpcRequestSchema,
  type RpcResponse,
  type TelemetryValues,
} from '@platform/shared/contracts';
import { DEFAULT_TIME_ZONE, zonedDayKey, zonedMinutesOfDay } from '@platform/shared/clock';
import type { DeviceType, Room, World } from '@platform/shared/dataset';
import { meetingRoomsOnFloor, type DeviceSpec } from './world.js';

type Behaviour =
  | { kind: 'light'; state: LightState }
  | { kind: 'ac'; state: AcState }
  | { kind: 'occupancy'; state: OccupancyState }
  | { kind: 'plug'; state: PlugState; appliance: string }
  | { kind: 'room_meter'; state: RoomMeterState }
  | { kind: 'floor_meter'; state: FloorMeterState }
  | { kind: 'laptop'; state: LaptopState };

/** What a device may ask about its surroundings during a step. */
export interface StepContext {
  /** Tenant business clock, ms since epoch (virtual when the time machine is active). */
  now: number;
  /** Virtual seconds elapsed since the previous step. */
  dt: number;
  /** Σ power of lights, AC units and plugs in a room. */
  roomPowerW(room: string): number;
  /** Σ power reported by the room meters on a floor. */
  floorRoomsPowerW(floor: number): number;
  /** People an occupancy sensor should see in a room. */
  presentCount(room: string): number;
  /** Laptops currently online and located in a room. */
  laptopsOnlineInRoom(room: string): number;
  /** Whether the tenant-wide lunch-peak scenario is running. */
  peakActive: boolean;
}

/** Meeting rooms on the laptop's floor, resolved once by the registry. */
export interface LaptopEnvironment {
  meetingRooms: Room[];
  accessPointForRoom(room: string): string | null;
}

export interface LaptopLocation {
  room: string | null;
  accessPoint: string;
  docked: boolean;
}

const MEETING_MINUTES = 50;
/** Current multiplier gained per business minute while a filter clogs at demo speed. */
export const ACCELERATED_DRIFT_PER_MINUTE = 0.03;

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export class VirtualDevice {
  readonly tenant: string;
  readonly code: string;
  readonly type: DeviceType;
  readonly name: string;
  readonly accessToken: string;
  readonly room: string | null;
  readonly zone: string | null;
  readonly floor: number | null;
  readonly spec: DeviceSpec;

  private behaviour: Behaviour;
  private readonly rng: () => number;
  private lastTelemetry: TelemetryValues = {};
  /** Laptop scenario overrides. */
  private forcedOnlineUntil = 0;
  private leftDay: string | null = null;
  /** Saved switch states restored when the lunch peak ends. */
  private prePeak: { on: 0 | 1; setpointC?: number } | null = null;
  /** Room a scenario moved this laptop to; null means the persona decides. */
  private forcedRoom: string | null = null;
  /** When true the AC filter clogs at demo speed (a few minutes instead of weeks). */
  private acceleratedDrift = false;

  constructor(
    spec: DeviceSpec,
    private readonly laptopEnv: LaptopEnvironment | null = null,
    /** Zone in which persona schedules and appliance habits are read. */
    private readonly timeZone: string = DEFAULT_TIME_ZONE,
  ) {
    this.spec = spec;
    this.tenant = spec.tenant;
    this.code = spec.code;
    this.type = spec.type;
    this.name = spec.name;
    this.accessToken = spec.accessToken;
    this.room = spec.room;
    this.zone = spec.zone;
    this.floor = spec.floor;
    this.rng = createRng(`${spec.tenant}:${spec.code}`);
    this.behaviour = VirtualDevice.initialBehaviour(spec);
  }

  private static initialBehaviour(spec: DeviceSpec): Behaviour {
    const w = spec.world;
    switch (spec.type) {
      case 'light': {
        const nominal = w && w.type === 'light' ? w.nominalPowerW : 40;
        const critical = spec.world?.attrs?.critical === true;
        return { kind: 'light', state: initialLightState(nominal, critical ? 0 : 1) };
      }
      case 'ac': {
        const p = w && w.type === 'ac' ? w.nominalPowerW : 800;
        const a = w && w.type === 'ac' ? w.nominalCurrentA : 3.4;
        const degrading = w && w.type === 'ac' ? w.filterDegrading : false;
        return {
          kind: 'ac',
          state: initialAcState(p, a, { on: 1, filterDegrading: degrading, roomTempC: 25 }),
        };
      }
      case 'occupancy':
        return { kind: 'occupancy', state: initialOccupancyState() };
      case 'plug': {
        const p = w && w.type === 'plug' ? w.nominalPowerW : 50;
        const s = w && w.type === 'plug' ? w.standbyPowerW : 2;
        const appliance = w && w.type === 'plug' ? w.appliance : 'other';
        return { kind: 'plug', state: initialPlugState(p, s, { on: 1 }), appliance };
      }
      case 'room_meter':
        return { kind: 'room_meter', state: initialRoomMeterState() };
      case 'floor_meter': {
        const core = w && w.type === 'floor_meter' ? w.coreLoadW : 600;
        return { kind: 'floor_meter', state: initialFloorMeterState(core) };
      }
      case 'laptop':
        return {
          kind: 'laptop',
          state: initialLaptopState(
            spec.laptop?.user ?? 'unknown',
            60 + (hashCode(spec.code) % 35),
          ),
        };
    }
  }

  get values(): TelemetryValues {
    return this.lastTelemetry;
  }

  /* -------------------------------------------------------------- laptop presence */

  /** Whether the MQTT session of this device should be connected at business time `now`. */
  shouldBeOnline(now: number): boolean {
    if (this.type !== 'laptop') return true;
    if (this.forcedOnlineUntil > now) return true;
    if (this.leftDay === zonedDayKey(now, this.timeZone)) return false;
    const persona = this.spec.laptop?.persona;
    if (!persona) return false;
    return isAtWork(persona, now, this.timeZone);
  }

  /** Keeps a laptop online regardless of persona until `untilMs`. */
  forceOnline(untilMs: number): void {
    this.forcedOnlineUntil = untilMs;
    this.leftDay = null;
  }

  /** Takes a laptop offline for the rest of the local day. */
  leaveForToday(now: number): void {
    this.forcedOnlineUntil = 0;
    this.leftDay = zonedDayKey(now, this.timeZone);
  }

  /** True while a scenario keeps this laptop online whatever its persona says. */
  isForcedOnline(now: number): boolean {
    return this.forcedOnlineUntil > now;
  }

  /** Moves a laptop to a room (undocked, on that room's access point); null returns it to its persona. */
  forceLocation(room: string | null): void {
    this.forcedRoom = room;
  }

  get forcedLocation(): string | null {
    return this.forcedRoom;
  }

  /**
   * Where the laptop is: at its desk, or in a meeting room when the persona is meeting heavy and
   * the business time is in the first 50 minutes of an odd hour.
   */
  laptopLocation(now: number): LaptopLocation {
    const info = this.spec.laptop;
    const home = info?.homeAccessPoint ?? 'AP-UNKNOWN';
    const desk: LaptopLocation = {
      room: info?.deskRoom ?? this.room,
      accessPoint: home,
      docked: true,
    };
    if (this.forcedRoom !== null) {
      return {
        room: this.forcedRoom,
        accessPoint: this.laptopEnv?.accessPointForRoom(this.forcedRoom) ?? home,
        docked: false,
      };
    }
    if (!info || info.persona?.key !== 'meeting_heavy' || !this.laptopEnv || this.floor === null)
      return desk;
    const minute = zonedMinutesOfDay(now, this.timeZone);
    const hour = Math.floor(minute / 60);
    if (hour % 2 !== 1 || minute % 60 >= MEETING_MINUTES) return desk;
    const rooms = this.laptopEnv.meetingRooms;
    if (rooms.length === 0) return desk;
    const room = rooms[(hashCode(info.employeeCode) + hour) % rooms.length];
    if (!room) return desk;
    return {
      room: room.code,
      accessPoint: this.laptopEnv.accessPointForRoom(room.code) ?? home,
      docked: false,
    };
  }

  /* -------------------------------------------------------------- stepping */

  step(ctx: StepContext): TelemetryValues {
    const inputs = { now: ctx.now, dt: ctx.dt, rand: this.rng };
    this.applyPeak(ctx.peakActive);
    const b = this.behaviour;
    switch (b.kind) {
      case 'light': {
        const r = stepLight(b.state, inputs);
        this.behaviour = { kind: 'light', state: r.state };
        return this.remember(r.telemetry);
      }
      case 'ac': {
        // The lunch peak forces full cooling output by keeping the room warm.
        let state = ctx.peakActive
          ? { ...b.state, roomTempC: Math.max(b.state.roomTempC, b.state.setpointC + 2) }
          : b.state;
        // a clogging filter at demo speed: the unit struggles at full output and its current
        // climbs 3 % per business minute, so the profile alarm fires within a few minutes
        if (this.acceleratedDrift && state.on) {
          state = {
            ...state,
            roomTempC: Math.max(state.roomTempC, state.setpointC + 2),
            degradeFactor: state.degradeFactor + (ACCELERATED_DRIFT_PER_MINUTE * ctx.dt) / 60,
          };
        }
        const r = stepAc(state, inputs);
        this.behaviour = { kind: 'ac', state: r.state };
        return this.remember(r.telemetry);
      }
      case 'occupancy': {
        const presentCount = this.room ? ctx.presentCount(this.room) : 0;
        const r = stepOccupancy(b.state, { ...inputs, presentCount });
        this.behaviour = { kind: 'occupancy', state: r.state };
        return this.remember(r.telemetry);
      }
      case 'plug': {
        const inUse = ctx.peakActive ? true : this.applianceInUse(b.appliance, ctx);
        const r = stepPlug(b.state, { ...inputs, inUse });
        this.behaviour = { kind: 'plug', state: r.state, appliance: b.appliance };
        return this.remember(r.telemetry);
      }
      case 'room_meter': {
        const devicesPowerW = this.room ? ctx.roomPowerW(this.room) : 0;
        const r = stepRoomMeter(b.state, { ...inputs, devicesPowerW });
        this.behaviour = { kind: 'room_meter', state: r.state };
        return this.remember(r.telemetry);
      }
      case 'floor_meter': {
        const roomsPowerW = this.floor !== null ? ctx.floorRoomsPowerW(this.floor) : 0;
        const r = stepFloorMeter(b.state, { ...inputs, roomsPowerW });
        this.behaviour = { kind: 'floor_meter', state: r.state };
        return this.remember(r.telemetry);
      }
      case 'laptop': {
        const loc = this.laptopLocation(ctx.now);
        const r = stepLaptop(b.state, { ...inputs, ap: loc.accessPoint, docked: loc.docked });
        this.behaviour = { kind: 'laptop', state: r.state };
        return this.remember(r.telemetry);
      }
    }
  }

  private remember(t: TelemetryValues): TelemetryValues {
    this.lastTelemetry = t;
    return t;
  }

  private applianceInUse(appliance: string, ctx: StepContext): boolean {
    const minute = zonedMinutesOfDay(ctx.now, this.timeZone);
    const workHours = minute >= 8 * 60 && minute < 19 * 60;
    switch (appliance) {
      case 'projector':
        return this.room ? ctx.presentCount(this.room) > 0 : false;
      case 'monitor':
        return this.room ? ctx.laptopsOnlineInRoom(this.room) > 0 : false;
      case 'fridge':
        // compressor runs ten minutes in every thirty
        return Math.floor(ctx.now / 600_000) % 3 === 0;
      case 'coffee_machine':
        return workHours && minute % 60 < 5;
      case 'heater':
        return true;
      default:
        return workHours;
    }
  }

  /** Saves switch state when the peak starts and restores it when it ends. */
  private applyPeak(active: boolean): void {
    const b = this.behaviour;
    if (active && !this.prePeak) {
      if (b.kind === 'ac') {
        this.prePeak = { on: b.state.on, setpointC: b.state.setpointC };
        this.behaviour = { kind: 'ac', state: { ...b.state, on: 1, setpointC: 18 } };
      } else if (b.kind === 'light') {
        this.prePeak = { on: b.state.on };
        this.behaviour = { kind: 'light', state: { ...b.state, on: 1 } };
      } else if (b.kind === 'plug') {
        this.prePeak = { on: b.state.on };
        this.behaviour = { kind: 'plug', state: { ...b.state, on: 1 }, appliance: b.appliance };
      }
    } else if (!active && this.prePeak) {
      const saved = this.prePeak;
      this.prePeak = null;
      if (b.kind === 'ac') {
        this.behaviour = {
          kind: 'ac',
          state: { ...b.state, on: saved.on, setpointC: saved.setpointC ?? AC_DEFAULT_SETPOINT_C },
        };
      } else if (b.kind === 'light') {
        this.behaviour = { kind: 'light', state: { ...b.state, on: saved.on } };
      } else if (b.kind === 'plug') {
        this.behaviour = {
          kind: 'plug',
          state: { ...b.state, on: saved.on },
          appliance: b.appliance,
        };
      }
    }
  }

  /* -------------------------------------------------------------- scenario overrides */

  /** Extra load a scenario adds behind a plug (a heater left on); 0 removes it. Returns the new value. */
  setExtraLoadW(watts: number): number {
    const b = this.behaviour;
    if (b.kind !== 'plug') return 0;
    this.behaviour = { ...b, state: { ...b.state, extraLoadW: Math.max(0, watts) } };
    return Math.max(0, watts);
  }

  extraLoadW(): number {
    const b = this.behaviour;
    return b.kind === 'plug' ? b.state.extraLoadW : 0;
  }

  /**
   * Starts or stops the accelerated filter-clogging drift of an AC unit. Stopping resets the unit
   * to a healthy filter.
   */
  setFilterDrift(accelerated: boolean): void {
    const b = this.behaviour;
    if (b.kind !== 'ac') return;
    this.acceleratedDrift = accelerated;
    this.behaviour = {
      kind: 'ac',
      state: accelerated
        ? { ...b.state, filterDegrading: true }
        : { ...b.state, filterDegrading: false, degradeFactor: 1 },
    };
  }

  get filterDriftAccelerated(): boolean {
    return this.acceleratedDrift;
  }

  /** Electrical power drawn right now, for meters. */
  currentPowerW(): number {
    const b = this.behaviour;
    switch (b.kind) {
      case 'light':
        return b.state.on ? b.state.nominalPowerW : 0;
      case 'ac':
        return b.state.on ? b.state.powerW : 0;
      case 'plug':
        return b.state.on ? b.state.powerW : 0;
      case 'room_meter':
        return b.state.powerW;
      case 'floor_meter':
        return b.state.powerW;
      default:
        return 0;
    }
  }

  /* -------------------------------------------------------------- seeding */

  /**
   * Continues cumulative counters from the platform's latest known values (energy in kWh, AC
   * runtime hours and filter degradation) so a restart does not reset meters. Returns whether
   * anything was applied; switch states and temperatures stay as initialised.
   */
  seedCounters(values: TelemetryValues): boolean {
    const b = this.behaviour;
    const num = (k: string): number | null => {
      const v = values[k];
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    switch (b.kind) {
      case 'plug': {
        const e = num('energy_kwh');
        if (e === null) return false;
        this.behaviour = { ...b, state: { ...b.state, energyKwh: Math.max(b.state.energyKwh, e) } };
        return true;
      }
      case 'room_meter': {
        const e = num('energy_kwh');
        if (e === null) return false;
        this.behaviour = {
          kind: 'room_meter',
          state: { ...b.state, energyKwh: Math.max(b.state.energyKwh, e) },
        };
        return true;
      }
      case 'floor_meter': {
        const e = num('energy_kwh');
        if (e === null) return false;
        this.behaviour = {
          kind: 'floor_meter',
          state: { ...b.state, energyKwh: Math.max(b.state.energyKwh, e) },
        };
        return true;
      }
      case 'ac': {
        const runtime = num('runtime_h');
        const current = num('current_a');
        if (runtime === null && current === null) return false;
        const nominalA = b.state.nominalCurrentA;
        // the degrade factor is not published; recover it from the last current at full output
        const degrade =
          b.state.filterDegrading && current !== null && nominalA > 0 && current > nominalA
            ? Math.min(2, current / nominalA)
            : b.state.degradeFactor;
        this.behaviour = {
          kind: 'ac',
          state: { ...b.state, runtimeH: runtime ?? b.state.runtimeH, degradeFactor: degrade },
        };
        return true;
      }
      default:
        return false;
    }
  }

  /* -------------------------------------------------------------- RPC */

  applyRpc(raw: unknown): RpcResponse {
    const parsed = RpcRequestSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'invalid rpc request' };
    const req = parsed.data;
    const b = this.behaviour;
    if (req.method === 'setState') {
      const state = req.params.state;
      if (b.kind === 'light') this.behaviour = { kind: 'light', state: { ...b.state, on: state } };
      else if (b.kind === 'ac')
        this.behaviour = {
          kind: 'ac',
          state: { ...b.state, on: state, powerW: state ? b.state.powerW : 0 },
        };
      else if (b.kind === 'plug')
        this.behaviour = {
          kind: 'plug',
          state: { ...b.state, on: state, powerW: state ? b.state.powerW : 0 },
          appliance: b.appliance,
        };
      else return { ok: false, error: `setState not supported by ${this.type}` };
      // a manual switch during the peak must survive the peak's restore
      if (this.prePeak) this.prePeak = { ...this.prePeak, on: state };
      return { ok: true, state };
    }
    if (b.kind !== 'ac') return { ok: false, error: `setSetpoint not supported by ${this.type}` };
    this.behaviour = { kind: 'ac', state: { ...b.state, setpointC: req.params.setpoint_c } };
    if (this.prePeak) this.prePeak = { ...this.prePeak, setpointC: req.params.setpoint_c };
    return { ok: true, setpoint_c: req.params.setpoint_c };
  }

  /* -------------------------------------------------------------- inspection */

  /** Switch state for lights, AC units and plugs; null for others. */
  switchState(): 0 | 1 | null {
    const b = this.behaviour;
    return b.kind === 'light' || b.kind === 'ac' || b.kind === 'plug' ? b.state.on : null;
  }
}

/** Builds the laptop environment for a floor from the world. */
export function laptopEnvironmentFor(world: World, floor: number): LaptopEnvironment {
  const meetingRooms = meetingRoomsOnFloor(world, floor);
  return {
    meetingRooms,
    accessPointForRoom(room: string) {
      const r = world.rooms.find((x) => x.code === room);
      if (!r) return null;
      return world.zones.find((z) => z.code === r.zone)?.accessPoint ?? null;
    },
  };
}
