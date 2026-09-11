import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLoaderData,
} from 'react-router';
import type { Route } from './+types/root';
import './app.css';
import { BrandingProvider, applyBranding, fetchBranding } from '~/lib/branding';
import { i18next, resolveInitialLocale, setupI18n } from '~/lib/i18n';

export const links: Route.LinksFunction = () => [{ rel: 'icon', href: '/favicon.svg' }];

/** Branding is public and needed before login, so the root loads it once for the whole app. */
export async function clientLoader() {
  const branding = await fetchBranding();
  const locale = resolveInitialLocale(branding.locale, window.location.search);
  await setupI18n(locale);
  applyBranding(branding);
  return { branding };
}

export function HydrateFallback() {
  return (
    <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">…</div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { branding } = useLoaderData<typeof clientLoader>();
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }),
  );
  return (
    <I18nextProvider i18n={i18next}>
      <QueryClientProvider client={queryClient}>
        <BrandingProvider branding={branding}>
          <Outlet />
        </BrandingProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useTranslation();
  let title = t('app.error');
  let details: string | undefined;
  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? t('app.notFound') : `${error.status}`;
    details = error.status === 404 ? t('app.notFoundDetail') : error.statusText;
  } else if (error instanceof Error) {
    details = error.message;
  }
  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="text-xl font-semibold">{title}</h1>
      {details && <p className="mt-2 text-sm text-muted-foreground">{details}</p>}
    </main>
  );
}
