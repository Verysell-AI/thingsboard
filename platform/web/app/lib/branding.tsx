import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { BrandingSchema, DEFAULT_BRAND, type Branding } from '@platform/shared/dto';
import { api, apiUrl } from './api';

export const FALLBACK_BRANDING: Branding = {
  tenantKey: '',
  name: DEFAULT_BRAND.name,
  shortName: DEFAULT_BRAND.shortName,
  primaryColor: DEFAULT_BRAND.primaryColor,
  accentColor: DEFAULT_BRAND.accentColor,
  logoUrl: '',
  faviconUrl: '',
  faviconMime: 'image/svg+xml',
  fontFamily: DEFAULT_BRAND.fontFamily,
  loginTagline: null,
  locale: 'en',
  title: DEFAULT_BRAND.name,
  demoMode: false,
};

const BrandingContext = createContext<Branding>(FALLBACK_BRANDING);

export async function fetchBranding(): Promise<Branding> {
  try {
    return await api.get('/branding', BrandingSchema, { auth: false });
  } catch {
    return FALLBACK_BRANDING;
  }
}

/** Writes the brand onto the document: CSS variables, title, favicon. Safe to call repeatedly. */
export function applyBranding(branding: Branding, doc: Document = document) {
  const root = doc.documentElement;
  root.style.setProperty('--brand-primary', branding.primaryColor);
  root.style.setProperty('--brand-accent', branding.accentColor);
  root.style.setProperty('--brand-font', branding.fontFamily);
  doc.title = branding.title;
  if (branding.faviconUrl) {
    let link = doc.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = doc.createElement('link');
      link.rel = 'icon';
      doc.head.appendChild(link);
    }
    link.href = apiUrl(branding.faviconUrl);
    link.type = branding.faviconMime;
  }
}

export function BrandingProvider({
  branding,
  children,
}: {
  branding: Branding;
  children: ReactNode;
}) {
  useEffect(() => {
    applyBranding(branding);
  }, [branding]);
  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export function useBranding(): Branding {
  return useContext(BrandingContext);
}

/** Absolute URL for a brand asset path returned by the API, or null when the tenant has none. */
export function brandAssetUrl(path: string): string | null {
  return path ? apiUrl(path) : null;
}
