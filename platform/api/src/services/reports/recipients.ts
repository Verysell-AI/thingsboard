import { eq } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { users } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';

/** Who receives operational reports: the operations managers, or the tenant admins when there are none. */
export async function operationsRecipients(db: Db, tenantId: string): Promise<string[]> {
  return withTenant(db, tenantId, async (tx) => {
    const ops = await tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.role, 'OPS_MANAGER'));
    if (ops.length) return ops.map((u) => u.email);
    const admins = await tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.role, 'TENANT_ADMIN'));
    return admins.map((u) => u.email);
  });
}
