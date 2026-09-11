import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TbClient, TbEntity, TbRuleChainMetadata } from '../services/tb/tb.client.js';

export interface ImportSummary {
  deviceProfiles: string[];
  assetProfiles: string[];
  ruleChain: { name: string; id: string; created: boolean } | null;
  dashboards: Record<string, string>;
}

async function listJson(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
}

function strip(entity: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, tenantId: _tenantId, createdTime: _createdTime, ...rest } = entity;
  return rest;
}

/** Imports the checked-in ThingsBoard artefacts into one tenant, updating in place when they exist. */
export async function importTbArtefacts(
  tb: TbClient,
  artefactsDir: string,
  placeholders: Record<string, string>,
  log: (msg: string) => void = () => undefined,
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    deviceProfiles: [],
    assetProfiles: [],
    ruleChain: null,
    dashboards: {},
  };

  for (const file of await listJson(join(artefactsDir, 'device-profiles'))) {
    const profile = strip(
      JSON.parse(await readFile(join(artefactsDir, 'device-profiles', file), 'utf8')),
    ) as TbEntity;
    const existing = await tb.getDeviceProfileByName(profile.name);
    await tb.saveDeviceProfile(
      existing ? { ...profile, id: existing.id, default: existing.default } : profile,
    );
    summary.deviceProfiles.push(profile.name);
    log(`device profile ${profile.name} ${existing ? 'updated' : 'created'}`);
  }

  for (const file of await listJson(join(artefactsDir, 'asset-profiles'))) {
    const profile = strip(
      JSON.parse(await readFile(join(artefactsDir, 'asset-profiles', file), 'utf8')),
    ) as TbEntity;
    const existing = await tb.getAssetProfileByName(profile.name);
    await tb.saveAssetProfile(
      existing ? { ...profile, id: existing.id, default: existing.default } : profile,
    );
    summary.assetProfiles.push(profile.name);
    log(`asset profile ${profile.name} ${existing ? 'updated' : 'created'}`);
  }

  const chainPath = join(artefactsDir, 'rule-chain.json');
  let chainRaw: string | null = null;
  try {
    chainRaw = await readFile(chainPath, 'utf8');
  } catch {
    log('no rule-chain.json found; skipping');
  }
  if (chainRaw) {
    for (const [key, value] of Object.entries(placeholders))
      chainRaw = chainRaw.split(`\${${key}}`).join(value);
    const exported = JSON.parse(chainRaw) as {
      ruleChain: Record<string, unknown> & { name: string };
      metadata: TbRuleChainMetadata;
    };
    const chainDef = strip(exported.ruleChain) as TbEntity & { name: string };
    const existing = (await tb.getRuleChains()).find((c) => c.name === chainDef.name);
    let id: string;
    if (existing?.id) {
      id = existing.id.id;
    } else {
      const saved = await tb.saveRuleChain({ ...chainDef, root: false });
      id = saved.id!.id;
    }
    const { ruleChainId: _rc, ...meta } = exported.metadata;
    await tb.saveRuleChainMetadata({ ...meta, ruleChainId: { id, entityType: 'RULE_CHAIN' } });
    await tb.setRootRuleChain(id);
    summary.ruleChain = { name: chainDef.name, id, created: !existing };
    log(`rule chain ${chainDef.name} ${existing ? 'updated' : 'created'} and set as root`);
  }

  for (const file of await listJson(join(artefactsDir, 'dashboards'))) {
    const dashboard = strip(
      JSON.parse(await readFile(join(artefactsDir, 'dashboards', file), 'utf8')),
    ) as Record<string, unknown> & { title: string };
    const existing = await tb.findDashboardByTitle(dashboard.title);
    const saved = await tb.saveDashboard(existing ? { ...dashboard, id: existing.id } : dashboard);
    summary.dashboards[file.replace(/\.json$/, '')] = saved.id!.id;
    log(`dashboard ${dashboard.title} ${existing ? 'updated' : 'created'}`);
  }

  return summary;
}
