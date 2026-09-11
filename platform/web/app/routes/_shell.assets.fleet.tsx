import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useOutletContext } from 'react-router';
import { FleetReportSchema, type FleetItem, type MeResponse } from '@platform/shared/dto';
import { assetDrawerLink } from '~/components/asset-drawer';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { api } from '~/lib/api';
import { formatDate, formatDateTime } from '~/lib/format';
import { cn } from '~/lib/utils';

type Flag = FleetItem['flags'][number];
const FLAG_VARIANT: Record<Flag, 'destructive' | 'warning' | 'secondary'> = {
  replace_soon: 'warning',
  reclaim: 'destructive',
  warranty_expiring: 'secondary',
  misplaced: 'destructive',
};

export default function FleetRoute() {
  const { t, i18n } = useTranslation();
  const me = useOutletContext<MeResponse>();
  const [filter, setFilter] = useState<Flag | 'all'>('all');
  const query = useQuery({
    queryKey: ['assets', 'fleet'],
    queryFn: () => api.get('/assets/fleet', FleetReportSchema),
    refetchInterval: 60_000,
    enabled: me.user.role !== 'FINANCE',
  });
  if (me.user.role === 'FINANCE')
    return (
      <Alert variant="info" className="max-w-xl">
        <AlertDescription>{t('reports.forbidden')}</AlertDescription>
      </Alert>
    );
  const r = query.data;
  const l = i18n.language;
  const items = (r?.items ?? []).filter((i) => filter === 'all' || i.flags.includes(filter));
  const tile = (key: Flag | 'all', value: number | undefined) => (
    <button
      key={key}
      type="button"
      onClick={() => setFilter(key)}
      className={cn(
        'rounded-lg border bg-card p-3 text-start',
        filter === key && 'ring-2 ring-primary',
      )}
      data-testid={`fleet-tile-${key}`}
    >
      <div className="text-xs text-muted-foreground">{t(`fleet.flags.${key}`)}</div>
      <div className="text-xl font-semibold" dir="ltr">
        {value ?? '—'}
      </div>
    </button>
  );
  return (
    <div className="flex flex-col gap-4" data-testid="fleet-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('fleet.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {r ? t('fleet.subtitle', { online: r.online, total: r.total }) : t('app.loading')}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/assets?class=laptop">{t('nav.assets')}</Link>
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tile('all', r?.total)}
        {tile('replace_soon', r?.replaceSoon)}
        {tile('reclaim', r?.reclaim)}
        {tile('warranty_expiring', r?.warrantyExpiring)}
        {tile('misplaced', r?.items.filter((i) => i.flags.includes('misplaced')).length)}
      </div>
      {r && items.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {t('fleet.empty')}
          </CardContent>
        </Card>
      )}
      {items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('assets.columns.code')}</TableHead>
                <TableHead>{t('assets.columns.custodian')}</TableHead>
                <TableHead>{t('employees.department')}</TableHead>
                <TableHead className="text-end">{t('fleet.battery')}</TableHead>
                <TableHead>{t('fleet.lastOnline')}</TableHead>
                <TableHead>{t('assets.columns.warrantyEnd')}</TableHead>
                <TableHead>{t('fleet.flagsLabel')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i) => (
                <TableRow key={i.assetId} data-testid="fleet-item">
                  <TableCell>
                    <Link
                      to={assetDrawerLink(i.assetId)}
                      className="font-medium underline-offset-2 hover:underline"
                      dir="ltr"
                    >
                      {i.code}
                    </Link>
                  </TableCell>
                  <TableCell>{i.custodian ?? '—'}</TableCell>
                  <TableCell>
                    {i.department
                      ? t(`departments.${i.department}`, { defaultValue: i.department })
                      : '—'}
                  </TableCell>
                  <TableCell className="text-end" dir="ltr">
                    {i.batteryHealthPct === null ? '—' : `${i.batteryHealthPct}%`}
                  </TableCell>
                  <TableCell>
                    {i.daysOffline === 0 ? (
                      <Badge variant="success">{t('status.online')}</Badge>
                    ) : (
                      <span>
                        {formatDateTime(i.lastOnlineAt, l, me.tenant.timeZone)}
                        {i.daysOffline !== null && (
                          <span className="text-xs text-muted-foreground">
                            {' '}
                            · {t('fleet.daysOffline', { count: i.daysOffline })}
                          </span>
                        )}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{formatDate(i.warrantyEnd, l)}</TableCell>
                  <TableCell className="flex flex-wrap gap-1">
                    {i.flags.map((f) => (
                      <Badge key={f} variant={FLAG_VARIANT[f]}>
                        {t(`fleet.flags.${f}`)}
                      </Badge>
                    ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
