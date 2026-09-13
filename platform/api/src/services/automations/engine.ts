import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { redisKeys } from '@platform/shared/contracts';
import {
  AUTOMATION_KEYS,
  PeakSheddingStateSchema,
  parseAutomationParams,
  type AutomationKey,
  AutomationLastCheckSchema,
  type AutomationLastCheck,
  type AutomationRun,
  type Decision,
  type PeakSheddingState,
} from '@platform/shared/dto';
import type { Db } from '../../db/index.js';
import {
  assets,
  automationRuns,
  automations,
  employees,
  holds,
  locations,
  users,
  type AutomationRow,
  type AutomationRunRow,
} from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import { getContext, runWithContext } from '../../lib/context.js';
import { conflict } from '../../lib/errors.js';
import type { RedisLike } from '../../lib/redis.js';
import { startOfDay, type BookingsService } from '../bookings/bookings.service.js';
import type { ClockService } from '../clock/clock.service.js';
import type { CommandsService } from '../commands/commands.service.js';
import type { LiveStateService } from '../live/live-state.service.js';
import type { ReplayService } from '../live/replay.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { PresenceService } from '../rooms/presence.service.js';
import { bookedNow, type WasteService } from '../rooms/waste.service.js';
import type { MisplacedService } from '../assets/misplaced.service.js';
import {
  buildRoomStates,
  withoutLaptops,
  type PersonPresence,
  type RuleContext,
} from './context.js';
import { ruleFor } from './registry.js';
import { emptyShedState } from './rules/peak-shedding.rule.js';

export interface EngineTenant {
  id: string;
  key: string;
  tariffPerKwh: number;
  demoMode: boolean;
}

export interface RunOptions {
  trigger: string;
  /** Run only this automation (manual runs), whether or not it is enabled. */
  only?: AutomationKey;
  force?: boolean;
  scope?: { zone?: string; floor?: number };
  /** Manual peak-shedding action. */
  action?: 'shed' | 'restore';
  /** People treated as gone ("Leaving now"): their laptops no longer keep rooms or zones on. */
  excludeUserIds?: string[];
}

const actedDayKey = (tenant: string, key: string) => `automations:${tenant}:${key}:actedDay`;
const shedStateKey = (tenant: string) => `automations:${tenant}:peak_shedding:state`;
const lastCheckKey = (tenant: string, key: string) => `automations:${tenant}:${key}:lastCheck`;
/** How long the "last checked" marker outlives the last tick. */
const LAST_CHECK_TTL_S = 7 * 86_400;

/** Delay between successive device commands so a sweep is visible room by room. */
export const COMMAND_SPACING_MS = 300;
/** How long a tenant's tick holds the lock; a stuck worker frees the tenant after this. */
export const LOCK_TTL_MS = 55_000;
const MAX_STORED_DECISIONS = 200;

export function toRunDto(row: AutomationRunRow): AutomationRun {
  return {
    id: row.id,
    key: row.key,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    trigger: row.trigger,
    summary: row.summary,
  };
}

/** Cumulative energy counter of the room meter, when it reports. */
function meterEnergy(state: {
  devices: { deviceType: string; values: Record<string, unknown> }[];
}) {
  const meter = state.devices.find((d) => d.deviceType === 'room_meter');
  const v = meter ? Number(meter.values.energy_kwh) : NaN;
  return Number.isFinite(v) ? v : null;
}

/**
 * Whether a run is worth a row in the history. Scheduled ticks fire every minute and most of them
 * decide nothing, so only ticks that acted (a command, a release, a notification), closed a sweep
 * day, or moved the peak-shedding state machine are recorded; every other trigger (manual runs,
 * notification actions, backfills) is always kept. Pure.
 */
export function worthRecording(
  trigger: string,
  decisions: Decision[],
  previousShedState: PeakSheddingState,
): boolean {
  if (trigger !== 'schedule') return true;
  for (const d of decisions) {
    if (d.kind === 'command' || d.kind === 'release_booking' || d.kind === 'notify') return true;
    if (d.kind !== 'summary') continue;
    if (typeof d.data.actedDay === 'string') return true;
    const shed = PeakSheddingStateSchema.safeParse(d.data.shedState);
    if (
      shed.success &&
      (shed.data.status !== previousShedState.status || shed.data.level !== previousShedState.level)
    )
      return true;
  }
  return false;
}

