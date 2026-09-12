import { and, eq, ne } from 'drizzle-orm';
import type {
  AdminJob,
  AdminTenant,
  AdminUser,
  CreateAdminUserRequest,
  CreateTenantRequest,
  UpdateAdminUserRequest,
  UpdateTenantRequest,
} from '@platform/shared/dto';
import type { Container } from '../../container.js';
import { tenants, users, type TenantRow, type UserRow } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { listDatasets } from '../../cli/dataset-files.js';
import { loadDatasetIntoTenant } from '../../cli/dataset.js';
import { applyBrandInput, provision, type TenantSettings } from '../../cli/provision.js';
import { UsersService } from '../users/users.service.js';

/** Absolute URL of a tenant's web app, on the port the console itself was reached on. */
export function tenantUrl(hostname: string, origin: string | null): string {
  if (!origin) return `http://${hostname}`;
  try {
    const url = new URL(origin);
    return `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ''}`;
  } catch {
    return `http://${hostname}`;
  }
}

export function toAdminTenant(
  tenant: TenantRow,
  userCount: number,
  origin: string | null,
): AdminTenant {
  const b = tenant.brand;
  return {
    id: tenant.id,
    key: tenant.key,
    name: tenant.name,
    hostname: tenant.hostname,
    locale: tenant.locale === 'ar' ? 'ar' : 'en',
    currency: tenant.currency,
    tariffPerKwh: Number(tenant.tariffPerKwh),
    demoMode: tenant.demoMode,
    simulated: tenant.simulated,
    tbTenantId: tenant.tbTenantId,
    primaryColor: b.primaryColor,
    accentColor: b.accentColor,
    shortName: b.shortName,
    fontFamily: b.fontFamily,
    loginTagline: b.loginTagline ?? null,
    logoUrl: `${tenantUrl(tenant.hostname, origin)}/api/branding/logo`,
    faviconUrl: `${tenantUrl(tenant.hostname, origin)}/api/branding/favicon`,
    userCount,
    createdAt: tenant.createdAt.toISOString(),
    url: tenantUrl(tenant.hostname, origin),
  };
}

