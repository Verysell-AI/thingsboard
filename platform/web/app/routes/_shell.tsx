import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, redirect } from 'react-router';
import { Header } from '~/components/shell/header';
import { Sidebar } from '~/components/shell/sidebar';
import { Button } from '~/components/ui/button';
import { isApiError } from '~/lib/api';
import { clearTokens, isAuthenticated } from '~/lib/auth';
import { LiveProvider } from '~/lib/live';
import { useMe } from '~/lib/me';

export function clientLoader() {
  if (!isAuthenticated()) throw redirect('/login');
  return null;
}

export default function ShellLayout() {
  const { t } = useTranslation();
  const me = useMe();
  const [navOpen, setNavOpen] = useState(false);

  if (!isAuthenticated()) return <Navigate to="/login" replace />;

  if (me.isPending) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        {t('app.loading')}
      </div>
    );
  }

  if (me.isError || !me.data) {
    if (isApiError(me.error) && me.error.status === 401) {
      clearTokens();
      return <Navigate to="/login" replace />;
    }
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-sm">
        <p>{t('app.error')}</p>
        <Button variant="outline" onClick={() => void me.refetch()}>
          {t('app.retry')}
        </Button>
      </div>
    );
  }

  return (
    <LiveProvider>
      <div className="flex h-screen">
        <Sidebar
          showConsole={me.data.tenant.demoMode}
          role={me.data.user.role}
          open={navOpen}
          onClose={() => setNavOpen(false)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header me={me.data} navOpen={navOpen} onMenu={() => setNavOpen(true)} />
          <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
            <Outlet context={me.data} />
          </main>
        </div>
      </div>
    </LiveProvider>
  );
}
