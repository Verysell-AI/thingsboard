import { sql } from 'drizzle-orm';
import type { Db, DbTx } from './index.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` in a transaction whose row-level-security context is the given tenant.
 * `SET LOCAL` is transaction-scoped, so pooled connections never leak the setting.
 */
export async function withTenant<T>(
  db: Db,
  tenantId: string,
  fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(tenantId)) throw new Error(`withTenant: invalid tenant id ${tenantId}`);
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${tenantId}'`));
    return fn(tx);
  });
}

/**
 * Cross-tenant access on the BYPASSRLS role. Only provisioning, background jobs and the
 * ThingsBoard event ingress (which has no tenant until it maps the device) may use it.
 */
export async function withoutTenant<T>(admin: Db, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  return admin.transaction(async (tx) => fn(tx));
}
