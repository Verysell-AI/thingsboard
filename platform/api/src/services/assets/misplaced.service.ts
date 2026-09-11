import { eq } from 'drizzle-orm';
import type { Role } from '@platform/shared/roles';
import type { Db } from '../../db/index.js';
import { assets, users } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import type { RedisLike } from '../../lib/redis.js';
import type { AuditService } from '../audit/audit.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { PresenceService, Topology } from '../rooms/presence.service.js';

/** A laptop back at its desk for this long is no longer misplaced. */
export const HOME_CLEAR_MINUTES = 60;
/** Longest interval counted per tick so a time-machine jump does not misplace everything. */
const MAX_STEP_MS = 15 * 60_000;
const OPERATIONS_ROLES: Role[] = ['TENANT_ADMIN', 'OPS_MANAGER'];

export interface LaptopDwell {
  /** Minutes accumulated per room code. */
  rooms: Record<string, number>;
  /** Consecutive minutes at the desk room. */
  homeMinutes: number;
  lastTs: number;
}

export interface DwellDecision {
  flag: string | null;
  clear: boolean;
}

const key = (tenant: string, laptop: string) => `misplaced:${tenant}:${laptop}`;

/** Advances one laptop's dwell counters and says whether to flag or clear it. Pure. */
export function advanceDwell(
  previous: LaptopDwell | null,
  currentRoom: string | null,
  deskRoom: string | null,
  meetingRooms: Set<string>,
  now: number,
  thresholdMinutes: number,
  currentlyFlagged: boolean,
): { next: LaptopDwell; decision: DwellDecision } {
  const dtMinutes =
    previous && now > previous.lastTs ? Math.min(now - previous.lastTs, MAX_STEP_MS) / 60_000 : 0;
  const rooms = { ...(previous?.rooms ?? {}) };
  let homeMinutes = previous?.homeMinutes ?? 0;
  const decision: DwellDecision = { flag: null, clear: false };
  if (currentRoom) {
    if (currentRoom === deskRoom) {
      homeMinutes += dtMinutes;
      if (currentlyFlagged && homeMinutes >= HOME_CLEAR_MINUTES) {
        decision.clear = true;
        for (const k of Object.keys(rooms)) rooms[k] = 0;
      }
    } else {
      homeMinutes = 0;
      rooms[currentRoom] = (rooms[currentRoom] ?? 0) + dtMinutes;
      const foreign = !meetingRooms.has(currentRoom);
      if (foreign && rooms[currentRoom]! >= thresholdMinutes && !currentlyFlagged)
        decision.flag = currentRoom;
    }
  }
  return { next: { rooms, homeMinutes, lastTs: now }, decision };
}

/**
 * Flags laptops that spend a working day in a room that is neither their custodian's desk room nor
 * a meeting room, and clears the flag once they are back at the desk for an hour.
 */
export class MisplacedService {
  constructor(
    private readonly db: Db,
    private readonly redis: RedisLike,
    private readonly audit: AuditService,
    private readonly presence: PresenceService,
    private readonly notifications: NotificationsService,
    private readonly thresholdHours: number,
  ) {}

  async tick(tenant: { id: string; key: string }, now: number): Promise<void> {
    const topology: Topology = await this.presence.topology(tenant);
    const positions = await this.presence.laptopPositions(tenant.key);
    const meetingRooms = new Set(
      topology.rooms.filter((r) => r.kind === 'meeting').map((r) => r.code),
    );
    const roomIdByCode = new Map(topology.rooms.map((r) => [r.code, r.id]));
    const flagged = await withTenant(this.db, tenant.id, (tx) =>
      tx
        .select({ id: assets.id, misplacedRoomId: assets.misplacedRoomId })
        .from(assets)
        .where(eq(assets.deviceType, 'laptop')),
    );
    const flaggedById = new Map(flagged.map((a) => [a.id, a.misplacedRoomId]));
    for (const laptop of topology.laptops) {
      const raw = await this.redis.get(key(tenant.key, laptop.code));
      const previous = raw ? (JSON.parse(raw) as LaptopDwell) : null;
      const position = positions.get(laptop.code);
      const currentRoom = position?.room ?? null;
      const { next, decision } = advanceDwell(
        previous,
        currentRoom,
        laptop.deskRoom,
        meetingRooms,
        now,
        this.thresholdHours * 60,
        Boolean(flaggedById.get(laptop.assetId)),
      );
      await this.redis.set(key(tenant.key, laptop.code), JSON.stringify(next), 'EX', 30 * 86_400);
      if (decision.flag)
        await this.flag(tenant, laptop, decision.flag, roomIdByCode.get(decision.flag));
      if (decision.clear) await this.clear(tenant, laptop);
    }
  }

  private async flag(
    tenant: { id: string; key: string },
    laptop: Topology['laptops'][number],
    room: string,
    roomId: string | undefined,
  ): Promise<void> {
    if (!roomId) return;
    const custodianUsers = await withTenant(this.db, tenant.id, async (tx) => {
      await tx
        .update(assets)
        .set({ misplacedRoomId: roomId, updatedAt: new Date() })
        .where(eq(assets.id, laptop.assetId));
      await this.audit.record(tx, {
        tenantId: tenant.id,
        action: 'asset.misplaced',
        entityType: 'asset',
        entityId: laptop.assetId,
        before: { deskRoom: laptop.deskRoom },
        after: { room, hours: this.thresholdHours },
      });
      return laptop.custodianEmployeeId
        ? tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.employeeId, laptop.custodianEmployeeId))
        : [];
    });
    await this.notifications.create({
      tenantId: tenant.id,
      tenantKey: tenant.key,
      userIds: custodianUsers.map((u) => u.id),
      roles: OPERATIONS_ROLES,
      kind: 'asset.misplaced',
      title: `Misplaced laptop: ${laptop.code}`,
      body: `${laptop.code} has been in ${room} for more than ${this.thresholdHours} hours; its desk is in ${laptop.deskRoom ?? 'an unknown room'}.`,
      subject: laptop.code,
    });
  }

  private async clear(
    tenant: { id: string; key: string },
    laptop: Topology['laptops'][number],
  ): Promise<void> {
    await withTenant(this.db, tenant.id, async (tx) => {
      await tx
        .update(assets)
        .set({ misplacedRoomId: null, updatedAt: new Date() })
        .where(eq(assets.id, laptop.assetId));
      await this.audit.record(tx, {
        tenantId: tenant.id,
        action: 'asset.misplaced_cleared',
        entityType: 'asset',
        entityId: laptop.assetId,
        after: { deskRoom: laptop.deskRoom },
      });
    });
  }
}
