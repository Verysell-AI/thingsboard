import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { Dispatcher } from 'undici';
import type { Config } from './config.js';
import { createDb, type Db, type DbHandles } from './db/index.js';
import { DbDeviceResolver } from './db/device-lookup.js';
import type { RedisLike } from './lib/redis.js';
import { AdminJobsService } from './services/admin/admin-jobs.service.js';
import { AdminTenantsService } from './services/admin/admin-tenants.service.js';
import { PlatformAdminsService } from './services/admin/platform-admins.service.js';
import { AuditService } from './services/audit/audit.service.js';
import { AssetsService } from './services/assets/assets.service.js';
import { MisplacedService } from './services/assets/misplaced.service.js';
import { AutomationEngine } from './services/automations/engine.js';
import { AutomationsService } from './services/automations/automations.service.js';
import { enqueueRun, enqueueTick, type AutomationQueue } from './jobs/automations.processor.js';
import { HoldsService } from './services/holds/holds.service.js';
import { MaintenanceService } from './services/maintenance/maintenance.service.js';
import { AllocationService } from './services/energy/allocation.service.js';
import { StandbyService } from './services/energy/standby.service.js';
import { AcHealthService } from './services/energy/ac-health.service.js';
import { FleetService } from './services/assets/fleet.service.js';
import { DepreciationService } from './services/assets/depreciation.service.js';
import { UtilisationService } from './services/rooms/utilisation.service.js';
import { SavingsService } from './services/reports/savings.service.js';
import { ReportsService } from './services/reports/reports.service.js';
import { PdfService } from './services/reports/pdf.service.js';
import { AuditQueryService } from './services/audit/audit-query.service.js';
import { RecordingMailer, SmtpMailer, type Mailer } from './services/reports/mail.service.js';
import { MorningReportService } from './services/reports/morning-report.service.js';
import { QUEUES, connectionFromUrl } from './jobs/queues.js';
import { PresenceService } from './services/rooms/presence.service.js';
import { WasteService } from './services/rooms/waste.service.js';
import { AuthService, type TokenSigner } from './services/auth/auth.service.js';
import { BookingsService } from './services/bookings/bookings.service.js';
import { ClockService } from './services/clock/clock.service.js';
import { EmployeesService } from './services/employees/employees.service.js';
import { EnergyService } from './services/energy/energy.service.js';
import { HistoryService } from './services/energy/history.service.js';
import { NotificationsService } from './services/notifications/notifications.service.js';
import { RoomsService } from './services/rooms/rooms.service.js';
import { NotifyingEventHooks } from './services/tb/event-hooks.js';
import { CommandsService } from './services/commands/commands.service.js';
import { ConsoleService } from './services/console/console.service.js';
import { LiveStateService } from './services/live/live-state.service.js';
import { ReplayService } from './services/live/replay.service.js';
import { LocationsService } from './services/locations/locations.service.js';
import { TbClientRegistry } from './services/tb/tb-registry.js';
import { TbEventsService, type DeviceResolver } from './services/tb/tb-events.service.js';
import { TenantResolver } from './services/tenants/tenant-resolver.js';
import { TenantsService } from './services/tenants/tenants.service.js';
import { UsersService } from './services/users/users.service.js';

export interface ContainerDeps {
  db?: DbHandles;
  /** Command client; pub/sub duplicates are derived from it unless given. */
  redis?: RedisLike & { duplicate?(): Redis };
  redisPub?: Redis;
  redisSub?: Redis;
  tb?: TbClientRegistry;
  deviceResolver?: DeviceResolver;
  signer?: TokenSigner;
  dispatcher?: Dispatcher;
  /** Producer for automation jobs; `null` disables scheduling side effects (tests). */
  automationQueue?: AutomationQueue | null;
  /** Outbound mail; tests pass a RecordingMailer. */
  mailer?: Mailer;
}

export interface Container {
  config: Config;
  db: DbHandles;
  redis: RedisLike;
  redisPub: Redis | null;
  redisSub: Redis | null;
  tb: TbClientRegistry;
  audit: AuditService;
  tenants: TenantsService;
  tenantResolver: TenantResolver;
  users: UsersService;
  /** Set once the auth plugin provides the signer (HTTP only); worker and CLI leave it null. */
  auth: AuthService | null;
  /** Platform operators behind the /admin console. */
  platformAdmins: PlatformAdminsService;
  adminTenants: AdminTenantsService;
  adminJobs: AdminJobsService;
  commands: CommandsService;
  liveState: LiveStateService;
  replay: ReplayService;
  tbEvents: TbEventsService;
  deviceResolver: DeviceResolver;
  console: ConsoleService;
  clock: ClockService;
  locations: LocationsService;
  history: HistoryService;
  assets: AssetsService;
  employees: EmployeesService;
  bookings: BookingsService;
  rooms: RoomsService;
  notifications: NotificationsService;
  energy: EnergyService;
  presence: PresenceService;
  waste: WasteService;
  misplaced: MisplacedService;
  engine: AutomationEngine;
  automations: AutomationsService;
  holds: HoldsService;
  mailer: Mailer;
  morningReport: MorningReportService;
  maintenance: MaintenanceService;
  allocation: AllocationService;
  standby: StandbyService;
  acHealth: AcHealthService;
  fleet: FleetService;
  depreciation: DepreciationService;
  utilisation: UtilisationService;
  savings: SavingsService;
  /** Monthly report snapshots (energy cost, savings, asset financials). */
  reportsSnapshots: ReportsService;
  pdf: PdfService;
  auditQuery: AuditQueryService;
  /** Lazily created BullMQ producer for automation ticks (API process); null in tests. */
  automationQueue: () => AutomationQueue | null;
  withSigner(signer: TokenSigner): AuthService;
  close(): Promise<void>;
}

