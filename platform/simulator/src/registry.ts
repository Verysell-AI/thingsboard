import { DEFAULT_TIME_ZONE, zonedDayKey } from '@platform/shared/clock';
import type { World } from '@platform/shared/dataset';
import type { TelemetryValues } from '@platform/shared/contracts';
import { VirtualDevice, laptopEnvironmentFor, type StepContext } from './device.js';
import type { DeviceSpec } from './world.js';

/**
 * Decides how many people an occupancy sensor sees in a room. The default derives presence from
 * laptops in meeting rooms; the simulation replaces it with laptops plus the platform's bookings.
 */
export interface OccupancySource {
  presentCount(room: string, now: number): number;
}

export interface TickResult {
  device: VirtualDevice;
  telemetry: TelemetryValues;
}

/** Step order: consumers first, then room meters, then floor meters, so every sum is current. */
const STEP_ORDER: Record<string, number> = {
  light: 0,
  ac: 0,
  plug: 0,
  occupancy: 0,
  laptop: 0,
  room_meter: 1,
  floor_meter: 2,
};

export class Registry {
  private readonly devices = new Map<string, VirtualDevice>();
  /** Codes of laptops currently connected, maintained by the transport layer. */
  private readonly online = new Set<string>();
  /** Everybody has left for the local day identified by this key. */
  private everyoneLeftDay: string | null = null;
  private peakUntil = 0;
  occupancySource: OccupancySource;

  constructor(
    readonly tenant: string,
    readonly world: World,
    readonly timeZone: string = DEFAULT_TIME_ZONE,
  ) {
    this.occupancySource = {
      presentCount: (room, now) => this.laptopsInRoom(room, now),
    };
  }

  /* ------------------------------------------------------------------ devices */

  add(spec: DeviceSpec): VirtualDevice {
    if (this.devices.has(spec.code)) throw new Error(`device ${spec.code} already exists`);
    const env =
      spec.type === 'laptop' && spec.floor !== null
        ? laptopEnvironmentFor(this.world, spec.floor)
        : null;
    const device = new VirtualDevice(spec, env, this.timeZone);
    this.devices.set(spec.code, device);
    return device;
  }

  remove(code: string): VirtualDevice | undefined {
    const d = this.devices.get(code);
    this.devices.delete(code);
    this.online.delete(code);
    return d;
  }

  get(code: string): VirtualDevice | undefined {
    return this.devices.get(code);
  }

  all(): VirtualDevice[] {
    return [...this.devices.values()];
  }

  laptops(): VirtualDevice[] {
    return this.all().filter((d) => d.type === 'laptop');
  }

  /* ------------------------------------------------------------------ presence */

  setOnline(code: string, online: boolean): void {
    if (online) this.online.add(code);
    else this.online.delete(code);
  }

  isOnline(code: string): boolean {
    return this.online.has(code);
  }

  laptopsInRoom(room: string, now: number): number {
    let n = 0;
    for (const d of this.laptops()) {
      if (!this.online.has(d.code)) continue;
      if (d.laptopLocation(now).room === room) n++;
    }
    return n;
  }

  /* ------------------------------------------------------------------ scenarios */

  everyoneLeaves(now: number): void {
    this.everyoneLeftDay = zonedDayKey(now, this.timeZone);
    // a laptop a scenario keeps online (the late worker) stays
    for (const d of this.laptops()) if (!d.isForcedOnline(now)) d.leaveForToday(now);
  }

  plugsInRoom(room: string): VirtualDevice[] {
    return this.all().filter((d) => d.type === 'plug' && d.room === room);
  }

  /** Laptop by employee code (E009), laptop code (LAPTOP-E009) or the platform employee id. */
  laptopForEmployee(ref: string): VirtualDevice | undefined {
    return this.laptops().find(
      (d) =>
        d.code === ref ||
        d.spec.laptop?.employeeCode === ref ||
        d.code === `LAPTOP-${ref}` ||
        d.spec.laptop?.employeeCode === ref.replace(/^LAPTOP-/, ''),
    );
  }

  startPeak(now: number, durationMs: number): void {
    this.peakUntil = now + durationMs;
  }

  peakActive(now: number): boolean {
    return this.peakUntil > now;
  }

  /* ------------------------------------------------------------------ power sums */

  roomPowerW(room: string): number {
    let sum = 0;
    for (const d of this.devices.values()) {
      if (d.room === room && (d.type === 'light' || d.type === 'ac' || d.type === 'plug')) {
        sum += d.currentPowerW();
      }
    }
    return sum;
  }

  floorRoomsPowerW(floor: number): number {
    let sum = 0;
    for (const d of this.devices.values()) {
      if (d.type === 'room_meter' && d.floor === floor) sum += d.currentPowerW();
    }
    return sum;
  }

  /* ------------------------------------------------------------------ tick */

  /** One behaviour step at business time `now`, `dt` virtual seconds after the previous one. */
  tick(now: number, dt: number): TickResult[] {
    const peakActive = this.peakActive(now);
    const everyoneLeft = this.everyoneLeftDay === zonedDayKey(now, this.timeZone);
    const ctx: StepContext = {
      now,
      dt,
      peakActive,
      roomPowerW: (room) => this.roomPowerW(room),
      floorRoomsPowerW: (floor) => this.floorRoomsPowerW(floor),
      presentCount: (room) => (everyoneLeft ? 0 : this.occupancySource.presentCount(room, now)),
      laptopsOnlineInRoom: (room) => this.laptopsInRoom(room, now),
    };
    const ordered = this.all().sort(
      (a, b) => (STEP_ORDER[a.type] ?? 0) - (STEP_ORDER[b.type] ?? 0),
    );
    return ordered.map((device) => ({ device, telemetry: device.step(ctx) }));
  }
}
