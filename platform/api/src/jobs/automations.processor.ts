import type { Job } from 'bullmq';
import type { Container } from '../container.js';
import { runWithContext } from '../lib/context.js';
import type { TenantRow } from '../db/schema/index.js';
import type { AutomationJob } from './queues.js';

/** The subset of a BullMQ queue the scheduling code needs; tests pass a fake. */
export interface AutomationQueue {
  add(
    name: string,
    data: AutomationJob,
    opts?: {
      jobId?: string;
      delay?: number;
      repeat?: { every: number };
      removeOnComplete?: boolean | number;
      removeOnFail?: boolean | number;
    },
  ): Promise<unknown>;
  getRepeatableJobs?(): Promise<{ key: string; id?: string | null }[]>;
  removeRepeatableByKey?(key: string): Promise<unknown>;
}

/** Shortest real interval between ticks while the business clock runs fast. */
export const MIN_FAST_TICK_MS = 5_000;

/** Real milliseconds until the next tick for a clock speed; the base interval at speed ≤ 1. */
export function tickIntervalMs(speed: number, baseMs: number): number {
  if (!(speed > 1)) return baseMs;
  return Math.max(MIN_FAST_TICK_MS, Math.round(baseMs / speed));
}

export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** Tenants that need a tick: demo tenants, and any tenant with an enabled automation. */
export async function tenantsToSchedule(container: Container): Promise<TenantRow[]> {
  const all = await container.tenants.all();
  const out: TenantRow[] = [];
  for (const t of all) {
    if (t.demoMode) {
      out.push(t);
      continue;
    }
    const list = await container.automations.list(t).catch(() => []);
    if (list.some((a) => a.enabled)) out.push(t);
  }
  return out;
}

/** Registers (or refreshes) the repeatable tick per tenant and drops ticks of tenants that left. */
export async function registerAutomationSchedules(
  queue: AutomationQueue,
  container: Container,
  log: Logger,
): Promise<string[]> {
  const tenants = await tenantsToSchedule(container);
  const every = container.config.AUTOMATION_TICK_SECONDS * 1000;
  const wanted = new Set(tenants.map((t) => `tick:${t.key}`));
  if (queue.getRepeatableJobs && queue.removeRepeatableByKey) {
    for (const job of await queue.getRepeatableJobs()) {
      if (job.id && job.id.startsWith('tick:') && !wanted.has(job.id))
        await queue.removeRepeatableByKey(job.key);
    }
  }
  for (const t of tenants) {
    await queue.add(
      'tick',
      { tenantId: t.id, tenantKey: t.key, kind: 'tick', trigger: 'schedule' },
      { jobId: `tick:${t.key}`, repeat: { every }, removeOnComplete: true, removeOnFail: 20 },
    );
  }
  log.info({ tenants: tenants.map((t) => t.key), everyMs: every }, 'automation ticks scheduled');
  return tenants.map((t) => t.key);
}

/** Enqueues an immediate tick for one tenant (clock change, alarm). */
export async function enqueueTick(
  queue: AutomationQueue,
  tenant: { id: string; key: string },
  trigger: string,
  delayMs = 0,
  realNow: () => number = Date.now,
): Promise<void> {
  const slot = Math.floor((realNow() + delayMs) / 1000);
  await queue.add(
    'tick',
    { tenantId: tenant.id, tenantKey: tenant.key, kind: 'tick', trigger },
    {
      jobId: `${trigger}:${tenant.key}:${slot}`,
      delay: delayMs,
      removeOnComplete: true,
      removeOnFail: 20,
    },
  );
}

/** Enqueues an immediate run of one automation (alarm-triggered peak shedding). */
export async function enqueueRun(
  queue: AutomationQueue,
  tenant: { id: string; key: string },
  automationKey: string,
  trigger: string,
  realNow: () => number = Date.now,
): Promise<void> {
  const slot = Math.floor(realNow() / 1000);
  await queue.add(
    'run',
    { tenantId: tenant.id, tenantKey: tenant.key, kind: 'run', automationKey, trigger },
    {
      jobId: `run:${automationKey}:${tenant.key}:${slot}`,
      removeOnComplete: true,
      removeOnFail: 20,
    },
  );
}

/**
 * Processes one automation job: runs the tenant's tick (or one automation) under the job context,
 * generates the morning report once the business clock passes 07:00, and while the tenant's
 * business clock is faster than real time schedules the next tick sooner.
 */
export async function processAutomationJob(
  container: Container,
  queue: AutomationQueue | null,
  job: Job<AutomationJob>,
  log: Logger,
): Promise<void> {
  const { tenantId, tenantKey, kind, automationKey, trigger } = job.data;
  const tenant = await container.tenants.byId(tenantId);
  if (!tenant) {
    log.warn({ tenantKey }, 'automation job for an unknown tenant; skipped');
    return;
  }
  const engineTenant = {
    id: tenant.id,
    key: tenant.key,
    tariffPerKwh: Number(tenant.tariffPerKwh),
    demoMode: tenant.demoMode,
  };
  await runWithContext(
    { requestId: `job:automations:${job.id}`, tenantId: tenant.id, tenantKey: tenant.key },
    async () => {
      const runs = await container.engine.run(engineTenant, {
        trigger: trigger ?? kind,
        ...(kind === 'run' && automationKey ? { only: automationKey as never, force: false } : {}),
      });
      log.info(
        { tenantKey, trigger: trigger ?? kind, runs: runs.map((r) => r.key) },
        'automation tick processed',
      );
      if (kind === 'tick') {
        const now = await container.clock.now(tenant.key);
        const report = await container.morningReport.dueCheck(tenant, now).catch((err: unknown) => {
          log.error({ err, tenantKey }, 'morning report failed');
          return null;
        });
        if (report) log.info({ tenantKey, period: report.period }, 'morning report generated');
        const nights = await container.standby.nightlyCheck(tenant, now).catch((err: unknown) => {
          log.error({ err, tenantKey }, 'standby night statistics failed');
          return null;
        });
        if (nights !== null) log.info({ tenantKey, devices: nights }, 'night statistics written');
        const monthly = await container.reportsSnapshots
          .dueCheck(tenant, now)
          .catch((err: unknown) => {
            log.error({ err, tenantKey }, 'monthly reports failed');
            return [];
          });
        if (monthly.length)
          log.info({ tenantKey, kinds: monthly.map((r) => r.kind) }, 'monthly reports generated');
      }
    },
  );
  if (queue && kind === 'tick') {
    const state = await container.clock.getState(tenant.key);
    if (state.speed > 1) {
      const delay = tickIntervalMs(state.speed, container.config.AUTOMATION_TICK_SECONDS * 1000);
      await enqueueTick(queue, tenant, 'fast', delay);
    }
  }
}
