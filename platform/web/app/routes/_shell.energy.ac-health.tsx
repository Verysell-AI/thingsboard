import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useOutletContext } from 'react-router';
import { AcHealthReportSchema, type MeResponse } from '@platform/shared/dto';
import { assetDrawerLink } from '~/components/asset-drawer';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { api } from '~/lib/api';
import { formatDate } from '~/lib/format';

const STATUS_VARIANT = { healthy: 'success', watch: 'warning', alarm: 'destructive' } as const;

export default function AcHealthRoute() {
  const { t, i18n } = useTranslation();
  const me = useOutletContext<MeResponse>();
  const query = useQuery({
    queryKey: ['energy', 'ac-health'],
    queryFn: () => api.get('/energy/ac-health', AcHealthReportSchema),
    refetchInterval: 60_000,
  });
  const l = i18n.language;
  const n = (v: number | null, digits = 1) =>
    v === null ? '—' : new Intl.NumberFormat(l, { maximumFractionDigits: digits }).format(v);
  const items = query.data?.items ?? [];
  return (
    <div className="flex flex-col gap-4" data-testid="ac-health-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('energy.acHealth.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('energy.acHealth.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/maintenance">{t('nav.maintenance')}</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/energy">{t('energy.title')}</Link>
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {(['alarm', 'watch', 'healthy'] as const).map((s) => (
          <div key={s} className="rounded-lg border bg-card p-3">
            <div className="text-xs text-muted-foreground">{t(`energy.acHealth.status.${s}`)}</div>
            <div className="text-xl font-semibold" dir="ltr">
              {items.filter((i) => i.status === s).length}
            </div>
          </div>
        ))}
      </div>
      {query.isPending && <p className="text-sm text-muted-foreground">{t('app.loading')}</p>}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('assets.columns.code')}</TableHead>
              <TableHead>{t('assets.columns.location')}</TableHead>
              <TableHead>{t('assets.columns.status')}</TableHead>
              <TableHead className="text-end">{t('energy.acHealth.runtime')}</TableHead>
              <TableHead className="text-end">{t('energy.acHealth.current')}</TableHead>
              <TableHead className="text-end">{t('energy.acHealth.drift')}</TableHead>
              <TableHead>{t('assets.columns.warrantyEnd')}</TableHead>
              <TableHead>{t('energy.acHealth.task')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.assetId} data-testid="ac-unit" data-status={i.status}>
                <TableCell>
                  <Link
                    to={assetDrawerLink(i.assetId)}
                    className="font-medium underline-offset-2 hover:underline"
                    dir="ltr"
                  >
                    {i.code}
                  </Link>
                </TableCell>
                <TableCell dir="ltr">{i.room ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[i.status]}>
                    {t(`energy.acHealth.status.${i.status}`)}
                  </Badge>
                </TableCell>
                <TableCell className="text-end" dir="ltr">
                  {n(i.runtimeH, 0)} h
                </TableCell>
                <TableCell className="text-end" dir="ltr">
                  {n(i.currentNowA, 2)} A
                  {i.nominalCurrentA !== null && (
                    <span className="text-xs text-muted-foreground">
                      {' '}
                      / {n(i.nominalCurrentA, 1)} A
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-end" dir="ltr">
                  {i.currentDrift === null
                    ? '—'
                    : `${i.currentDrift > 0 ? '+' : ''}${Math.round(i.currentDrift * 100)}%`}
                </TableCell>
                <TableCell>{formatDate(i.warrantyEnd, l)}</TableCell>
                <TableCell>
                  {i.openTaskId ? (
                    <Link
                      to={`/maintenance?task=${i.openTaskId}`}
                      className="text-sm underline-offset-2 hover:underline"
                    >
                      {t('energy.acHealth.openTask')}
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {me.tenant.demoMode && (
        <p className="text-xs text-muted-foreground">{t('energy.acHealth.demoHint')}</p>
      )}
    </div>
  );
}
