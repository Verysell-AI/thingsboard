import { and, desc, eq, gte, ilike, like, lte, or, sql, type SQL } from 'drizzle-orm';
import type { AuditFacets, AuditQuery, AuditResponse } from '@platform/shared/dto';
import type { Db } from '../../db/index.js';
import { auditLog, type AuditLogRow } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';

export const AUDIT_EXPORT_LIMIT = 5000;

/** Filter conditions for an audit query. Pure. */
export function auditConditions(query: Omit<AuditQuery, 'page' | 'pageSize'>): SQL[] {
  const conds: SQL[] = [];
  if (query.actor)
    conds.push(
      or(ilike(auditLog.actorLabel, `%${query.actor}%`), eq(auditLog.actorId, query.actor))!,
    );
  if (query.action)
    conds.push(
      query.action.endsWith('.')
        ? like(auditLog.action, `${query.action}%`)
        : eq(auditLog.action, query.action),
    );
  if (query.entityType) conds.push(eq(auditLog.entityType, query.entityType));
  if (query.entityId) conds.push(eq(auditLog.entityId, query.entityId));
  if (query.from) {
    const ms = Date.parse(query.from);
    if (Number.isFinite(ms)) conds.push(gte(auditLog.ts, new Date(ms)));
  }
  if (query.to) {
    const ms = Date.parse(query.to);
    if (Number.isFinite(ms)) conds.push(lte(auditLog.ts, new Date(ms)));
  }
  return conds;
}

export function toAuditDto(a: AuditLogRow): AuditResponse['items'][number] {
  return {
    id: a.id,
    ts: a.ts.toISOString(),
    actorType: a.actorType,
    actorLabel: a.actorLabel,
    actorId: a.actorId,
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    before: a.before ?? null,
    after: a.after ?? null,
    ip: a.ip,
    requestId: a.requestId,
  };
}

/** One CSV cell. Pure. */
export function csvCell(value: unknown): string {
  const s =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Reads the audit log for the audit view: filters, paging, facets and CSV export. */
export class AuditQueryService {
  constructor(private readonly db: Db) {}

  async list(tenantId: string, query: AuditQuery): Promise<AuditResponse> {
    return withTenant(this.db, tenantId, async (tx) => {
      const conds = auditConditions(query);
      const where = conds.length ? and(...conds) : undefined;
      const items = await tx
        .select()
        .from(auditLog)
        .where(where)
        .orderBy(desc(auditLog.ts))
        .limit(query.pageSize)
        .offset(query.page * query.pageSize);
      const [total] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(where);
      return {
        items: items.map(toAuditDto),
        total: total?.total ?? 0,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async facets(tenantId: string): Promise<AuditFacets> {
    return withTenant(this.db, tenantId, async (tx) => {
      const actions = await tx
        .selectDistinct({ v: auditLog.action })
        .from(auditLog)
        .orderBy(auditLog.action);
      const entityTypes = await tx
        .selectDistinct({ v: auditLog.entityType })
        .from(auditLog)
        .orderBy(auditLog.entityType);
      const actors = await tx
        .selectDistinct({ v: auditLog.actorLabel })
        .from(auditLog)
        .orderBy(auditLog.actorLabel);
      return {
        actions: actions.map((r) => r.v),
        entityTypes: entityTypes.map((r) => r.v),
        actors: actors.map((r) => r.v).filter((v): v is string => v !== null),
      };
    });
  }

  /** CSV of the matching rows (newest first, capped). */
  async csv(tenantId: string, query: Omit<AuditQuery, 'page' | 'pageSize'>): Promise<string> {
    const rows = await withTenant(this.db, tenantId, (tx) => {
      const conds = auditConditions(query);
      return tx
        .select()
        .from(auditLog)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(auditLog.ts))
        .limit(AUDIT_EXPORT_LIMIT);
    });
    const header = [
      'ts',
      'actor_type',
      'actor',
      'action',
      'entity_type',
      'entity_id',
      'before',
      'after',
      'ip',
      'request_id',
    ];
    const lines = rows.map((a) =>
      [
        a.ts.toISOString(),
        a.actorType,
        a.actorLabel,
        a.action,
        a.entityType,
        a.entityId,
        a.before,
        a.after,
        a.ip,
        a.requestId,
      ]
        .map(csvCell)
        .join(','),
    );
    return [header.join(','), ...lines].join('\r\n') + '\r\n';
  }
}
