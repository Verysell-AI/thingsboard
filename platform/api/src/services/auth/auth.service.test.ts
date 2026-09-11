import { describe, expect, it } from 'vitest';
import { AuthService, ttlToSeconds, type TokenSigner } from './auth.service.js';

/** Signer that encodes the payload as JSON; enough to test the service's rules. */
const signer: TokenSigner = {
  sign: (payload, opts) =>
    Buffer.from(JSON.stringify({ ...payload, exp: opts.expiresIn })).toString('base64url'),
  verify: <T>(token: string) => JSON.parse(Buffer.from(token, 'base64url').toString()) as T,
};

describe('ttlToSeconds', () => {
  it('parses minutes, hours, days and plain seconds', () => {
    expect(ttlToSeconds('15m')).toBe(900);
    expect(ttlToSeconds('2h')).toBe(7200);
    expect(ttlToSeconds('7d')).toBe(604800);
    expect(ttlToSeconds('45')).toBe(45);
    expect(() => ttlToSeconds('soon')).toThrow();
  });
});

describe('AuthService.verifyAccess', () => {
  const svc = new AuthService(null as never, null as never, null as never, signer, {
    access: '15m',
    refresh: '7d',
  });
  it('accepts a well-formed access token and rejects refresh tokens', () => {
    const access = signer.sign(
      {
        sub: '11111111-1111-4111-8111-111111111111',
        tenantId: '22222222-2222-4222-8222-222222222222',
        tenantKey: 'alpha',
        role: 'VIEWER',
        email: 'v@alpha.demo',
        type: 'access',
      },
      { expiresIn: '15m' },
    );
    expect(svc.verifyAccess(access).tenantKey).toBe('alpha');
    const refresh = signer.sign(
      {
        sub: '11111111-1111-4111-8111-111111111111',
        tenantId: '22222222-2222-4222-8222-222222222222',
        type: 'refresh',
      },
      { expiresIn: '7d' },
    );
    expect(() => svc.verifyAccess(refresh)).toThrow(/Invalid token/);
    expect(() => svc.verifyAccess('garbage')).toThrow(/Invalid token/);
  });
});
