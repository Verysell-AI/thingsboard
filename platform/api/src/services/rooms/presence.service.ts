import { and, eq, isNotNull } from 'drizzle-orm';
import type { DeviceLiveState } from '@platform/shared/dto';
import type { Db } from '../../db/index.js';
import { assets, employees, locations } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import type { RedisLike } from '../../lib/redis.js';
import type { LiveStateService } from '../live/live-state.service.js';
import type { ReplayService } from '../live/replay.service.js';
import type { ClockService } from '../clock/clock.service.js';

/** Presence of one room as the platform sees it. */
export interface RoomPresence {
  room: string;
  occupied: boolean;
  /** What the occupancy sensor alone says (false in rooms without one). */
  sensorOccupied: boolean;
  /** People counted by the occupancy sensor, or laptops when the room has no sensor. */
  count: number;
  laptopsOnline: number;
  laptopCodes: string[];
  /** Business time the room became empty; null while occupied. */
  emptySince: number | null;
  updatedAt: number;
}

/** Where a laptop is, with the debounce bookkeeping for access-point changes. */
export interface LaptopPosition {
  room: string;
  /** Business time the laptop was first seen in `room`. */
  since: number;
  pendingRoom: string | null;
  pendingSince: number | null;
}

/** What presence derivation needs to know about the building; cached per tenant. */
export interface Topology {
  rooms: {
    id: string;
    code: string;
    kind: string | null;
    zone: string | null;
    critical: boolean;
    floor: number | null;
  }[];
  /** Zone code → access point id. */
  accessPoints: Record<string, string>;
  laptops: {
    assetId: string;
    code: string;
    deskRoom: string | null;
    homeZone: string | null;
    custodianEmployeeId: string | null;
  }[];
}

/** A laptop must report a new access point for this long before it moves rooms. */
export const AP_DEBOUNCE_MS = 60_000;
const TOPOLOGY_TTL_MS = 60_000;

const laptopsKey = (tenant: string) => `presence:${tenant}:__laptops`;
const roomKey = (tenant: string, room: string) => `presence:${tenant}:${room}`;

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Room a laptop should be attributed to right now, before debouncing. */
export function locateLaptop(
  topology: Topology,
  laptop: Topology['laptops'][number],
  ap: string | null,
  sensorCounts: Map<string, number>,
): string | null {
  const homeAp = laptop.homeZone ? topology.accessPoints[laptop.homeZone] : undefined;
  if (!ap || !homeAp || ap === homeAp) return laptop.deskRoom;
  const zone = Object.entries(topology.accessPoints).find(([, id]) => id === ap)?.[0];
  if (!zone) return laptop.deskRoom;
  const meetingRooms = topology.rooms.filter((r) => r.kind === 'meeting' && r.zone === zone);
  if (meetingRooms.length === 0) return laptop.deskRoom;
  const busy = meetingRooms.find((r) => (sensorCounts.get(r.code) ?? 0) > 0);
  return (busy ?? meetingRooms[0]!).code;
}

/** Applies the access-point debounce to one laptop's position. Pure. */
export function debouncePosition(
  previous: LaptopPosition | undefined,
  wanted: string | null,
  now: number,
  debounceMs = AP_DEBOUNCE_MS,
): LaptopPosition | null {
  if (wanted === null) return null;
  if (!previous) return { room: wanted, since: now, pendingRoom: null, pendingSince: null };
  if (previous.room === wanted) return { ...previous, pendingRoom: null, pendingSince: null };
  if (previous.pendingRoom === wanted && previous.pendingSince !== null) {
    if (now - previous.pendingSince >= debounceMs)
      return { room: wanted, since: now, pendingRoom: null, pendingSince: null };
    return previous;
  }
  return { ...previous, pendingRoom: wanted, pendingSince: now };
}

export interface DerivedPresence {
  rooms: Map<string, RoomPresence>;
  laptops: Map<string, LaptopPosition>;
  changed: string[];
}

