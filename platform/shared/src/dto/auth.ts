import { z } from 'zod';
import { RoleSchema } from '../roles.js';
import { IdSchema } from './common.js';

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const TokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Access token lifetime in seconds. */
  expiresIn: z.number().int().positive(),
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

export const RefreshRequestSchema = z.object({
  refreshToken: z.string(),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

/** Claims carried in the access token. */
export const AccessTokenClaimsSchema = z.object({
  sub: IdSchema,
  tenantId: IdSchema,
  tenantKey: z.string(),
  role: RoleSchema,
  email: z.string().email(),
  type: z.literal('access'),
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaimsSchema>;

export const RefreshTokenClaimsSchema = z.object({
  sub: IdSchema,
  tenantId: IdSchema,
  type: z.literal('refresh'),
});
export type RefreshTokenClaims = z.infer<typeof RefreshTokenClaimsSchema>;
