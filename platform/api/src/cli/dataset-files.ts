import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { TenantBrandAsset } from '../db/schema/index.js';
import {
  PersonasSchema,
  TenantDatasetSchema,
  WorldSchema,
  retargetTenantDataset,
  tenantFileFor,
  type Personas,
  type TenantDataset,
  type World,
} from '@platform/shared/dataset';

export interface LoadedDataset {
  name: string;
  root: string;
  world: World;
  personas: Personas;
  tenant: TenantDataset;
  brandFiles: { logo: TenantBrandAsset; favicon: TenantBrandAsset };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

const MIME_BY_EXT: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** Reads a brand file: SVG stays markup, raster files become base64. */
async function readBrandAsset(path: string): Promise<TenantBrandAsset> {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const mime = MIME_BY_EXT[ext];
  if (!mime) throw new Error(`unsupported brand image ${path}`);
  return mime === 'image/svg+xml'
    ? { mime, content: await readFile(path, 'utf8') }
    : { mime, content: (await readFile(path)).toString('base64') };
}

/** Dataset folders under `datasetsDir`, in the order the console offers them. */
export async function listDatasets(datasetsDir: string): Promise<string[]> {
  const entries = await readdir(datasetsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

async function readTenantFile(
  root: string,
  tenantKey: string,
  platformHost: string,
): Promise<TenantDataset> {
  const dir = join(root, 'tenants');
  const pick = tenantFileFor(await readdir(dir), tenantKey);
  if (!pick) throw new Error(`dataset ${root} has no tenant files`);
  const tenant = TenantDatasetSchema.parse(await readJson(join(dir, pick.file)));
  // A key the dataset does not ship (a tenant created in the console) reuses the first file.
  if (pick.template) return retargetTenantDataset(tenant, tenantKey, platformHost);
  if (tenant.key !== tenantKey)
    throw new Error(`tenants/${tenantKey}.json declares key ${tenant.key}`);
  return tenant;
}

/** Reads and validates a dataset for one tenant key; throws with the file name on any schema error. */
export async function loadDataset(
  datasetsDir: string,
  datasetName: string,
  tenantKey: string,
  platformHost = 'localhost',
): Promise<LoadedDataset> {
  const root = resolve(datasetsDir, datasetName);
  const world = WorldSchema.parse(await readJson(join(root, 'world.json')));
  const personas = PersonasSchema.parse(await readJson(join(root, 'personas.json')));
  const tenant = await readTenantFile(root, tenantKey, platformHost);
  const logo = await readBrandAsset(join(root, tenant.brand.logo));
  const favicon = tenant.brand.favicon
    ? await readBrandAsset(join(root, tenant.brand.favicon))
    : logo;
  return { name: datasetName, root, world, personas, tenant, brandFiles: { logo, favicon } };
}

/** Runs `fn` over `items` with at most `concurrency` in flight, preserving order of results. */
export async function pMap<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
