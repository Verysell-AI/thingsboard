import { eq } from 'drizzle-orm';
import type { BrandInput } from '@platform/shared/dto';
import type { Locale } from '@platform/shared/dataset';
import type { Config } from '../config.js';
import type { Container } from '../container.js';
import { tenants, type TenantBrand, type TenantRow } from '../db/schema/index.js';
import { withoutTenant } from '../db/tenant.js';
import { TbClient, TbError, type TbUser } from '../services/tb/tb.client.js';
import { defaultBrand } from '../services/tenants/tenants.service.js';
import { loadDataset, type LoadedDataset } from './dataset-files.js';
import { importTbArtefacts } from './tb-import.js';

/** Tenant fields an operator may set; a dataset overrides them where it defines its own. */
export interface TenantSettings {
  name: string;
  hostname: string;
  locale: Locale;
  currency: string;
  tariffPerKwh: number;
  demoMode: boolean;
}

export interface ProvisionOptions {
  tenant: string;
  dataset?: string;
  demo?: boolean;
  /** Overrides for a tenant provisioned without a dataset (admin console). */
  settings?: Partial<TenantSettings>;
  /** Brand fields applied on top of the dataset, existing or default brand. */
  brand?: BrandInput;
  log?: (msg: string) => void;
}

export interface ProvisionResult {
  tenant: TenantRow;
  tbTenantId: string;
  users: string[];
  deviceProfiles: number;
  assetProfiles: number;
  ruleChain: string | null;
  dashboards: number;
  elapsedMs: number;
}

/** Logs in as sysadmin, changing the factory password to the configured one on first contact. */
export async function sysadminClient(
  container: Container,
  config: Config,
  log: (m: string) => void,
): Promise<TbClient> {
  const configured = container.tb.sysadmin();
  try {
    await configured.tokens();
    return configured;
  } catch (err) {
    if (!(err instanceof TbError) || err.status !== 401) throw err;
  }
  log('sysadmin password is still the factory default; changing it');
  const factory = new TbClient({
    baseUrl: config.TB_URL,
    email: config.TB_SYSADMIN_EMAIL,
    password: 'sysadmin',
  });
  await factory.changePassword('sysadmin', config.TB_SYSADMIN_PASSWORD);
  return factory;
}

