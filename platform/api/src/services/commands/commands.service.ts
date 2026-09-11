import { eq } from 'drizzle-orm';
import { RPC_SUPPORT, RpcRequestSchema, type RpcMethod } from '@platform/shared/contracts';
import type { Db } from '../../db/index.js';
import { assets, commands, type CommandRow } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { getContext } from '../../lib/context.js';
import type { AuditService } from '../audit/audit.service.js';
import type { TbClient } from '../tb/tb.client.js';
import { asUpstreamError } from '../tb/tb.client.js';

export interface CommandActor {
  source: 'USER' | 'AUTOMATION' | 'SYSTEM';
  actorUserId?: string | null;
  automationRunId?: string | null;
}

export interface TbForTenant {
  forTenant(tenantKey: string): Pick<TbClient, 'rpcOneway'>;
}

/**
 * The single path for device commands: validates the RPC against the device type, sends it to
 * ThingsBoard as a one-way RPC, records a Command row and an audit row.
 */
export class CommandsService {
  constructor(
    private readonly db: Db,
    private readonly tb: TbForTenant,
    private readonly audit: AuditService,
  ) {}

  async sendRpc(
    tenant: { id: string; key: string },
    assetId: string,
    method: RpcMethod | string,
    params: unknown,
    actor: CommandActor,
  ): Promise<CommandRow> {
    const parsed = RpcRequestSchema.safeParse({ method, params });
    if (!parsed.success)
      throw badRequest(`Invalid RPC: ${parsed.error.issues.map((i) => i.message).join(', ')}`);
    const rpc = parsed.data;

    const asset = await withTenant(this.db, tenant.id, async (tx) => {
      const rows = await tx.select().from(assets).where(eq(assets.id, assetId)).limit(1);
      return rows[0] ?? null;
    });
    if (!asset) throw notFound('Asset not found');
    if (!asset.tbDeviceId || !asset.deviceType)
      throw badRequest('Asset has no controllable device');
    if (!RPC_SUPPORT[rpc.method].includes(asset.deviceType)) {
      throw badRequest(`Device type ${asset.deviceType} does not support ${rpc.method}`);
    }

    let result = 'SENT';
    let error: string | null = null;
    try {
      await this.tb.forTenant(tenant.key).rpcOneway(asset.tbDeviceId, rpc.method, rpc.params);
    } catch (err) {
      result = 'FAILED';
      error = err instanceof Error ? err.message : String(err);
    }

    const row = await withTenant(this.db, tenant.id, async (tx) => {
      const [inserted] = await tx
        .insert(commands)
        .values({
          tenantId: tenant.id,
          assetId: asset.id,
          method: rpc.method,
          params: rpc.params,
          source: actor.source,
          actorUserId: actor.actorUserId ?? getContext().userId ?? null,
          automationRunId: actor.automationRunId ?? getContext().automationRunId ?? null,
          result,
          error,
        })
        .returning();
      await this.audit.record(tx, {
        tenantId: tenant.id,
        action: `command.${rpc.method}`,
        entityType: 'asset',
        entityId: asset.id,
        before: { code: asset.code },
        after: { method: rpc.method, params: rpc.params, result, error },
      });
      return inserted!;
    });
    if (result === 'FAILED') throw asUpstreamError(new Error(error ?? 'rpc failed'), 'RPC');
    return row;
  }
}
