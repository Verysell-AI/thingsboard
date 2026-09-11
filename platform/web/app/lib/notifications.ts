import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { NotificationsResponseSchema, type Notification } from '@platform/shared/dto';
import { api } from './api';
import { useLive } from './live';

export const NOTIFICATIONS_KEY = ['notifications'] as const;

/** Latest notifications plus the unread count; refreshed when a live notification for the user lands. */
export function useNotifications(userId: string, opts: { pageSize?: number; page?: number } = {}) {
  const queryClient = useQueryClient();
  const live = useLive();
  const pageSize = opts.pageSize ?? 5;
  const page = opts.page ?? 0;
  const query = useQuery({
    queryKey: [...NOTIFICATIONS_KEY, page, pageSize],
    queryFn: () =>
      api.get(`/notifications?page=${page}&pageSize=${pageSize}`, NotificationsResponseSchema),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const latest = live.events.find((e) => e.kind === 'notification' && e.userId === userId);
  const latestId = latest?.id;
  useEffect(() => {
    if (latestId) void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
  }, [latestId, queryClient]);
  return query;
}

/** Where a notification leads when clicked. */
export function notificationLink(n: Notification): string | null {
  switch (n.kind) {
    case 'asset.unreachable':
    case 'alarm':
    case 'asset.misplaced':
    case 'maintenance.task':
      return n.subject ? `/assets?search=${encodeURIComponent(n.subject)}` : '/assets';
    case 'booking.released':
    case 'sweep.late_worker':
    case 'sweep.summary':
      return '/rooms';
    case 'peak.shedding':
    case 'night.anomaly':
      return '/energy';
    default:
      return null;
  }
}