function activationTokenFrom(link: string): string {
  const m = /activateToken=([^&\s"]+)/.exec(link);
  if (!m?.[1]) throw new Error(`unexpected activation link: ${link}`);
  return m[1];
}

async function ensureTenantAdmin(
  sys: TbClient,
  tbTenantId: string,
  email: string,
  password: string,
  firstName: string,
  log: (m: string) => void,
): Promise<void> {
  const existing = await sys.findTenantAdminByEmail(tbTenantId, email);
  if (existing) {
    log(`user ${email} exists`);
    return;
  }
  const user: TbUser = {
    email,
    authority: 'TENANT_ADMIN',
    firstName,
    lastName: 'Service',
    tenantId: { id: tbTenantId, entityType: 'TENANT' },
  };
  const created = await sys.createUser(user);
  const link = await sys.getActivationLink(created.id!.id);
  await sys.activateUser(activationTokenFrom(link), password);
  log(`user ${email} created and activated`);
}

function brandFromDataset(ds: LoadedDataset): TenantBrand {
  const b = ds.tenant.brand;
  return {
    name: b.name,
    shortName: b.shortName ?? b.name.split(' ')[0] ?? b.name,
    primaryColor: b.primaryColor,
    accentColor: b.accentColor,
    logo: ds.brandFiles.logo,
    favicon: ds.brandFiles.favicon,
    fontFamily: b.fontFamily,
    loginTagline: b.loginTagline ?? null,
    dashboards: {},
  };
}

/** Applies the fields an operator edited; `null` on an asset means "keep the current one". */
export function applyBrandInput(base: TenantBrand, input: BrandInput | undefined): TenantBrand {
  if (!input) return base;
  return {
    ...base,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.shortName !== undefined ? { shortName: input.shortName } : {}),
    ...(input.primaryColor !== undefined ? { primaryColor: input.primaryColor } : {}),
    ...(input.accentColor !== undefined ? { accentColor: input.accentColor } : {}),
    ...(input.fontFamily !== undefined ? { fontFamily: input.fontFamily } : {}),
    ...(input.loginTagline !== undefined ? { loginTagline: input.loginTagline ?? null } : {}),
    ...(input.logo ? { logo: input.logo } : {}),
    ...(input.favicon ? { favicon: input.favicon } : {}),
  };
}

/**
 * Creates or updates everything a tenant needs: ThingsBoard tenant, service users, profiles, root
 * rule chain, dashboards and the platform tenant row. Idempotent; a tenant without a dataset keeps
 * the brand it already has (or the neutral one) plus any operator overrides.
 */
export async function provision(
  container: Container,
  opts: ProvisionOptions,
): Promise<ProvisionResult> {
  const started = Date.now();
  const log = opts.log ?? (() => undefined);
  const { config } = container;
  const key = opts.tenant;
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(key)) throw new Error(`invalid tenant key ${key}`);

  const ds = opts.dataset
    ? await loadDataset(config.DATASETS_DIR, opts.dataset, key, config.PLATFORM_HOST)
    : null;
  const existing = await container.tenants.byKey(key);
  const settings = opts.settings ?? {};
  // operator settings win over the dataset: the console names the tenant, the dataset fills the rest
  const displayName = settings.name ?? ds?.tenant.name ?? existing?.name ?? key;
  const hostname =
    settings.hostname ??
    ds?.tenant.hostname ??
    existing?.hostname ??
    `${key}.${config.PLATFORM_HOST}`;
  const demoMode =
    settings.demoMode ?? ds?.tenant.demoMode ?? existing?.demoMode ?? Boolean(opts.demo);

  const sys = await sysadminClient(container, config, log);
  let tbTenantId = existing?.tbTenantId ?? null;
  if (tbTenantId && !(await sys.getTenantById(tbTenantId))) tbTenantId = null;
  if (tbTenantId) {
    await sys.renameTenant(tbTenantId, displayName);
    log(`ThingsBoard tenant "${displayName}" exists`);
  } else {
    const found = await sys.findTenantByTitle(displayName);
    if (found) {
      tbTenantId = found.id!.id;
      log(`ThingsBoard tenant "${displayName}" exists`);
    } else {
      const created = await sys.createTenant(displayName);
      tbTenantId = created.id!.id;
      log(`ThingsBoard tenant "${displayName}" created`);
    }
  }

  const apiEmail = container.tb.serviceEmail(key, 'svc-api');
  const dashEmail = container.tb.serviceEmail(key, 'svc-dashboards');
  await ensureTenantAdmin(
    sys,
    tbTenantId,
    apiEmail,
    config.TB_SERVICE_PASSWORD,
    'Platform API',
    log,
  );
  await ensureTenantAdmin(
    sys,
    tbTenantId,
    dashEmail,
    config.TB_SERVICE_PASSWORD,
    'Dashboards',
    log,
  );

  const tenantTb = container.tb.forTenant(key);
  const imported = await importTbArtefacts(
    tenantTb,
    config.TB_ARTEFACTS_DIR,
    { API_URL: config.API_URL, INTERNAL_API_TOKEN: config.INTERNAL_API_TOKEN },
    log,
  );

  const tenant = await withoutTenant(container.db.admin, async (tx) => {
    const row = (await tx.select().from(tenants).where(eq(tenants.key, key)).limit(1))[0];
    const base = ds ? brandFromDataset(ds) : (row?.brand ?? defaultBrand(displayName));
    const brand: TenantBrand = {
      ...applyBrandInput(base, opts.brand),
      dashboards: { ...(row?.brand.dashboards ?? {}), ...imported.dashboards },
    };
    // a renamed tenant keeps its brand, but the displayed brand name follows the new name
    if (opts.brand?.name === undefined && settings.name) brand.name = settings.name;
    const values = {
      key,
      name: displayName,
      hostname,
      tbTenantId,
      brand,
      locale: settings.locale ?? ds?.tenant.locale ?? row?.locale ?? 'en',
      currency: settings.currency ?? ds?.tenant.currency ?? row?.currency ?? 'AED',
      tariffPerKwh: String(
        settings.tariffPerKwh ?? ds?.tenant.tariffPerKwh ?? row?.tariffPerKwh ?? 0.44,
      ),
      demoMode,
      updatedAt: new Date(),
    };
    if (row) {
      const [updated] = await tx
        .update(tenants)
        .set(values)
        .where(eq(tenants.id, row.id))
        .returning();
      log(`tenant row ${key} updated`);
      return updated!;
    }
    const [inserted] = await tx.insert(tenants).values(values).returning();
    log(`tenant row ${key} created`);
    return inserted!;
  });
  container.tenantResolver.invalidate();

  return {
    tenant,
    tbTenantId,
    users: [apiEmail, dashEmail],
    deviceProfiles: imported.deviceProfiles.length,
    assetProfiles: imported.assetProfiles.length,
    ruleChain: imported.ruleChain?.name ?? null,
    dashboards: Object.keys(imported.dashboards).length,
    elapsedMs: Date.now() - started,
  };
}
