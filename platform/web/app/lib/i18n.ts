import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Locale } from '@platform/shared/dataset';
import en from '~/i18n/en.json';
import ar from '~/i18n/ar.json';

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'ar'];
const RTL_LOCALES: readonly Locale[] = ['ar'];
const STORAGE_KEY = 'platform.locale';

export function isLocale(value: string | null | undefined): value is Locale {
  return (
    value !== null &&
    value !== undefined &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

function storedLocale(): Locale | null {
  try {
    const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

function storeLocale(locale: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // storage unavailable (private mode); the choice lives for this page load only
  }
}

/**
 * Locale from ?lang=, then the user's saved choice, then the tenant default. An explicit ?lang=
 * is saved so it survives the next navigation, where the query string is gone.
 */
export function resolveInitialLocale(tenantDefault: Locale, search = ''): Locale {
  const fromQuery = new URLSearchParams(search).get('lang');
  if (isLocale(fromQuery)) {
    storeLocale(fromQuery);
    return fromQuery;
  }
  return storedLocale() ?? tenantDefault;
}

export function applyDocumentLocale(locale: Locale, doc: Document = document) {
  doc.documentElement.lang = locale;
  doc.documentElement.dir = RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';
}

export async function setupI18n(locale: Locale) {
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      resources: { en: { translation: en }, ar: { translation: ar } },
      lng: locale,
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      returnNull: false,
    });
  } else if (i18next.language !== locale) {
    await i18next.changeLanguage(locale);
  }
  applyDocumentLocale(locale);
  return i18next;
}

export async function changeLocale(locale: Locale) {
  await i18next.changeLanguage(locale);
  storeLocale(locale);
  applyDocumentLocale(locale);
}

export { i18next };
