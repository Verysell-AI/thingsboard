import type { DbTx } from '../../db/index.js';
import { auditLog, type NewAuditLog } from '../../db/schema/index.js';
import { getContext } from '../../lib/context.js';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  /** Overrides the tenant from context (provisioning). */
  tenantId?: string;
}

/**
 * Writes one audit row per mutation, taking actor and tenant from the request/job context.
 * Called by services inside their own transaction so the audit row commits with the change.
 */
export class AuditService {
  async record(tx: DbTx, input: AuditInput): Promise<void> {
    const ctx = getContext();
    const tenantId = input.tenantId ?? ctx.tenantId;
    if (!tenantId) throw new Error('AuditService.record: no tenant in context');
    const row: NewAuditLog = {
      tenantId,
      actorType: ctx.automationRunId
        ? 'AUTOMATION'
        : ctx.userId
          ? 'USER'
          : ctx.requestId === 'system'
            ? 'SYSTEM'
            : 'ANONYMOUS',
      actorId: ctx.automationRunId ?? ctx.userId ?? null,
      actorLabel:
        ctx.userEmail ??
        (ctx.automationRunId ? 'automation' : ctx.requestId === 'system' ? 'system' : null),
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      ip: ctx.ip,
      requestId: ctx.requestId,
    };
    await tx.insert(auditLog).values(row);
  }
}
