import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import type { Role } from '@platform/shared/roles';
import type { Db, DbTx } from '../../db/index.js';
import { users, type UserRow } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import type { AuditService } from '../audit/audit.service.js';

export interface CreateUserInput {
  email: string;
  password: string;
  role: Role;
  displayName: string;
  employeeId?: string | null;
}

export class UsersService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  static hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  async byEmail(tenantId: string, email: string): Promise<UserRow | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);
      return rows[0] ?? null;
    });
  }

  async byId(tenantId: string, id: string): Promise<UserRow | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(users).where(eq(users.id, id)).limit(1);
      return rows[0] ?? null;
    });
  }

  /** Creates or updates a user inside an existing tenant transaction (used by the dataset loader). */
  async upsertInTx(tx: DbTx, tenantId: string, input: CreateUserInput): Promise<UserRow> {
    const email = input.email.toLowerCase();
    const existing = (await tx.select().from(users).where(eq(users.email, email)).limit(1))[0];
    const passwordHash = await UsersService.hashPassword(input.password);
    if (existing) {
      const [row] = await tx
        .update(users)
        .set({
          passwordHash,
          role: input.role,
          displayName: input.displayName,
          employeeId: input.employeeId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id))
        .returning();
      await this.audit.record(tx, {
        tenantId,
        action: 'user.update',
        entityType: 'user',
        entityId: existing.id,
        before: { role: existing.role },
        after: { role: input.role },
      });
      return row!;
    }
    const [row] = await tx
      .insert(users)
      .values({
        tenantId,
        email,
        passwordHash,
        role: input.role,
        displayName: input.displayName,
        employeeId: input.employeeId ?? null,
      })
      .returning();
    await this.audit.record(tx, {
      tenantId,
      action: 'user.create',
      entityType: 'user',
      entityId: row!.id,
      after: { email, role: input.role },
    });
    return row!;
  }
}
