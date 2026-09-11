import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import type { MeResponse, Notification } from '@platform/shared/dto';
import { Button } from '~/components/ui/button';
import { api } from '~/lib/api';
import { formatAgo } from '~/lib/format';
import { NOTIFICATIONS_KEY, notificationLink, useNotifications } from '~/lib/notifications';
import { cn } from '~/lib/utils';

/** Header bell: unread badge, the five newest notifications, mark all read, link to the full page. */
export function NotificationBell({ me }: { me: MeResponse }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const query = useNotifications(me.user.id, { pageSize: 5 });
  const unread = query.data?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const readAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
  const readOne = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });

  const openItem = (n: Notification) => {
    if (!n.readAt) readOne.mutate(n.id);
    setOpen(false);
    const to = notificationLink(n);
    if (to) navigate(to);
  };

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('notifications.title')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="notification-bell"
      >
        <Bell aria-hidden />
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -end-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white"
            data-testid="notification-unread"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Button>
      {open && (
        <div
          className="absolute end-0 z-40 mt-2 w-80 rounded-lg border bg-popover text-popover-foreground shadow-lg"
          role="menu"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">{t('notifications.title')}</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={unread === 0 || readAll.isPending}
              onClick={() => readAll.mutate()}
            >
              <CheckCheck aria-hidden /> {t('notifications.markAllRead')}
            </Button>
          </div>
          <ul className="max-h-80 overflow-auto">
            {(query.data?.items ?? []).length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                {t('notifications.empty')}
              </li>
            )}
            {(query.data?.items ?? []).map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full flex-col gap-0.5 px-3 py-2 text-start text-sm hover:bg-muted',
                    !n.readAt && 'bg-accent/5',
                  )}
                  onClick={() => openItem(n)}
                >
                  <span className={cn('truncate', !n.readAt && 'font-semibold')}>{n.title}</span>
                  {n.body && (
                    <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {formatAgo(Date.parse(n.createdAt), t, i18n.language)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t px-3 py-2 text-center">
            <Link
              to="/notifications"
              className="text-sm text-primary underline-offset-4 hover:underline"
              onClick={() => setOpen(false)}
            >
              {t('notifications.viewAll')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
