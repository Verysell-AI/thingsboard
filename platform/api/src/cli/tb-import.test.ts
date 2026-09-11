import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TbClient } from '../services/tb/tb.client.js';
import { importTbArtefacts } from './tb-import.js';

describe('importTbArtefacts', () => {
  it('creates the rule chain, posts metadata with the substituted placeholders, sets root, and updates existing profiles', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tb-artefacts-'));
    await mkdir(join(dir, 'device-profiles'));
    await writeFile(
      join(dir, 'device-profiles', 'light.json'),
      JSON.stringify({ id: { id: 'x' }, tenantId: { id: 'y' }, name: 'light', type: 'DEFAULT' }),
    );
    await writeFile(
      join(dir, 'rule-chain.json'),
      JSON.stringify({
        ruleChain: { name: 'Platform root', root: false, type: 'CORE' },
        metadata: {
          firstNodeIndex: 0,
          nodes: [
            {
              type: 'rest',
              configuration: {
                restEndpointUrlPattern: '${API_URL}/internal/tb/events',
                headers: { 'X-Internal-Token': '${INTERNAL_API_TOKEN}' },
              },
            },
          ],
          connections: [],
        },
      }),
    );
    const calls: string[] = [];
    const tb = {
      getDeviceProfileByName: async () => ({
        id: { id: 'lp-1', entityType: 'DEVICE_PROFILE' },
        name: 'light',
        default: false,
      }),
      saveDeviceProfile: async (p: Record<string, unknown>) => {
        calls.push(
          `saveDeviceProfile:${(p.id as { id: string } | undefined)?.id}:${'tenantId' in p}`,
        );
        return p;
      },
      getAssetProfileByName: async () => null,
      saveAssetProfile: async (p: Record<string, unknown>) => p,
      getRuleChains: async () => [],
      saveRuleChain: async (c: Record<string, unknown>) => {
        calls.push(`saveRuleChain:${c.root}`);
        return { ...c, id: { id: 'rc-1', entityType: 'RULE_CHAIN' } };
      },
      saveRuleChainMetadata: async (m: Record<string, unknown>) => {
        calls.push(`metadata:${JSON.stringify(m)}`);
        return m;
      },
      setRootRuleChain: async (id: string) => {
        calls.push(`root:${id}`);
      },
      findDashboardByTitle: async () => null,
      saveDashboard: async () => ({ id: { id: 'd', entityType: 'DASHBOARD' }, name: 'd' }),
    } as unknown as TbClient;

    const summary = await importTbArtefacts(tb, dir, {
      API_URL: 'http://api:4000',
      INTERNAL_API_TOKEN: 'secret',
    });
    expect(summary.deviceProfiles).toEqual(['light']);
    expect(summary.ruleChain).toEqual({ name: 'Platform root', id: 'rc-1', created: true });
    expect(calls[0]).toBe('saveDeviceProfile:lp-1:false');
    expect(calls[1]).toBe('saveRuleChain:false');
    expect(calls[2]).toContain('"ruleChainId":{"id":"rc-1","entityType":"RULE_CHAIN"}');
    expect(calls[2]).toContain('http://api:4000/internal/tb/events');
    expect(calls[2]).toContain('"X-Internal-Token":"secret"');
    expect(calls[2]).not.toContain('${');
    expect(calls[3]).toBe('root:rc-1');
  });
});
