import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import type { AccessTokenClaims, RefreshTokenClaims, TokenPair } from '@platform/shared/dto';
import { AccessTokenClaimsSchema, RefreshTokenClaimsSchema } from '@platform/shared/dto';
import type { Db } from '../../db/index.js';
import { users, type TenantRow } from '../../db/schema/index.js';
import { withTenant } from '../../db/tenant.js';
import { unauthorized } from '../../lib/errors.js';
import type { AuditService } from '../audit/audit.service.js';
import type { UsersService } from '../users/users.service.js';

/** Signing is delegated to @fastify/jwt so the plugin owns the secret; the service owns the rules. */
export interface TokenSigner {
  sign(payload: Record<string, unknown>, opts: { expiresIn: string }): string;
  verify<T>(token: string): T;
}

/** Converts "15m" / "7d" / "3600" into seconds. */
export function ttlToSeconds(ttl: string): number {
  const m = /^(\d+)([smhd]?)$/.exec(ttl.trim());
  if (!m) throw new Error(`invalid ttl ${ttl}`);
  const n = Number(m[1]);
  const unit = m[2] ?? '';
  return unit === 'd' ? n * 86400 : unit === 'h' ? n * 3600 : unit === 'm' ? n * 60 : n;
}

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly signer: TokenSigner,
    private readonly ttl: { access: string; refresh: string },
  ) {}

  async login(tenant: TenantRow, email: string, password: string): Promise<TokenPair> {
    const user = await this.users.byEmail(tenant.id, email);
    const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !ok) {
      await withTenant(this.db, tenant.id, (tx) =>
        this.audit.record(tx, {
          tenantId: tenant.id,
          action: 'auth.login_failed',
          entityType: 'user',
          entityId: null,
          after: { email },
        }),
      );
      throw unauthorized('Invalid email or password');
    }
    await withTenant(this.db, tenant.id, async (tx) => {
      await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await this.audit.record(tx, {
        tenantId: tenant.id,
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
      });
    });
    return this.issue(tenant, user.id, user.email, user.role);
  }

  async refresh(tenant: TenantRow, refreshToken: string): Promise<TokenPair> {
    let claims: RefreshTokenClaims;
    try {
      claims = RefreshTokenClaimsSchema.parse(this.signer.verify<unknown>(refreshToken));
    } catch {
      throw unauthorized('Invalid refresh token');
    }
    if (claims.tenantId !== tenant.id) throw unauthorized('Invalid refresh token');
    const user = await this.users.byId(tenant.id, claims.sub);
    if (!user) throw unauthorized('Invalid refresh token');
    return this.issue(tenant, user.id, user.email, user.role);
  }

  private issue(
    tenant: TenantRow,
    userId: string,
    email: string,
    role: AccessTokenClaims['role'],
  ): TokenPair {
    const access: AccessTokenClaims = {
      sub: userId,
      tenantId: tenant.id,
      tenantKey: tenant.key,
      role,
      email,
      type: 'access',
    };
    const refresh: RefreshTokenClaims = { sub: userId, tenantId: tenant.id, type: 'refresh' };
    return {
      accessToken: this.signer.sign(access, { expiresIn: this.ttl.access }),
      refreshToken: this.signer.sign(refresh, { expiresIn: this.ttl.refresh }),
      expiresIn: ttlToSeconds(this.ttl.access),
    };
  }

  /** Verifies an access token (used by the Socket.IO handshake) and checks it belongs to the tenant. */
  verifyAccess(token: string): AccessTokenClaims {
    try {
      return AccessTokenClaimsSchema.parse(this.signer.verify<unknown>(token));
    } catch {
      throw unauthorized('Invalid token');
    }
  }
}
