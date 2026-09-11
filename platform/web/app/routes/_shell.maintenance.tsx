import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useOutletContext, useSearchParams } from 'react-router';
import {
  MAINTENANCE_STATUSES,
  MaintenanceResponseSchema,
  MaintenanceTaskSchema,
  type MaintenanceStatus,
  type MeResponse,
} from '@platform/shared/dto';
import { assetDrawerLink } from '~/components/asset-drawer';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { Select } from '~/components/ui/select';
import { api, isApiError } from '~/lib/api';
import { formatDateTime } from '~/lib/format';
import { cn } from '~/lib/utils';

const MANAGE_ROLES = new Set(['TENANT_ADMIN', 'OPS_MANAGER', 'FIELD_OPERATOR']);
const STATUS_VARIANT: Record<MaintenanceStatus, 'warning' | 'accent' | 'success' | 'secondary'> = {
  OPEN: 'warning',
  IN_PROGRESS: 'accent',
  DONE: 'success',
  CANCELLED: 'secondary',
};
export const MAINTENANCE_KEY = ['maintenance'] as const;

export default function MaintenanceRoute() {
  const { t, i18n } = useTranslation();
  const me = useOutletContext<MeResponse>();
  const [params] = useSearchParams();
  const highlighted = params.get('task');
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string>('');
  const query = useQuery({
    queryKey: [...MAINTENANCE_KEY, status],
    queryFn: () =>
      api.get(
        `/maintenance?pageSize=100${status ? `&status=${status}` : ''}`,
        MaintenanceResponseSchema,
      ),
    refetchInterval: 60_000,
  });
  const update = useMutation({
    mutationFn: ({ id, status: next }: { id: string; status: MaintenanceStatus }) =>
      api.patch(`/maintenance/${id}`, { status: next }, MaintenanceTaskSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MAINTENANCE_KEY }),
  });
  if (me.user.role === 'FINANCE')
    return (
      <Alert variant="info" className="max-w-xl">
        <AlertDescription>{t('maintenance.forbidden')}</AlertDescription>
      </Alert>
    );
  const items = query.data?.items ?? [];
  return (
    <div className="flex flex-col gap-4" data-testid="maintenance-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('maintenance.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('maintenance.subtitle')}</p>
        </div>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-44"
          aria-label={t('assets.columns.status')}
        >
          <option value="">{t('maintenance.allStatuses')}</option>
          {MAINTENANCE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`maintenance.status.${s}`)}
            </option>
          ))}
        </Select>
      </div>
      {update.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {isApiError(update.error)
              ? (update.error.detail ?? update.error.title)
              : String(update.error)}
          </AlertDescription>
        </Alert>
      )}
      {query.isPending && <p className="text-sm text-muted-foreground">{t('app.loading')}</p>}
      {!query.isPending && items.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
            <Wrench className="size-6" aria-hidden />
            {t('maintenance.empty')}
          </CardContent>
        </Card>
      )}
      <ul className="flex flex-col gap-3">
        {items.map((task) => (
          <li key={task.id}>
            <Card
              className={cn(highlighted === task.id && 'ring-2 ring-accent')}
              data-testid="maintenance-task"
              data-status={task.status}
            >
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_VARIANT[task.status]}>
                      {t(`maintenance.status.${task.status}`)}
                    </Badge>
                    <span className="font-semibold">{task.title}</span>
                    {task.createdFromAlarmId && (
                      <Badge variant="outline">{t('maintenance.fromAlarm')}</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    <Link
                      to={assetDrawerLink(task.asset.id)}
                      className="underline-offset-2 hover:underline"
                      dir="ltr"
                    >
                      {task.asset.code}
                    </Link>
                    {' · '}
                    {task.asset.name}
                    {task.asset.room ? ` · ${task.asset.room}` : ''}
                  </p>
                  {task.cause && <p className="mt-1 text-sm">{task.cause}</p>}
                  {task.notes && (
                    <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-muted-foreground">
                      {task.notes}
                    </pre>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('maintenance.opened')}{' '}
                    {formatDateTime(task.createdAt, i18n.language, me.tenant.timeZone)}
                    {task.closedAt &&
                      ` · ${t('maintenance.closed')} ${formatDateTime(task.closedAt, i18n.language, me.tenant.timeZone)}`}
                  </p>
                </div>
                {MANAGE_ROLES.has(me.user.role) &&
                  (task.status === 'OPEN' || task.status === 'IN_PROGRESS') && (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {task.status === 'OPEN' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={update.isPending}
                          onClick={() => update.mutate({ id: task.id, status: 'IN_PROGRESS' })}
                        >
                          {t('maintenance.start')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        disabled={update.isPending}
                        onClick={() => update.mutate({ id: task.id, status: 'DONE' })}
                        data-testid="task-done"
                      >
                        {t('maintenance.done')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={update.isPending}
                        onClick={() => update.mutate({ id: task.id, status: 'CANCELLED' })}
                      >
                        {t('maintenance.cancel')}
                      </Button>
                    </div>
                  )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