/** Counts a run's decisions into the summary shape the web and the morning report read. */
export function summarise(decisions: Decision[]) {
  const roomsOff = [...new Set(decisions.filter((d) => d.kind === 'command').map((d) => d.room))];
  const roomsSkipped = decisions
    .filter((d): d is Extract<Decision, { kind: 'skip' }> => d.kind === 'skip')
    .map((d) => ({ room: d.room, reason: d.reason, detail: d.detail ?? null }));
  const extra = Object.assign(
    {},
    ...decisions
      .filter((d): d is Extract<Decision, { kind: 'summary' }> => d.kind === 'summary')
      .map((d) => d.data),
  ) as Record<string, unknown>;
  return {
    ...extra,
    roomsOff,
    roomsSkipped,
    commandsPlanned: decisions.filter((d) => d.kind === 'command').length,
    released: decisions
      .filter(
        (d): d is Extract<Decision, { kind: 'release_booking' }> => d.kind === 'release_booking',
      )
      .map((d) => d.room),
  };
}

/**
 * Runs the tenant's automations: refreshes presence, integrates waste and misplaced counters,
 * evaluates every enabled rule against one shared context and applies the decisions through the
 * platform services, recording one AutomationRun per automation. One tick per tenant at a time.
 */
export class AutomationEngine {
  constructor(
    private readonly db: Db,
    private readonly redis: RedisLike,
    private readonly clock: ClockService,
    private readonly live: LiveStateService,
    private readonly presence: PresenceService,
    private readonly waste: WasteService,
    private readonly misplaced: MisplacedService,
    private readonly bookings: BookingsService,
    private readonly commands: CommandsService,
    private readonly notifications: NotificationsService,
    private readonly replay: ReplayService,
    private readonly timeZone: string,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
    private readonly realNow: () => number = Date.now,
  ) {}

  private async acquireLock(tenantKey: string, waitMs: number): Promise<string | null> {
    const key = redisKeys.automationLock(tenantKey);
    const token = `${this.realNow()}:${Math.random().toString(36).slice(2)}`;
    const deadline = this.realNow() + waitMs;
    for (;;) {
      const ok = await this.redis.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
      if (ok === 'OK') return token;
      if (this.realNow() >= deadline) return null;
      await this.sleep(200);
    }
  }

  private async releaseLock(tenantKey: string, token: string): Promise<void> {
    const key = redisKeys.automationLock(tenantKey);
    if ((await this.redis.get(key)) === token) await this.redis.del(key);
  }

  /** Builds the shared rule context and runs the per-tick integrators. */
  async buildContext(
    tenant: EngineTenant,
    scope?: RunOptions['scope'],
    integrate = true,
    opts: {
      manual?: boolean;
      action?: RunOptions['action'];
      excludeUserIds?: string[];
    } = {},
  ): Promise<RuleContext> {
    const now = await this.clock.now(tenant.key);
    const presence = await this.presence.refresh(tenant);
    const devices = await this.live.snapshot(tenant.key);
    const dayStart = startOfDay(now, this.timeZone);
    const { rooms, assetRows, bookings, activeHolds, automationRows, owners } = await withTenant(
      this.db,
      tenant.id,
      async (tx) => ({
        rooms: await tx
          .select()
          .from(locations)
          .where(eq(locations.type, 'ROOM'))
          .orderBy(locations.code),
        assetRows: await tx.select().from(assets).where(isNotNull(assets.tbDeviceId)),
        bookings: await this.bookings.inRange(tx, dayStart, dayStart + 24 * 3_600_000, {
          status: ['ACTIVE'],
        }),
        activeHolds: await tx
          .select()
          .from(holds)
          .where(gt(holds.until, new Date(now))),
        automationRows: await tx.select().from(automations),
        owners: await tx
          .select({
            laptopCode: assets.code,
            employeeId: employees.id,
            employeeName: employees.name,
            userId: users.id,
          })
          .from(assets)
          .innerJoin(employees, eq(employees.id, assets.custodianEmployeeId))
          .leftJoin(users, eq(users.employeeId, employees.id))
          .where(eq(assets.deviceType, 'laptop')),
      }),
    );
    const ownerByLaptop = new Map(owners.map((o) => [o.laptopCode, o]));
    const excluded = new Set(opts.excludeUserIds ?? []);
    const excludedLaptops = new Set(
      owners.filter((o) => o.userId && excluded.has(o.userId)).map((o) => o.laptopCode),
    );
    if (excludedLaptops.size)
      for (const [code, p] of presence) presence.set(code, withoutLaptops(p, excludedLaptops));
    const states = buildRoomStates(rooms, assetRows, devices, presence);
    const people: PersonPresence[] = [];
    for (const state of states) {
      for (const code of state.presence?.laptopCodes ?? []) {
        const owner = ownerByLaptop.get(code);
        people.push({
          laptopCode: code,
          room: state.room.code,
          zone: state.room.zone,
          employeeId: owner?.employeeId ?? null,
          employeeName: owner?.employeeName ?? null,
          userId: owner?.userId ?? null,
        });
      }
    }
    const floorMeters = devices.filter(
      (d) => d.deviceType === 'floor_meter' && Number.isFinite(Number(d.values.power_w)),
    );
    const buildingPowerW = floorMeters.length
      ? floorMeters.reduce((sum, d) => sum + Number(d.values.power_w), 0)
      : null;
    const automationMap: RuleContext['automations'] = {};
    for (const row of automationRows)
      if (AUTOMATION_KEYS.includes(row.key as AutomationKey))
        automationMap[row.key as AutomationKey] = { enabled: row.enabled, params: row.params };
    const lastActedDay: RuleContext['lastActedDay'] = {};
    for (const key of ['evening_sweep', 'holiday_mode'] as const) {
      const day = await this.redis.get(actedDayKey(tenant.key, key));
      if (day) lastActedDay[key] = day;
    }
    const shedState = await this.shedState(tenant.key);
    if (integrate) {
      await this.waste.tick(
        tenant,
        now,
        states.map((s) => ({
          room: s.room,
          presence: s.presence,
          lightsOn: s.lightsOn,
          acOn: s.acOn,
          powerW: s.powerW,
          energyKwh: meterEnergy(s),
          bookedNow: bookedNow(bookings, s.room.id, now),
        })),
      );
      await this.misplaced.tick(tenant, now);
    }
    return {
      tenant: { id: tenant.id, key: tenant.key, tariffPerKwh: tenant.tariffPerKwh },
      now,
      timeZone: this.timeZone,
      rooms: states,
      bookings,
      holds: activeHolds,
      scope,
      people,
      buildingPowerW,
      automations: automationMap,
      lastActedDay,
      shedState,
      manual: opts.manual ?? false,
      action: opts.action,
    };
  }

