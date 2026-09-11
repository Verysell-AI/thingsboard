import { z } from 'zod';
import { LocaleSchema } from '../dataset/schema.js';

/**
 * Public branding for the tenant resolved from the Host header. Served without authentication so
 * the login page is already branded. URLs are API-relative (the web prefixes its API base path).
 */
export const BrandingSchema = z.object({
  tenantKey: z.string(),
  name: z.string(),
  shortName: z.string(),
  primaryColor: z.string(),
  accentColor: z.string(),
  /** API-relative path, e.g. /branding/logo */
  logoUrl: z.string(),
  /** API-relative path, e.g. /branding/favicon */
  faviconUrl: z.string(),
  /** Media type of the favicon so the browser gets the right <link type>. */
  faviconMime: z.string(),
  fontFamily: z.string(),
  loginTagline: z.string().nullable(),
  locale: LocaleSchema,
  /** Browser tab title. */
  title: z.string(),
  demoMode: z.boolean(),
});
export type Branding = z.infer<typeof BrandingSchema>;

/** Neutral brand used for tenants provisioned without a dataset. */
export const DEFAULT_BRAND = {
  name: 'Facilities Platform',
  shortName: 'Platform',
  primaryColor: '#1F2937',
  accentColor: '#2563EB',
  fontFamily: 'Inter, system-ui, sans-serif',
} as const;