/** Derives every room's presence from live state and the previous snapshot. Pure. */
export function derivePresence(
  topology: Topology,
  devices: DeviceLiveState[],
  previousRooms: Map<string, RoomPresence>,
  previousLaptops: Map<string, LaptopPosition>,
  now: number,
  debounceMs = AP_DEBOUNCE_MS,
): DerivedPresence {
  const byCode = new Map(devices.map((d) => [d.deviceCode, d]));
  const sensorCounts = new Map<string, number>();
  const sensorOccupied = new Map<string, boolean>();
  for (const d of devices) {
    if (d.deviceType !== 'occupancy' || !d.room) continue;
    sensorCounts.set(d.room, Math.max(0, Math.round(num(d.values.count) ?? 0)));
    sensorOccupied.set(d.room, num(d.values.occupied) === 1);
  }

  const laptops = new Map<string, LaptopPosition>();
  const laptopsByRoom = new Map<string, string[]>();
  for (const laptop of topology.laptops) {
    const live = byCode.get(laptop.code);
    if (!live?.online) continue;
    const ap = typeof live.values.ap === 'string' ? live.values.ap : null;
    const wanted = locateLaptop(topology, laptop, ap, sensorCounts);
    const position = debouncePosition(previousLaptops.get(laptop.code), wanted, now, debounceMs);
    if (!position) continue;
    laptops.set(laptop.code, position);
    const list = laptopsByRoom.get(position.room) ?? [];
    list.push(laptop.code);
    laptopsByRoom.set(position.room, list);
  }

  const rooms = new Map<string, RoomPresence>();
  const changed: string[] = [];
  for (const room of topology.rooms) {
    const codes = (laptopsByRoom.get(room.code) ?? []).sort();
    const hasSensor = sensorCounts.has(room.code);
    const count = hasSensor ? Math.max(sensorCounts.get(room.code)!, codes.length) : codes.length;
    const bySensor = sensorOccupied.get(room.code) ?? false;
    const occupied = bySensor || codes.length > 0;
    const prev = previousRooms.get(room.code);
    const emptySince = occupied ? null : (prev?.emptySince ?? now);
    const next: RoomPresence = {
      room: room.code,
      occupied,
      sensorOccupied: bySensor,
      count,
      laptopsOnline: codes.length,
      laptopCodes: codes,
      emptySince,
      updatedAt: now,
    };
    rooms.set(room.code, next);
    if (
      !prev ||
      prev.occupied !== occupied ||
      prev.count !== count ||
      prev.laptopCodes.join(',') !== codes.join(',')
    )
      changed.push(room.code);
  }
  return { rooms, laptops, changed };
}

/**
 * Who is where: per-room occupancy derived from occupancy sensors and online laptops (placed by
 * their Wi-Fi access point, debounced), kept in Redis so every replica and the worker agree, and
 * announced as `room.presence` events when it changes.
 */
export class PresenceService {
  private readonly topologies = new Map<string, { value: Topology; expires: number }>();

  constructor(
    private readonly db: Db,
    private readonly redis: RedisLike,
    private readonly live: LiveStateService,
    private readonly replay: ReplayService,
    private readonly clock: ClockService,
    private readonly realNow: () => number = Date.now,
  ) {}

  invalidateTopology(tenantKey?: string): void {
    if (tenantKey) this.topologies.delete(tenantKey);
    else this.topologies.clear();
  }

  async topology(tenant: { id: string; key: string }): Promise<Topology> {
    const hit = this.topologies.get(tenant.key);
    if (hit && hit.expires > this.realNow()) return hit.value;
    const value = await withTenant(this.db, tenant.id, async (tx) => {
      const rows = await tx
        .select()
        .from(locations)
        .where(and(eq(locations.type, 'ROOM')));
      const zones = await tx.select().from(locations).where(eq(locations.type, 'ZONE'));
      const laptopRows = await tx
        .select({ asset: assets, employee: employees, room: locations })
        .from(assets)
        .leftJoin(employees, eq(employees.id, assets.custodianEmployeeId))
        .leftJoin(locations, eq(locations.id, assets.locationId))
        .where(and(eq(assets.deviceType, 'laptop'), isNotNull(assets.tbDeviceId)));
      const accessPoints: Record<string, string> = {};
      for (const z of zones)
        if (z.geometry?.accessPoint) accessPoints[z.code] = z.geometry.accessPoint;
      return {
        rooms: rows.map((r) => ({
          id: r.id,
          code: r.code,
          kind: r.kind,
          zone: r.zone,
          critical: r.critical,
          floor: r.floor,
        })),
        accessPoints,
        laptops: laptopRows.map((l) => ({
          assetId: l.asset.id,
          code: l.asset.code,
          deskRoom: l.room?.code ?? null,
          homeZone: l.employee?.zone ?? l.room?.zone ?? null,
          custodianEmployeeId: l.asset.custodianEmployeeId,
        })),
      } satisfies Topology;
    });
    this.topologies.set(tenant.key, { value, expires: this.realNow() + TOPOLOGY_TTL_MS });
    return value;
  }