  /** Persisted peak-shedding state machine (NORMAL when nothing is stored). */
  async shedState(tenantKey: string): Promise<PeakSheddingState> {
    const raw = await this.redis.get(shedStateKey(tenantKey));
    if (!raw) return emptyShedState();
    const parsed = PeakSheddingStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : emptyShedState();
  }

  /** Building load (kW) from the floor meters in the live snapshot. */
  async buildingKw(tenantKey: string): Promise<number | null> {
    const devices = await this.live.snapshot(tenantKey);
    const meters = devices.filter(
      (d) => d.deviceType === 'floor_meter' && Number.isFinite(Number(d.values.power_w)),
    );
    if (meters.length === 0) return null;
    return meters.reduce((sum, d) => sum + Number(d.values.power_w), 0) / 1000;
  }

  /** When each automation was last evaluated, recorded or not; null before the first tick. */
  async lastChecks(
    tenantKey: string,
  ): Promise<Partial<Record<AutomationKey, AutomationLastCheck>>> {
    const out: Partial<Record<AutomationKey, AutomationLastCheck>> = {};
    for (const key of AUTOMATION_KEYS) {
      const raw = await this.redis.get(lastCheckKey(tenantKey, key));
      if (!raw) continue;
      const parsed = AutomationLastCheckSchema.safeParse(JSON.parse(raw));
      if (parsed.success) out[key] = parsed.data;
    }
    return out;
  }

  /** One tick (or manual run) for a tenant. Returns the runs recorded. */
  async run(tenant: EngineTenant, opts: RunOptions): Promise<AutomationRun[]> {
    const token = await this.acquireLock(tenant.key, opts.only ? 5_000 : 0);
    if (!token) {
      if (opts.only) throw conflict('Another automation run is in progress for this tenant');
      return [];
    }
    try {
      const rows = await withTenant(this.db, tenant.id, (tx) =>
        tx
          .select()
          .from(automations)
          .where(
            opts.only
              ? eq(automations.key, opts.only)
              : and(eq(automations.enabled, true), inArray(automations.key, [...AUTOMATION_KEYS])),
          ),
      );
      const selected = rows.filter(
        (r) => AUTOMATION_KEYS.includes(r.key as AutomationKey) && (opts.force || r.enabled),
      );
      const ctx = await this.buildContext(tenant, opts.scope, !opts.only, {
        manual: Boolean(opts.only),
        action: opts.action,
        excludeUserIds: opts.excludeUserIds,
      });
      const runs: AutomationRun[] = [];
      for (const row of selected) {
        const run = await this.runOne(tenant, row, ctx, opts);
        if (run) runs.push(run);
      }
      return runs;
    } finally {
      await this.releaseLock(tenant.key, token);
    }
  }

