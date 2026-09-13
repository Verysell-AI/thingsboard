import { and, count, desc, eq, inArray } from 'drizzle-orm';
import {
  AUTOMATION_KEYS,
  AUTOMATION_PARAMS,
  parseAutomationParams,
  type Automation,
  type AutomationKey,
  type AutomationRun,
  type AutomationRunsResponse,
  type PeakStateResponse,
  type RunAutomation,
  type UpdateAutomation,
} from '@platform/shared/dto';
import type { Db } from '../../db/index.js';
import { automationRuns, automations } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import { badRequest, notFound } from '../../lib/errors.js';
import type { AuditService } from '../audit/audit.service.js';
import type { ClockService } from '../clock/clock.service.js';
import { toRunDto, type AutomationEngine, type EngineTenant } from './engine.js';
import { inWindow } from './rules/peak-shedding.rule.js';

/** Tenant-facing view and control of the automations; the engine does the running. */
export class AutomationsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly engine: AutomationEngine,
    private readonly clock: ClockService,
    private readonly timeZone: string,
  ) {}

  async list(tenant: { id: string; key: string }): Promise<Automation[]> {
    const lastChecks = await this.engine.lastChecks(tenant.key);
    return withTenant(this.db, tenant.id, async (tx) => {
      const rows = await tx
        .select()
        .from(automations)
        .where(inArray(automations.key, [...AUTOMATION_KEYS]))
        .orderBy(automations.key);
      const out: Automation[] = [];
      for (const row of rows) {
        const [last] = await tx
          .select()
          .from(automationRuns)
          .where(eq(automationRuns.key, row.key))
          .orderBy(desc(automationRuns.startedAt))
          .limit(1);
        out.push({
          id: row.id,
          key: row.key as AutomationKey,
          enabled: row.enabled,
          params: row.params,
          lastRun: last ? toRunDto(last) : null,
          lastCheck: lastChecks[row.key as AutomationKey] ?? null,
          updatedAt: row.updatedAt.toISOString(),
        });
      }
      return out;
    });
  }

  async update(
    tenant: { id: string; key: string },
    key: AutomationKey,
    input: UpdateAutomation,
  ): Promise<Automation> {
    let params: Record<string, unknown> | undefined;
    if (input.params !== undefined) {
      const parsed = AUTOMATION_PARAMS[key].safeParse(input.params);
      if (!parsed.success)
        throw badRequest(
          `Invalid parameters: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
        );
      params = parsed.data as Record<string, unknown>;
    }
    await withTenant(this.db, tenant.id, async (tx) => {
      const [existing] = await tx
        .select()
        .from(automations)
        .where(eq(automations.key, key))
        .limit(1);
      if (!existing) throw notFound('Automation not found');
      await tx
        .update(automations)
        .set({
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(params !== undefined ? { params } : {}),
          updatedAt: new Date(),
        })
        .where(eq(automations.id, existing.id));
      await this.audit.record(tx, {
        action: 'automation.update',
        entityType: 'automation',
        entityId: key,
        before: { enabled: existing.enabled, params: existing.params },
        after: { enabled: input.enabled ?? existing.enabled, params: params ?? existing.params },
      });
    });
    const all = await this.list(tenant);
    return all.find((a) => a.key === key)!;
  }

  /** Manual trigger: runs the one automation now, enabled or not. */
  async runNow(
    tenant: EngineTenant,
    key: AutomationKey,
    input: RunAutomation,
  ): Promise<AutomationRun> {
    const exists = await withTenant(
      this.db,
      tenant.id,
      async (tx) =>
        (
          await tx
            .select({ id: automations.id })
            .from(automations)
            .where(eq(automations.key, key))
            .limit(1)
        )[0],
    );
    if (!exists) throw notFound('Automation not found');
    const runs = await this.engine.run(tenant, {
      trigger: 'manual',
      only: key,
      force: true,
      scope: input.scope,
      action: input.action,
    });
    const run = runs[0];
    if (!run) throw notFound('Automation not found');
    return run;
  }

  /** Peak-shedding state with the live building load, for the energy page's shed panel. */
  async peakState(tenant: EngineTenant): Promise<PeakStateResponse> {
    const row = await withTenant(
      this.db,
      tenant.id,
      async (tx) =>
        (
          await tx.select().from(automations).where(eq(automations.key, 'peak_shedding')).limit(1)
        )[0],
    );
    const params = parseAutomationParams('peak_shedding', row?.params);
    const now = await this.clock.now(tenant.key);
    return {
      state: await this.engine.shedState(tenant.key),
      thresholdKw: params.thresholdKw,
      window: params.window,
      buildingKw: await this.engine.buildingKw(tenant.key),
      inWindow: inWindow(now, this.timeZone, params.window),
      enabled: row?.enabled ?? false,
    };
  }

  async runs(
    tenantId: string,
    query: { key?: AutomationKey; page: number; pageSize: number },
  ): Promise<AutomationRunsResponse> {
    return withTenant(this.db, tenantId, async (tx) => {
      const where = query.key ? and(eq(automationRuns.key, query.key)) : undefined;
      const items = await tx
        .select()
        .from(automationRuns)
        .where(where)
        .orderBy(desc(automationRuns.startedAt))
        .limit(query.pageSize)
        .offset(query.page * query.pageSize);
      const [total] = await tx.select({ total: count() }).from(automationRuns).where(where);
      return {
        items: items.map(toRunDto),
        total: Number(total?.total ?? 0),
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }
}
