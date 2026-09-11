import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { SavingsReportSchema, type MeResponse } from '@platform/shared/dto';
import { ReportsNav } from '~/components/reports-nav';
import { SnapshotsPanel } from '~/components/snapshots-panel';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { api } from '~/lib/api';
import { formatDate, formatKwh, formatMoney } from '~/lib/format';

const READ_ROLES = new Set(['TENANT_ADMIN', 'OPS_MANAGER', 'FINANCE']);

export default function SavingsRoute() {
  const { t, i18n } = useTranslation();
  const me = useOutletContext<MeResponse>();
  const query = useQuery({
    queryKey: ['reports', 'savings'],
    queryFn: () => api.get('/reports/savings', SavingsReportSchema),
    enabled: READ_ROLES.has(me.user.role),
    staleTime: 5 * 60_000,
  });
  if (!READ_ROLES.has(me.user.role))
    return (
      <Alert variant="info" className="max-w-xl">
        <AlertDescription>{t('reports.forbidden')}</AlertDescription>
      </Alert>
    );
  const r = query.data;
  const l = i18n.language;
  return (
    <div className="flex flex-col gap-4" data-testid="savings-page">
      <div>
        <h1 className="text-xl font-semibold">{t('reports.savings.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('reports.savings.subtitle')}</p>
      </div>
      <ReportsNav />
      {query.isPending && <p className="text-sm text-muted-foreground">{t('app.loading')}</p>}
      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label={t('reports.savings.since')} value={formatDate(r.automationSince, l)} />
            <Tile
              label={t('reports.savings.window', {
                baseline: r.baselineWeeks,
                recent: r.recentWeeks,
              })}
              value={`${r.nights.filter((n) => n.baseline).length} / ${r.nights.filter((n) => !n.baseline).length}`}
            />
            <Tile
              label={t('reports.savings.totalKwh')}
              value={formatKwh(r.totalSavedKwh, l)}
              accent
            />
            <Tile
              label={t('reports.savings.totalCost')}
              value={formatMoney(r.totalSavedCost, r.currency, l)}
              accent
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{t('reports.savings.nights')}</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {r.nights.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('reports.savings.noData')}</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={r.nights} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 12 }} width={48} />
                    <Tooltip formatter={(v) => formatKwh(Number(v), l)} />
                    <Bar dataKey="kwh" isAnimationActive={false}>
                      {r.nights.map((n) => (
                        <Cell key={n.date} fill={n.baseline ? '#9ca3af' : 'var(--brand-accent)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('reports.savings.floor')}</TableHead>
                  <TableHead className="text-end">{t('reports.savings.baselineNight')}</TableHead>
                  <TableHead className="text-end">{t('reports.savings.recentNight')}</TableHead>
                  <TableHead className="text-end">{t('reports.savings.savedNight')}</TableHead>
                  <TableHead className="text-end">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.floors.map((f) => (
                  <TableRow key={f.floor}>
                    <TableCell className="font-medium">
                      {t('floor.title', { floor: f.floor })}
                    </TableCell>
                    <TableCell className="text-end" dir="ltr">
                      {formatKwh(f.baselineNightKwh, l)}
                    </TableCell>
                    <TableCell className="text-end" dir="ltr">
                      {formatKwh(f.recentNightKwh, l)}
                    </TableCell>
                    <TableCell className="text-end font-semibold" dir="ltr">
                      {formatKwh(f.savedKwhPerNight, l)}
                    </TableCell>
                    <TableCell className="text-end" dir="ltr">
                      {Math.round(f.savedPct * 100)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">{t('reports.savings.note')}</p>
        </>
      )}
      <SnapshotsPanel kind="savings" me={me} />
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={accent ? 'text-xl font-semibold text-primary' : 'text-xl font-semibold'}
          dir="ltr"
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
