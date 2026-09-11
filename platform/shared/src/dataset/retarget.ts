import type { TenantDataset } from './schema.js';

/**
 * A dataset ships tenant files for a few keys only. A tenant created in the platform console
 * reuses the first shipped file with its key, hostname and employee e-mails rewritten, so every
 * name derived from the key (dataset users, device codes, access tokens) follows the new tenant.
 * The API and the simulator must agree on this, which is why it lives in the shared package.
 */
export function retargetTenantDataset(
  template: TenantDataset,
  tenantKey: string,
  platformHost = 'localhost',
): TenantDataset {
  const from = `@${template.key}.`;
  const to = `@${tenantKey}.`;
  return {
    ...template,
    key: tenantKey,
    hostname: `${tenantKey}.${platformHost}`,
    employees: template.employees.map((e) => ({ ...e, email: e.email.replace(from, to) })),
  };
}

/**
 * Chooses the tenant file for a key among the `.json` files of a dataset's tenants folder:
 * the tenant's own file when the dataset ships one, otherwise the first file as a template.
 */
export function tenantFileFor(
  files: readonly string[],
  tenantKey: string,
): { file: string; template: boolean } | null {
  const json = files.filter((f) => f.endsWith('.json')).sort();
  const own = `${tenantKey}.json`;
  if (json.includes(own)) return { file: own, template: false };
  const first = json[0];
  return first ? { file: first, template: true } : null;
}
