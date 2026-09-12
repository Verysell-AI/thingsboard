import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConsoleService } from './console.service.js';

const SIM = 'http://simulator:4100';

describe('ConsoleService', () => {
  let agent: MockAgent;
  let svc: ConsoleService;

  beforeEach(() => {
    agent = new MockAgent();
    agent.disableNetConnect();
    svc = new ConsoleService(SIM, 'secret', agent);
  });
  afterEach(() => agent.close());

  it('sends the internal token and, without a body, no content-type', async () => {
    let seen: Record<string, string> | undefined;
    agent
      .get(SIM)
      .intercept({ path: '/tenants/gamma', method: 'PUT' })
      .reply(200, (req) => {
        seen = Object.fromEntries(
          Object.entries(req.headers as Record<string, string>).map(([k, v]) => [
            k.toLowerCase(),
            v,
          ]),
        );
        return { key: 'gamma', devices: 95 };
      });
    const r = await svc.syncTenant('gamma');
    expect(r).toEqual({ key: 'gamma', devices: 95 });
    expect(seen?.['x-internal-token']).toBe('secret');
    expect(seen?.['content-type']).toBeUndefined();
  });

  it('sends JSON with a content-type when there is a body', async () => {
    let seen: Record<string, string> | undefined;
    agent
      .get(SIM)
      .intercept({ path: '/clock', method: 'PUT' })
      .reply(200, (req) => {
        seen = Object.fromEntries(
          Object.entries(req.headers as Record<string, string>).map(([k, v]) => [
            k.toLowerCase(),
            v,
          ]),
        );
        return {
          tenantKey: 'gamma',
          state: { anchorRealMs: 0, anchorVirtualMs: 0, speed: 1 },
          realNow: 0,
          virtualNow: 0,
          live: true,
          timeZone: 'Asia/Dubai',
        };
      });
    await svc.setClock('gamma', { anchorRealMs: 0, anchorVirtualMs: 0, speed: 1 });
    expect(seen?.['content-type']).toBe('application/json');
  });

  it('treats a 404 on tenant removal as already gone', async () => {
    agent
      .get(SIM)
      .intercept({ path: '/tenants/ghost', method: 'DELETE' })
      .reply(404, { detail: 'unknown tenant ghost' });
    await expect(svc.removeTenant('ghost')).resolves.toBeUndefined();
  });

  it('surfaces other simulator errors', async () => {
    agent
      .get(SIM)
      .intercept({ path: '/tenants/bad', method: 'PUT' })
      .reply(400, { message: 'dataset office-demo has no tenant files' });
    await expect(svc.syncTenant('bad')).rejects.toMatchObject({
      status: 400,
      detail: 'dataset office-demo has no tenant files',
    });
  });
});
