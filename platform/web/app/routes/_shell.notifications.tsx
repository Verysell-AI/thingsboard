import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useOutletContext } from 'react-router';
import type { MeResponse } from '@platform/shared/dto';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { api } from '~/lib/api';
import { formatDateTime } from '~/lib/format';
import { NOTIFICATIONS_KEY, notificationLink, useNotifications } from '~/lib/notifications';
import { cn } from '~/lib/utils';

const PAGE_SIZE = 20;

export default function NotificationsRoute() {
  const { t, i18n } = useTranslation();
  const me = useOutletContext<MeResponse>();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const query = useNotifications(me.user.id, { page, pageSize: PAGE_SIZE });
  const readAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
  const readOne = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
  const act = useMutation({
    mutationFn: ({ id, key }: { id: string; key: string }) =>
      api.post(`/notifications/${id}/act`, { key }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="flex flex-col gap-4" data-testid="notifications-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('notifications.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {data ? t('notifications.unreadCount', { count: data.unread }) : t('app.loading')}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={!data || data.unread === 0 || readAll.isPending}
          onClick={() => readAll.mutate()}
        >
          <CheckCheck aria-hidden /> {t('notifications.markAllRead')}
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          {data?.items.length === 0 && (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
              <Bell className="size-6" aria-hidden />
              {t('notifications.empty')}
            </div>
          )}
          <ul className="divide-y">
            {(data?.items ?? []).map((n) => {
              const to = notificationLink(n);
              const body = (
                <>
                  <span className="flex items-center gap-2">
                    {!n.readAt && <span className="size-2 rounded-full bg-accent" aria-hidden />}
                    <span className={cn('truncate', !n.readAt && 'font-semibold')}>{n.title}</span>
                    <span className="ms-auto shrink-0 text-xs text-muted-foreground">
                      {formatDateTime(n.createdAt, i18n.language, me.tenant.timeZone)}
                    </span>
                  </span>
                  {n.body && <span className="block text-xs text-muted-foreground">{n.body}</span>}
                  {n.actedKey && (
                    <span className="block text-xs text-muted-foreground">
                      {t('notifications.acted', {
                        key: t(`notifications.act.${n.actedKey}`, { defaultValue: n.actedKey }),
                      })}
                    </span>
                  )}
                </>
              );
              const actions =
                n.actions.length > 0 && !n.actedAt ? (
                  <div
                    className="flex flex-wrap gap-2 px-4 pb-3"
                    data-testid="notification-actions"
                  >
                    {n.actions.map((a) => (
                      <Button
                        key={a.key}
                        size="sm"
                        variant={a.key === 'leave' ? 'default' : 'outline'}
                        disabled={act.isPending}
                        onClick={() => act.mutate({ id: n.id, key: a.key })}
                        data-testid={`act-${a.key}`}
                      >
                        {t(`notifications.act.${a.key}`, { defaultValue: a.label })}
                      </Button>
                    ))}
                  </div>
                ) : null;
              const className = cn(
                'flex w-full flex-col gap-1 px-4 py-3 text-start text-sm hover:bg-muted/60',
                !n.readAt && 'bg-accent/5',
              );
              return (
                <li key={n.id} data-notification={n.kind}>
                  {to ? (
                    <Link
                      to={to}
                      className={className}
                      onClick={() => !n.readAt && readOne.mutate(n.id)}
                    >
                      {body}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className={className}
                      onClick={() => !n.readAt && readOne.mutate(n.id)}
                    >
                      {body}
                    </button>
                  )}
                  {actions}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{t('assets.page', { page: page + 1, pages })}</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 0}
              onClick={() => setPage(page - 1)}
            >
              {t('assets.prev')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= pages}
              onClick={() => setPage(page + 1)}
            >
              {t('assets.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
