import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import type {
  PlatformAccessClaims,
  PlatformAdmin,
  PlatformRefreshClaims,
} from '@platform/shared/dto';
import { PlatformAccessClaimsSchema, PlatformRefreshClaimsSchema } from '@platform/shared/dto';
import type { TokenPair } from '@platform/shared/dto';
import type { Db } from '../../db/index.js';
import { platformAdmins, type PlatformAdminRow } from '../../db/schema/index.js';
import { unauthorized } from '../../lib/errors.js';
import { ttlToSeconds, type TokenSigner } from '../auth/auth.service.js';

export function toPlatformAdmin(row: PlatformAdminRow): PlatformAdmin {
  return { id: row.id, email: row.email, displayName: row.displayName };
}

/**
 * Platform operators. Like `tenants`, the table is outside row-level security, so the app role
 * reads it directly. Their tokens carry `scope: platform` and no tenant, which keeps them out of
 * tenant routes and keeps tenant tokens out of /admin.
 */
export class PlatformAdminsService {
  private signer: TokenSigner | null = null;

  constructor(
    private readonly db: Db,
    private readonly ttl: { access: string; refresh: string },
  ) {}

  useSigner(signer: TokenSigner): void {
    this.signer = signer;
  }

  /** Creates the configured admin on first boot and keeps its password in step with the env. */
  async seed(
    email: string,
    password: string,
    displayName: string,
  ): Promise<'created' | 'updated' | 'unchanged'> {
    const address = email.toLowerCase();
    const existing = await this.byEmail(address);
    if (!existing) {
      await this.db
        .insert(platformAdmins)
        .values({ email: address, passwordHash: await bcrypt.hash(password, 10), displayName });
      return 'created';
    }
    if (await bcrypt.compare(password, existing.passwordHash)) return 'unchanged';
    await this.db
      .update(platformAdmins)
      .set({ passwordHash: await bcrypt.hash(password, 10), updatedAt: new Date() })
      .where(eq(platformAdmins.id, existing.id));
    return 'updated';
  }

  async byEmail(email: string): Promise<PlatformAdminRow | null> {
    const rows = await this.db
      .select()
      .from(platformAdmins)
      .where(eq(platformAdmins.email, email.toLowerCase()))
      .limit(1);
    return rows[0] ?? null;
  }

  async byId(id: string): Promise<PlatformAdminRow | null> {
    const rows = await this.db
      .select()
      .from(platformAdmins)
      .where(eq(platformAdmins.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const admin = await this.byEmail(email);
    const ok = admin ? await bcrypt.compare(password, admin.passwordHash) : false;
    if (!admin || !ok) throw unauthorized('Invalid email or password');
    await this.db
      .update(platformAdmins)
      .set({ lastLoginAt: new Date() })
      .where(eq(platformAdmins.id, admin.id));
    return this.issue(admin);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let claims: PlatformRefreshClaims;
    try {
      claims = PlatformRefreshClaimsSchema.parse(this.verify(refreshToken));
    } catch {
      throw unauthorized('Invalid refresh token');
    }
    const admin = await this.byId(claims.sub);
    if (!admin) throw unauthorized('Invalid refresh token');
    return this.issue(admin);
  }

  verifyAccess(token: string): PlatformAccessClaims {
    try {
      return PlatformAccessClaimsSchema.parse(this.verify(token));
    } catch {
      throw unauthorized('Invalid token');
    }
  }

  private verify(token: string): unknown {
    if (!this.signer) throw new Error('platform admin tokens need a signer');
    return this.signer.verify<unknown>(token);
  }

  private issue(admin: PlatformAdminRow): TokenPair {
    if (!this.signer) throw new Error('platform admin tokens need a signer');
    const access: PlatformAccessClaims = {
      sub: admin.id,
      email: admin.email,
      scope: 'platform',
      type: 'access',
    };
    const refresh: PlatformRefreshClaims = { sub: admin.id, scope: 'platform', type: 'refresh' };
    return {
      accessToken: this.signer.sign(access, { expiresIn: this.ttl.access }),
      refreshToken: this.signer.sign(refresh, { expiresIn: this.ttl.refresh }),
      expiresIn: ttlToSeconds(this.ttl.access),
    };
  }
}
