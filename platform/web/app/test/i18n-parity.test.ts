import { describe, expect, it } from 'vitest';
import ar from '~/i18n/ar.json';
import en from '~/i18n/en.json';

/** Leaf keys with the plural suffix removed: languages legitimately differ in plural forms. */
function flatten(obj: unknown, prefix = ''): string[] {
  if (!obj || typeof obj !== 'object')
    return [prefix.replace(/_(zero|one|two|few|many|other)$/, '')];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe('translations', () => {
  it('have the same keys in English and Arabic', () => {
    const enKeys = new Set(flatten(en));
    const arKeys = new Set(flatten(ar));
    expect([...enKeys].filter((k) => !arKeys.has(k))).toEqual([]);
    expect([...arKeys].filter((k) => !enKeys.has(k))).toEqual([]);
  });
  it('never name the IoT core vendor or the implementer to tenants', () => {
    for (const bundle of [en, ar]) {
      const text = JSON.stringify(bundle);
      expect(text).not.toMatch(/thingsboard/i);
      expect(text).not.toMatch(/verysell/i);
    }
  });
});
