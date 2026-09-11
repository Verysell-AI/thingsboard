import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Branding } from '@platform/shared/dto';
import { BrandingProvider, useBranding } from '~/lib/branding';

const branding: Branding = {
  tenantKey: 'alpha',
  name: 'Falcon Facilities Group',
  shortName: 'Falcon',
  primaryColor: '#0B3D91',
  accentColor: '#F59E0B',
  logoUrl: '/branding/logo',
  faviconUrl: '/branding/favicon',
  faviconMime: 'image/png',
  fontFamily: 'Inter, sans-serif',
  loginTagline: null,
  locale: 'en',
  title: 'Falcon Facilities Group',
  demoMode: true,
};

function Probe() {
  const b = useBranding();
  return <span data-testid="name">{b.name}</span>;
}

describe('BrandingProvider', () => {
  it('sets brand CSS variables, title and favicon on the document', () => {
    const { getByTestId } = render(
      <BrandingProvider branding={branding}>
        <Probe />
      </BrandingProvider>,
    );
    expect(getByTestId('name').textContent).toBe('Falcon Facilities Group');
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--brand-primary')).toBe('#0B3D91');
    expect(root.style.getPropertyValue('--brand-accent')).toBe('#F59E0B');
    expect(document.title).toBe('Falcon Facilities Group');
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    expect(icon?.href).toContain('/api/branding/favicon');
    expect(icon?.type).toBe('image/png');
  });
});