function toAdminUser(row: UserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    displayName: row.displayName,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Everything the platform console does to tenants. Tenant rows have no row-level security, so
 * they are read on the app role; anything inside a tenant runs in that tenant's RLS context.
 */
export class AdminTenantsService {
  /** The container is passed lazily because provisioning needs the very container this lives in. */
  constructor(private readonly deps: () => Container) {}

  private get c(): Container {
    return this.deps();
  }

  async list(): Promise<{ tenant: TenantRow; userCount: number }[]> {
    const rows = await this.c.tenants.all();
    rows.sort((a, b) => a.key.localeCompare(b.key));
    return Promise.all(
      rows.map(async (tenant) => ({ tenant, userCount: await this.countUsers(tenant.id) })),
    );
  }

  async get(key: string): Promise<{ tenant: TenantRow; userCount: number }> {
    const tenant = await this.require(key);
    return { tenant, userCount: await this.countUsers(tenant.id) };
  }

  async datasets(): Promise<string[]> {
    return listDatasets(this.c.config.DATASETS_DIR);
  }

  /** Provisions in the background: ThingsBoard tenant, brand, the first user and an optional dataset. */
  async create(input: CreateTenantRequest): Promise<AdminJob> {
    const { key } = input;
    if (await this.c.tenants.byKey(key)) throw conflict(`tenant ${key} already exists`);
    const hostname = input.hostname ?? `${key}.${this.c.config.PLATFORM_HOST}`;
    await this.assertHostnameFree(hostname, null);
    const settings: Partial<TenantSettings> = {
      name: input.name,
      hostname,
      locale: input.locale,
      currency: input.currency,
      tariffPerKwh: input.tariffPerKwh,
      demoMode: input.demoMode,
      simulated: input.simulated ?? Boolean(input.dataset),
    };
    const dataset = input.dataset ?? undefined;
    return this.c.adminJobs.start('tenant.create', key, async (log) => {
      await provision(this.c, { tenant: key, dataset, settings, brand: input.brand, log });
      if (input.admin) {
        const tenant = await this.require(key);
        await this.createUser(tenant.key, {
          email: input.admin.email,
          password: input.admin.password,
          role: 'TENANT_ADMIN',
          displayName: input.admin.displayName ?? input.admin.email.split('@')[0]!,
        });
        log(`user ${input.admin.email} created`);
      }
      if (dataset) await loadDatasetIntoTenant(this.c, { tenant: key, dataset, log });
      await this.syncSimulator(key, log);
    });
  }

  /** Loads a dataset into an existing tenant. */
  async loadDataset(key: string, dataset: string): Promise<AdminJob> {
    await this.require(key);
    return this.c.adminJobs.start('tenant.dataset', key, async (log) => {
      await loadDatasetIntoTenant(this.c, { tenant: key, dataset, log });
      await this.syncSimulator(key, log);
    });
  }

  /**
   * Brings the simulator in line with the tenant's `simulated` flag. The simulator also polls the
   * list, so a push that fails (simulator down, restarting) is logged and picked up later.
   */
  private async syncSimulator(key: string, log: (msg: string) => void = () => undefined) {
    const tenant = await this.c.tenants.byKey(key);
    try {
      if (tenant?.simulated) {
        const r = await this.c.console.syncTenant(key);
        log(`simulator drives ${r.devices} virtual devices`);
      } else {
        await this.c.console.removeTenant(key);
        log('simulator stopped driving this tenant');
      }
    } catch (err) {
      log(
        `simulator not updated (${err instanceof Error ? err.message : String(err)}); it re-syncs on its own`,
      );
    }
  }

  async update(key: string, input: UpdateTenantRequest): Promise<TenantRow> {
    const tenant = await this.require(key);
    if (input.hostname && input.hostname !== tenant.hostname)
      await this.assertHostnameFree(input.hostname, tenant.id);
    const brand = applyBrandInput(tenant.brand, input.brand);
    if (input.name && input.brand?.name === undefined) brand.name = input.name;
    const [row] = await this.c.db.app
      .update(tenants)
      .set({
        name: input.name ?? tenant.name,
        hostname: input.hostname ?? tenant.hostname,
        locale: input.locale ?? tenant.locale,
        currency: input.currency ?? tenant.currency,
        tariffPerKwh: String(input.tariffPerKwh ?? tenant.tariffPerKwh),
        demoMode: input.demoMode ?? tenant.demoMode,
        simulated: input.simulated ?? tenant.simulated,
        brand,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenant.id))
      .returning();
    if (input.name && input.name !== tenant.name && tenant.tbTenantId) {
      await this.c.tb.sysadmin().renameTenant(tenant.tbTenantId, input.name);
    }
    this.c.tenantResolver.invalidate();
    if (input.simulated !== undefined && input.simulated !== tenant.simulated) {
      await this.syncSimulator(key);
    }
    return row!;
  }

  /** Removes the tenant everywhere: ThingsBoard first, then the row (its data cascades). */
  async remove(key: string): Promise<AdminJob> {
    const tenant = await this.require(key);
    return this.c.adminJobs.start('tenant.delete', key, async (log) => {
      if (tenant.tbTenantId) {
        // Belt and braces: never delete a core tenant another platform tenant still points at.
        const sharedWith = (await this.c.tenants.all()).filter(
          (t) => t.id !== tenant.id && t.tbTenantId === tenant.tbTenantId,
        );
        if (sharedWith.length) {
          log(`ThingsBoard tenant kept: also used by ${sharedWith.map((t) => t.key).join(', ')}`);
        } else {
          await this.c.tb.sysadmin().deleteTenant(tenant.tbTenantId);
          log('ThingsBoard tenant deleted');
        }
      }
      this.c.tb.forget(key);
      await this.c.db.app.delete(tenants).where(eq(tenants.id, tenant.id));
      this.c.tenantResolver.invalidate();
      log(`tenant row ${key} deleted`);
      await this.syncSimulator(key, log);
    });
  }

  async users(key: string): Promise<AdminUser[]> {
    const tenant = await this.require(key);
    const rows = await withTenant(this.c.db.app, tenant.id, (tx) => tx.select().from(users));
    return rows.sort((a, b) => a.email.localeCompare(b.email)).map(toAdminUser);
  }

  async createUser(key: string, input: CreateAdminUserRequest): Promise<AdminUser> {
    const tenant = await this.require(key);
    const email = input.email.toLowerCase();
    const row = await withTenant(this.c.db.app, tenant.id, async (tx) => {
      const taken = (await tx.select().from(users).where(eq(users.email, email)).limit(1))[0];
      if (taken) throw conflict(`user ${email} already exists in ${key}`);
      return this.c.users.upsertInTx(tx, tenant.id, {
        email,
        password: input.password,
        role: input.role,
        displayName: input.displayName ?? email.split('@')[0]!,
      });
    });
    return toAdminUser(row);
  }

  async updateUser(key: string, id: string, input: UpdateAdminUserRequest): Promise<AdminUser> {
    const tenant = await this.require(key);
    const row = await withTenant(this.c.db.app, tenant.id, async (tx) => {
      const existing = (await tx.select().from(users).where(eq(users.id, id)).limit(1))[0];
      if (!existing) throw notFound(`user ${id} not found in ${key}`);
      const [updated] = await tx
        .update(users)
        .set({
          role: input.role ?? existing.role,
          displayName: input.displayName ?? existing.displayName,
          ...(input.password
            ? { passwordHash: await UsersService.hashPassword(input.password) }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning();
      await this.c.audit.record(tx, {
        tenantId: tenant.id,
        action: 'user.update',
        entityType: 'user',
        entityId: id,
        before: { role: existing.role },
        after: { role: updated!.role },
      });
      return updated!;
    });
    return toAdminUser(row);
  }

  async removeUser(key: string, id: string): Promise<void> {
    const tenant = await this.require(key);
    await withTenant(this.c.db.app, tenant.id, async (tx) => {
      const existing = (await tx.select().from(users).where(eq(users.id, id)).limit(1))[0];
      if (!existing) throw notFound(`user ${id} not found in ${key}`);
      await tx.delete(users).where(eq(users.id, id));
      await this.c.audit.record(tx, {
        tenantId: tenant.id,
        action: 'user.delete',
        entityType: 'user',
        entityId: id,
        before: { email: existing.email, role: existing.role },
      });
    });
  }

  private async require(key: string): Promise<TenantRow> {
    const tenant = await this.c.tenants.byKey(key);
    if (!tenant) throw notFound(`tenant ${key} not found`);
    return tenant;
  }

  private async countUsers(tenantId: string): Promise<number> {
    const rows = await withTenant(this.c.db.app, tenantId, (tx) =>
      tx.select({ id: users.id }).from(users),
    );
    return rows.length;
  }

  private async assertHostnameFree(hostname: string, exceptId: string | null): Promise<void> {
    if (!/^[a-z0-9.-]+$/.test(hostname)) throw badRequest(`invalid hostname ${hostname}`);
    const clash = await this.c.db.app
      .select({ id: tenants.id })
      .from(tenants)
      .where(
        exceptId
          ? and(eq(tenants.hostname, hostname), ne(tenants.id, exceptId))
          : eq(tenants.hostname, hostname),
      )
      .limit(1);
    if (clash.length) throw conflict(`hostname ${hostname} is already used`);
  }
}
