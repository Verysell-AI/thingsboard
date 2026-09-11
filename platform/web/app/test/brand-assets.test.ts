import { describe, expect, it } from 'vitest';
import { brandDraftToInput, DEFAULT_BRAND_DRAFT } from '~/components/admin/brand-fields';
import { brandAssetPreview, readBrandFile } from '~/lib/admin';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('brand assets', () => {
  it('keeps SVG as markup', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4" /></svg>';
    const asset = await readBrandFile(new File([svg], 'logo.svg', { type: 'image/svg+xml' }));
    expect(asset).toEqual({ mime: 'image/svg+xml', content: svg });
    expect(brandAssetPreview(asset)).toContain('data:image/svg+xml;utf8,');
  });

  it('encodes raster uploads as base64', async () => {
    const bytes = Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0));
    const asset = await readBrandFile(new File([bytes], 'logo.png', { type: 'image/png' }));
    expect(asset).toEqual({ mime: 'image/png', content: PNG_BASE64 });
    expect(brandAssetPreview(asset)).toBe(`data:image/png;base64,${PNG_BASE64}`);
  });

  it('rejects unsupported types and oversized files', async () => {
    await expect(readBrandFile(new File(['x'], 'logo.gif', { type: 'image/gif' }))).rejects.toThrow(
      'unsupported',
    );
    const big = new File([new Uint8Array(1_000_001)], 'logo.png', { type: 'image/png' });
    await expect(readBrandFile(big)).rejects.toThrow('too-large');
  });

  it('sends only the fields the operator filled in', () => {
    expect(brandDraftToInput({ ...DEFAULT_BRAND_DRAFT, shortName: '' })).toEqual({
      primaryColor: DEFAULT_BRAND_DRAFT.primaryColor,
      accentColor: DEFAULT_BRAND_DRAFT.accentColor,
      fontFamily: DEFAULT_BRAND_DRAFT.fontFamily,
      loginTagline: null,
    });
    const full = brandDraftToInput(
      { ...DEFAULT_BRAND_DRAFT, shortName: 'Acme', loginTagline: 'Hello' },
      'Acme Group',
    );
    expect(full).toMatchObject({ name: 'Acme Group', shortName: 'Acme', loginTagline: 'Hello' });
  });
});
