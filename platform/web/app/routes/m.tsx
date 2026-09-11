import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router';
import type { Notification } from '@platform/shared/dto';
import { Button } from '~/components/ui/button';
import { api, isApiError, tenantKeyOverride } from '~/lib/api';
import { clearTokens, isAuthenticated } from '~/lib/auth';
import { brandAssetUrl, useBranding } from '~/lib/branding';
import { formatDateTime } from '~/lib/format';
import { LiveProvider } from '~/lib/live';
import { useMe } from '~/lib/me';
import { NOTIFICATIONS_KEY, useNotifications } from '~/lib/notifications';
import { cn } from '~/lib/utils';

/**
 * Phone view: the signed-in user's notifications with large action buttons, live over the socket.
 * Opened on the presenter's phone as `http://<demo-box>:8081/m?tenant=alpha`; the tenant key is
 * remembered and sent as X-Tenant-Key because a phone cannot resolve *.localhost.
 */
export default function PhoneRoute() {
  tenantKeyOverride();
  if (!isAuthenticated()) return <Navigate to="/login?next=/m" replace />;
  return (
    <LiveProvider>
      <PhoneView />
    </LiveProvider>
  );
}

function PhoneView() {
  const { t, i18n } = useTranslation();
  const branding = useBranding();
  const me = useMe();
  const queryClient = useQueryClient();
  const query = useNotifications(me.data?.user.id ?? '', { pageSize: 20 });
  const act = useMutation({
    mutationFn: ({ id, key }: { id: string; key: string }) =>
      api.post(`/notifications/${id}/act`, { key }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
  const logo = brandAssetUrl(branding.logoUrl);
  if (me.isError && isApiError(me.error) && me.error.status === 401) {
    clearTokens();
    return <Navigate to="/login?next=/m" replace />;
  }
  const items = query.data?.items ?? [];
  const pending = items.filter((n) => n.actions.length > 0 && !n.actedAt);
  const rest = items.filter((n) => !(n.actions.length > 0 && !n.actedAt));
  return (
    <main
      className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4"
      data-testid="phone-view"
    >
      <header className="flex items-center justify-between gap-3 border-b pb-3">
        <div className="flex items-center gap-3">
          {logo ? (
            <img src={logo} alt={branding.name} className="h-8 object-contain" />
          ) : (
            <span className="font-semibold text-primary">{branding.name}</span>
          )}
          <div>
            <h1 className="text-lg font-semibold">{t('m.title')}</h1>
            {me.data && <p className="text-xs text-muted-foreground">{me.data.user.email}</p>}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('m.signOut')}
          onClick={() => {
            clearTokens();
            window.location.assign('/login?next=/m');
          }}
        >
          <LogOut aria-hidden />
        </Button>
      </header>
      <p className="text-sm text-muted-foreground">{t('m.subtitle')}</p>
      {query.isPending && <p className="text-sm text-muted-foreground">{t('app.loading')}</p>}
      {!query.isPending && items.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <Bell className="size-8" aria-hidden />
          {t('m.empty')}
        </div>
      )}
      <ul className="flex flex-col gap-3">
        {[...pending, ...rest].map((n) => (
          <PhoneCard
            key={n.id}
            n={n}
            locale={i18n.language}
            timeZone={me.data?.tenant.timeZone ?? 'UTC'}
            busy={act.isPending}
            onAct={(key) => act.mutate({ id: n.id, key })}
          />
        ))}
      </ul>
      {act.isError && (
        <p className="text-sm text-destructive">
          {isApiError(act.error) ? (act.error.detail ?? act.error.title) : String(act.error)}
        </p>
      )}
      <footer className="mt-auto pt-6 text-center text-xs text-muted-foreground">
        <Link to="/" className="underline">
          {t('m.fullApp')}
        </Link>
      </footer>
    </main>
  );
}

function PhoneCard({
  n,
  locale,
  timeZone,
  busy,
  onAct,
}: {
  n: Notification;
  locale: string;
  timeZone: string;
  busy: boolean;
  onAct: (key: string) => void;
}) {
  const { t } = useTranslation();
  const actionable = n.actions.length > 0 && !n.actedAt;
  return (
    <li
      className={cn(
        'rounded-lg border bg-card p-4 shadow-xs',
        actionable && 'border-accent ring-1 ring-accent/40',
      )}
      data-notification={n.kind}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className={cn('text-base', !n.readAt && 'font-semibold')}>{n.title}</h2>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDateTime(n.createdAt, locale, timeZone)}
        </span>
      </div>
      {n.body && <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>}
      {actionable && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {n.actions.map((a) => (
            <Button
              key={a.key}
              size="lg"
              variant={a.key === 'leave' ? 'default' : 'outline'}
              className="h-14 text-base"
              disabled={busy}
              onClick={() => onAct(a.key)}
              data-testid={`act-${a.key}`}
            >
              {t(`notifications.act.${a.key}`, { defaultValue: a.label })}
            </Button>
          ))}
        </div>
      )}
      {n.actedKey && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('notifications.actDone', {
            key: t(`notifications.act.${n.actedKey}`, { defaultValue: n.actedKey }),
          })}
        </p>
      )}
    </li>
  );
}