/** Builds every service once with explicit dependencies; no DI framework. */
export function buildContainer(config: Config, deps: ContainerDeps = {}): Container {
  const db = deps.db ?? createDb(config.DATABASE_URL, config.DATABASE_ADMIN_URL);
  const ownRedis = !deps.redis;
  const redis: RedisLike =
    deps.redis ?? new Redis(config.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 3 });
  const redisPub = deps.redisPub ?? (redis instanceof Redis ? redis.duplicate() : null);
  // A subscriber-mode connection cannot answer the INFO ready check ioredis runs on reconnect; with
  // the check on, the connection errors, drops and never delivers events again.
  const redisSub =
    deps.redisSub ?? (redis instanceof Redis ? redis.duplicate({ enableReadyCheck: false }) : null);
  redisSub?.on('error', () => undefined);
  const tb = deps.tb ?? new TbClientRegistry(config, deps.dispatcher);

  const audit = new AuditService();
  const tenants = new TenantsService(db.app);
  const platformAdminsSvc = new PlatformAdminsService(db.app, ttl(config));
  if (deps.signer) platformAdminsSvc.useSigner(deps.signer);
  const tenantResolver = new TenantResolver(tenants);
  const users = new UsersService(db.app, audit);
  const commands = new CommandsService(db.app, tb, audit);
  const liveState = new LiveStateService(redis);
  const replay = new ReplayService(redis);
  const deviceResolver = deps.deviceResolver ?? new DbDeviceResolver(db.admin);
  const tbEvents = new TbEventsService(deviceResolver, liveState, replay);
  const consoleSvc = new ConsoleService(
    config.SIMULATOR_URL,
    config.INTERNAL_API_TOKEN,
    deps.dispatcher,
  );
  const clock = new ClockService(redis, replay, consoleSvc, config.TIME_ZONE);
  const locations = new LocationsService(db.app);
  const history = new HistoryService(tb, redis);
  const assetsSvc = new AssetsService(db.app, audit, clock, commands, history);
  const employeesSvc = new EmployeesService(
    db.app,
    audit,
    clock,
    tb,
    consoleSvc,
    config.TENANT_DOMAIN,
  );
  const bookings = new BookingsService(db.app, audit, clock, config.TIME_ZONE);
  const notifications = new NotificationsService(db.app, audit, replay);
  bookings.setNotifications(notifications);
  const presence = new PresenceService(db.app, redis, liveState, replay, clock);
  const waste = new WasteService(db.app, redis, config.TIME_ZONE);
  const rooms = new RoomsService(
    db.app,
    clock,
    liveState,
    bookings,
    history,
    config.TIME_ZONE,
    presence,
    waste,
  );
  const energy = new EnergyService(db.app, clock, liveState, history, redis, config.TIME_ZONE);
  energy.setWaste(waste);
  const misplaced = new MisplacedService(
    db.app,
    redis,
    audit,
    presence,
    notifications,
    config.MISPLACED_HOURS,
  );
  const engine = new AutomationEngine(
    db.app,
    redis,
    clock,
    liveState,
    presence,
    waste,
    misplaced,
    bookings,
    commands,
    notifications,
    replay,
    config.TIME_ZONE,
  );
  const automationsSvc = new AutomationsService(db.app, audit, engine, clock, config.TIME_ZONE);
  const holdsSvc = new HoldsService(db.app, audit, clock);
  const mailer =
    deps.mailer ??
    (config.NODE_ENV === 'test'
      ? new RecordingMailer()
      : new SmtpMailer(config.SMTP_URL, config.MAIL_FROM));
  const maintenance = new MaintenanceService(db.app, audit);
  const allocation = new AllocationService(db.app, config.TIME_ZONE);
  const standby = new StandbyService(db.app, audit, history, config.TIME_ZONE);
  const acHealth = new AcHealthService(db.app, history, liveState, maintenance);
  const fleet = new FleetService(db.app, history, liveState);
  const depreciation = new DepreciationService(db.app, config.TIME_ZONE);
  const utilisation = new UtilisationService(db.app, config.TIME_ZONE);
  const savings = new SavingsService(db.app, history, config.TIME_ZONE);
  const morningReport = new MorningReportService(
    db.app,
    audit,
    clock,
    liveState,
    mailer,
    config.TIME_ZONE,
    Date.now,
    savings,
  );
  const pdf = new PdfService();
  const auditQuery = new AuditQueryService(db.app);
  const reportsSnapshots = new ReportsService(
    db.app,
    audit,
    clock,
    allocation,
    savings,
    depreciation,
    config.TIME_ZONE,
    Date.now,
    mailer,
    pdf,
  );

  let queue: AutomationQueue | null | undefined = deps.automationQueue;
  const automationQueue = (): AutomationQueue | null => {
    if (queue === undefined) {
      queue =
        config.NODE_ENV === 'test'
          ? null
          : (new Queue(QUEUES.automations, {
              connection: connectionFromUrl(config.REDIS_URL),
            }) as unknown as AutomationQueue);
    }
    return queue;
  };
  // a moved clock is acted on at once: the worker runs an immediate tick for the tenant
  clock.onChange(async (tenantKey) => {
    const q = automationQueue();
    const tenant = await tenants.byKey(tenantKey);
    if (q && tenant) await enqueueTick(q, tenant, 'clock');
  });
  // ThingsBoard events: notifications, presence, and a peak-load alarm runs shedding at once
  tbEvents.setHooks(
    new NotifyingEventHooks(notifications, presence, liveState, {
      onPeakAlarm: async (tenant) => {
        const q = automationQueue();
        if (q) await enqueueRun(q, tenant, 'peak_shedding', 'alarm');
      },
      // an AC current alarm opens a filter check on the unit; clearing it leaves a note
      onAcAlarm: async (tenant, device, status, alarmId) => {
        if (status === 'created') {
          const r = await maintenance.openFromAlarm(tenant, {
            assetId: device.assetId,
            title: `Check filter: ${device.deviceCode}`,
            cause: `AC current high${device.room ? ` in ${device.room}` : ''}: current above 125 % of nominal for 10 minutes at constant output`,
            alarmId,
          });
          return { taskId: r.task.id, created: r.created };
        }
        await maintenance.noteOnOpenTask(
          tenant,
          device.assetId,
          'Alarm cleared: current back under 110 % of nominal. Check the filter before closing.',
        );
        return null;
      },
    }),
  );
  // late-worker notification actions: "Still working" holds the zone, "Leaving now" sweeps it
  const zoneOf = (subject: string | null) =>
    subject?.startsWith('sweep:') ? subject.slice('sweep:'.length) : null;
  notifications.registerAction('sweep.late_worker', 'snooze', async ({ tenant, notification }) => {
    const zone = zoneOf(notification.subject);
    if (!zone) return;
    const now = await clock.now(tenant.key);
    await holdsSvc.create(tenant, {
      scopeType: 'ZONE',
      scopeId: zone,
      until: new Date(now + 60 * 60_000).toISOString(),
      reason: 'Still working',
    });
  });
  notifications.registerAction(
    'sweep.late_worker',
    'leave',
    async ({ tenant, userId, notification }) => {
      const zone = zoneOf(notification.subject);
      const row = await tenants.byId(tenant.id);
      if (!zone || !row) return;
      for (const h of await holdsSvc.list(tenant))
        if (h.scopeType === 'ZONE' && h.scopeId === zone) await holdsSvc.delete(tenant, h.id);
      await engine.run(
        {
          id: row.id,
          key: row.key,
          tariffPerKwh: Number(row.tariffPerKwh),
          demoMode: row.demoMode,
        },
        {
          trigger: 'leave',
          only: 'evening_sweep',
          force: true,
          scope: { zone },
          excludeUserIds: [userId],
        },
      );
    },
  );

  const container: Container = {
    config,
    db,
    redis,
    redisPub,
    redisSub,
    tb,
    audit,
    tenants,
    tenantResolver,
    users,
    auth: deps.signer ? new AuthService(db.app, users, audit, deps.signer, ttl(config)) : null,
    platformAdmins: platformAdminsSvc,
    adminTenants: new AdminTenantsService(() => container),
    adminJobs: new AdminJobsService(redis),
    commands,
    liveState,
    replay,
    tbEvents,
    deviceResolver,
    console: consoleSvc,
    clock,
    locations,
    history,
    assets: assetsSvc,
    employees: employeesSvc,
    bookings,
    rooms,
    notifications,
    energy,
    presence,
    waste,
    misplaced,
    engine,
    automations: automationsSvc,
    holds: holdsSvc,
    mailer,
    morningReport,
    maintenance,
    allocation,
    standby,
    acHealth,
    fleet,
    depreciation,
    utilisation,
    savings,
    reportsSnapshots,
    pdf,
    auditQuery,
    automationQueue,
    withSigner(signer) {
      container.auth = new AuthService(db.app, users, audit, signer, ttl(config));
      platformAdminsSvc.useSigner(signer);
      return container.auth;
    },
    async close() {
      const q = queue as { close?: () => Promise<void> } | null | undefined;
      if (q && !deps.automationQueue && typeof q.close === 'function') await q.close();
      if (ownRedis && redis instanceof Redis) redis.disconnect();
      redisPub?.disconnect();
      redisSub?.disconnect();
      if (!deps.db) await db.close();
    },
  };
  return container;
}

function ttl(config: Config) {
  return { access: config.JWT_ACCESS_TTL, refresh: config.JWT_REFRESH_TTL };
}

export type { Db };