  /** Current presence per room from Redis (no recomputation). */
  async presence(tenant: { id: string; key: string }): Promise<Map<string, RoomPresence>> {
    const topology = await this.topology(tenant);
    const out = new Map<string, RoomPresence>();
    for (const room of topology.rooms) {
      const raw = await this.redis.hgetall(roomKey(tenant.key, room.code));
      if (!raw || !raw.updatedAt) continue;
      out.set(room.code, parseRoom(room.code, raw));
    }
    return out;
  }

  async laptopPositions(tenantKey: string): Promise<Map<string, LaptopPosition>> {
    const raw = await this.redis.hgetall(laptopsKey(tenantKey));
    const out = new Map<string, LaptopPosition>();
    for (const [code, json] of Object.entries(raw ?? {})) {
      try {
        out.set(code, JSON.parse(json) as LaptopPosition);
      } catch {
        // ignore a corrupt entry; it is rewritten on the next refresh
      }
    }
    return out;
  }

  /** Recomputes presence from live state, persists it and publishes changes. */
  async refresh(tenant: { id: string; key: string }): Promise<Map<string, RoomPresence>> {
    const [topology, devices, previousRooms, previousLaptops, now] = await Promise.all([
      this.topology(tenant),
      this.live.snapshot(tenant.key),
      this.presence(tenant),
      this.laptopPositions(tenant.key),
      this.clock.now(tenant.key),
    ]);
    const derived = derivePresence(topology, devices, previousRooms, previousLaptops, now);
    for (const [code, p] of derived.rooms) {
      await this.redis.hset(roomKey(tenant.key, code), serializeRoom(p));
    }
    const laptopHash: Record<string, string> = {};
    for (const [code, pos] of derived.laptops) laptopHash[code] = JSON.stringify(pos);
    await this.redis.del(laptopsKey(tenant.key));
    if (Object.keys(laptopHash).length) await this.redis.hset(laptopsKey(tenant.key), laptopHash);
    for (const code of derived.changed) {
      const p = derived.rooms.get(code)!;
      await this.replay.append(tenant.key, {
        kind: 'room.presence',
        tenantKey: tenant.key,
        ts: this.realNow(),
        room: code,
        occupied: p.occupied,
        laptopsOnline: p.laptopsOnline,
        count: p.count,
      });
    }
    return derived.rooms;
  }
}

function parseRoom(room: string, raw: Record<string, string>): RoomPresence {
  return {
    room,
    occupied: raw.occupied === '1',
    sensorOccupied: raw.sensorOccupied === '1',
    count: Number(raw.count ?? 0),
    laptopsOnline: Number(raw.laptopsOnline ?? 0),
    laptopCodes: raw.laptops ? (JSON.parse(raw.laptops) as string[]) : [],
    emptySince: raw.emptySince ? Number(raw.emptySince) : null,
    updatedAt: Number(raw.updatedAt ?? 0),
  };
}

function serializeRoom(p: RoomPresence): Record<string, string> {
  return {
    occupied: p.occupied ? '1' : '0',
    sensorOccupied: p.sensorOccupied ? '1' : '0',
    count: String(p.count),
    laptopsOnline: String(p.laptopsOnline),
    laptops: JSON.stringify(p.laptopCodes),
    emptySince: p.emptySince === null ? '' : String(p.emptySince),
    updatedAt: String(p.updatedAt),
  };
}