  private async runOne(
    tenant: EngineTenant,
    row: AutomationRow,
    ctx: RuleContext,
    opts: RunOptions,
  ): Promise<AutomationRun | null> {
    const key = row.key as AutomationKey;
    const rule = ruleFor(key);
    const startedAt = this.realNow();
    const decisions: Decision[] = rule
      ? rule.evaluate(ctx, parseAutomationParams(key, row.params))
      : [{ kind: 'note', message: `no rule available for ${key} yet` }];
    const recorded = worthRecording(opts.trigger, decisions, ctx.shedState);
    const started = recorded
      ? await withTenant(this.db, tenant.id, async (tx) => {
          const [r] = await tx
            .insert(automationRuns)
            .values({
              tenantId: tenant.id,
              key,
              trigger: opts.trigger,
              startedAt: new Date(startedAt),
              summary: { businessTime: ctx.now, trigger: opts.trigger },
            })
            .returning();
          return r!;
        })
      : null;
    const runId = started?.id ?? randomUUID();
    if (started) await this.emitRun(tenant.key, key, runId, 'started');
    const counters = { commandsSent: 0, commandsFailed: 0, released: 0, notified: 0 };

    await runWithContext(
      {
        ...getContext(),
        tenantId: tenant.id,
        tenantKey: tenant.key,
        automationRunId: started?.id ?? null,
      },
      async () => {
        let first = true;
        for (const d of decisions) {
          switch (d.kind) {
            case 'command': {
              if (!first) await this.sleep(COMMAND_SPACING_MS);
              first = false;
              try {
                await this.commands.sendRpc(tenant, d.assetId, d.method, d.params, {
                  source: 'AUTOMATION',
                  automationRunId: started?.id,
                });
                counters.commandsSent++;
              } catch {
                counters.commandsFailed++;
              }
              break;
            }
            case 'release_booking': {
              try {
                const roomId = ctx.rooms.find((r) => r.room.code === d.room)?.room.id;
                await this.bookings.release(tenant, d.bookingId, d.reason);
                if (roomId) await this.waste.incrementGhost(tenant, roomId, ctx.now);
                counters.released++;
              } catch {
                // already released or cancelled by someone else; the run summary still lists it
              }
              break;
            }
            case 'notify': {
              await this.notifications.create({
                tenantId: tenant.id,
                tenantKey: tenant.key,
                userIds: d.userIds,
                roles: d.roles as never,
                kind: d.notificationKind,
                title: d.title,
                body: d.body,
                subject: d.subject,
                actions: d.actions,
              });
              counters.notified++;
              break;
            }
            default:
              break;
          }
        }
      },
    );

    const summary: Record<string, unknown> = {
      businessTime: ctx.now,
      trigger: opts.trigger,
      ...summarise(decisions),
      ...counters,
      decisions: decisions.slice(0, MAX_STORED_DECISIONS),
      ruleAvailable: Boolean(rule),
      recorded,
    };
    if (typeof summary.actedDay === 'string')
      await this.redis.set(actedDayKey(tenant.key, key), summary.actedDay, 'EX', 3 * 86_400);
    if (key === 'peak_shedding' && summary.shedState !== undefined)
      await this.redis.set(
        shedStateKey(tenant.key),
        JSON.stringify(summary.shedState),
        'EX',
        30 * 86_400,
      );
    const lastCheck: AutomationLastCheck = {
      at: new Date(startedAt).toISOString(),
      businessTime: ctx.now,
      recorded,
    };
    await this.redis.set(
      lastCheckKey(tenant.key, key),
      JSON.stringify(lastCheck),
      'EX',
      LAST_CHECK_TTL_S,
    );
    if (!started) {
      await this.emitRun(tenant.key, key, runId, 'finished', summary);
      return null;
    }
    const finished = await withTenant(this.db, tenant.id, async (tx) => {
      const [r] = await tx
        .update(automationRuns)
        .set({ finishedAt: new Date(this.realNow()), summary })
        .where(eq(automationRuns.id, started.id))
        .returning();
      return r!;
    });
    await this.emitRun(tenant.key, key, runId, 'finished', summary);
    return toRunDto(finished);
  }

  private async emitRun(
    tenantKey: string,
    key: string,
    runId: string,
    status: 'started' | 'finished',
    summary?: Record<string, unknown>,
  ): Promise<void> {
    await this.replay.append(tenantKey, {
      kind: 'automation.run',
      tenantKey,
      ts: this.realNow(),
      automationKey: key,
      runId,
      status,
      ...(summary ? { summary: { ...summary, decisions: undefined } } : {}),
    });
  }
}
