import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TbClient, TbError } from './tb.client.js';

const BASE = 'http://tb.test:9090';

describe('TbClient', () => {
  let agent: MockAgent;
  beforeEach(() => {
    agent = new MockAgent();
    agent.disableNetConnect();
  });
  afterEach(async () => {
    await agent.close();
  });

  it('logs in once, sends the bearer header, and passes accessToken as a query parameter', async () => {
    const pool = agent.get(BASE);
    pool
      .intercept({ path: '/api/auth/login', method: 'POST' })
      .reply(200, { token: 't1', refreshToken: 'r1' })
      .times(1);
    pool
      .intercept({
        path: '/api/device?accessToken=alpha-LIGHT-1.1',
        method: 'POST',
        headers: { 'x-authorization': 'Bearer t1' },
      })
      .reply(200, (req) => ({
        id: { id: 'dev-1', entityType: 'DEVICE' },
        ...(JSON.parse(req.body as string) as object),
      }));
    pool
      .intercept({ path: '/api/tenant/devices?deviceName=LIGHT-1.1', method: 'GET' })
      .reply(200, { id: { id: 'dev-1', entityType: 'DEVICE' }, name: 'LIGHT-1.1' });

    const tb = new TbClient({
      baseUrl: BASE,
      email: 'svc-api@alpha.demo',
      password: 'pw',
      dispatcher: agent,
    });
    const saved = await tb.saveDevice({ name: 'LIGHT-1.1', type: 'light' }, 'alpha-LIGHT-1.1');
    expect(saved.id?.id).toBe('dev-1');
    const found = await tb.getTenantDeviceByName('LIGHT-1.1');
    expect(found?.name).toBe('LIGHT-1.1');
  });

  it('refreshes the token after a 401 and retries once', async () => {
    const pool = agent.get(BASE);
    pool
      .intercept({ path: '/api/auth/login', method: 'POST' })
      .reply(200, { token: 'old', refreshToken: 'r1' });
    pool
      .intercept({
        path: '/api/ruleChains?pageSize=100&page=0',
        method: 'GET',
        headers: { 'x-authorization': 'Bearer old' },
      })
      .reply(401, { message: 'expired' });
    pool
      .intercept({ path: '/api/auth/token', method: 'POST' })
      .reply(200, { token: 'new', refreshToken: 'r2' });
    pool
      .intercept({
        path: '/api/ruleChains?pageSize=100&page=0',
        method: 'GET',
        headers: { 'x-authorization': 'Bearer new' },
      })
      .reply(200, { data: [{ name: 'Root Rule Chain' }] });

    const tb = new TbClient({ baseUrl: BASE, email: 'x', password: 'y', dispatcher: agent });
    const chains = await tb.getRuleChains();
    expect(chains.map((c) => c.name)).toEqual(['Root Rule Chain']);
  });

  it('returns null for a missing device and throws TbError otherwise', async () => {
    const pool = agent.get(BASE);
    pool
      .intercept({ path: '/api/auth/login', method: 'POST' })
      .reply(200, { token: 't', refreshToken: 'r' });
    pool
      .intercept({ path: '/api/tenant/devices?deviceName=NOPE', method: 'GET' })
      .reply(404, { message: 'not found' });
    pool
      .intercept({ path: '/api/rpc/oneway/dev-1', method: 'POST' })
      .reply(500, { message: 'boom' });
    const tb = new TbClient({ baseUrl: BASE, email: 'x', password: 'y', dispatcher: agent });
    expect(await tb.getTenantDeviceByName('NOPE')).toBeNull();
    await expect(tb.rpcOneway('dev-1', 'setState', { state: 1 })).rejects.toBeInstanceOf(TbError);
  });

  it('treats any HTTP response, including a redirect, as reachable', async () => {
    const pool = agent.get(BASE);
    pool
      .intercept({ path: '/api/auth/login', method: 'GET' })
      .reply(302, '', { headers: { location: '/login' } });
    expect(await TbClient.reachable(BASE, agent)).toBe(true);
    expect(await TbClient.reachable('http://nowhere.test:1', agent)).toBe(false);
  });
});
