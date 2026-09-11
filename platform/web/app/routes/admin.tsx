import { useTranslation } from 'react-i18next';
import { Link, Navigate, Outlet, redirect, useNavigate } from 'react-router';
import { Building2, LogOut } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { useAdminMe } from '~/lib/admin';
import { isApiError } from '~/lib/api';
import { adminSession } from '~/lib/auth';

export function clientLoader() {
  if (!adminSession.isAuthenticated()) throw redirect('/admin/login');
  return null;
}

export default function AdminLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useAdminMe();

  if (!adminSession.isAuthenticated()) return <Navigate to="/admin/login" replace />;
  if (me.isError && isApiError(me.error) && me.error.status === 401) {
    adminSession.clearTokens();
    return <Navigate to="/admin/login" replace />;
  }

  function signOut() {
    adminSession.clearTokens();
    navigate('/admin/login', { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex items-center gap-3 border-b bg-card px-4 py-3 sm:px-6">
        <Link to="/admin" className="flex items-center gap-2 font-semibold">
          <Building2 className="size-5 text-primary" />
          {t('admin.title')}
        </Link>
        <div className="ms-auto flex items-center gap-3">
          {me.data && <span className="text-sm text-muted-foreground">{me.data.email}</span>}
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="size-4" />
            {t('app.logout')}
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
}
