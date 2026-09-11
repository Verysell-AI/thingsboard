import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  EnergyCostReportSchema,
  type EnergyCostReport,
  type MeResponse,
} from '@platform/shared/dto';
import { ReportsNav } from '~/components/reports-nav';
import { SnapshotsPanel } from '~/components/snapshots-panel';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Select } from '~/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { api } from '~/lib/api';
import { downloadCsv, toCsv } from '~/lib/csv';
import { formatKwh, formatMoney } from '~/lib/format';

const READ_ROLES = new Set(['TENANT_ADMIN', 'OPS_MANAGER', 'FINANCE']);
const COLOURS = [
  'var(--brand-primary)',
  'var(--brand-accent)',
  '#6b7280',
  '#0ea5e9',
  '#f59e0b',
  '#10b981',
];

/** Rows of the stacked chart: one per month with a key per department. Pure. */
export function chartRows(report: EnergyCostReport): Record<string, number | string>[] {
  return report.months.map((month) => {
    const row: Record<string, number | string> = { month };
    for (const r of report.rows) if (r.month === month) row[r.department] = r.cost;
    return row;
  });
}

export default function EnergyCostRoute() {
  const { t, i18n } = useTranslation();
  const me = useOutletContext<MeResponse>();
  const [months, setMonths] = useState(3);
  const query = useQuery({
    queryKey: ['reports', 'energy-cost', months],
    queryFn: () => api.get(`/reports/energy-cost?months=${months}`, EnergyCostReportSchema),
    enabled: READ_ROLES.has(me.user.role),
  });
  if (!READ_ROLES.has(me.user.role))
    return (
      <Alert variant="info" className="max-w-xl">
        <AlertDescription>{t('reports.forbidden')}</AlertDescription>
      </Alert>
    );
  const r = query.data;
  const l = i18n.language;
  const exportCsv = () => {
    if (!r) return;
    downloadCsv(
      `energy-cost-${r.months[0]}-${r.months[r.months.length - 1]}.csv`,
      toCsv(
        ['month', 'department', 'kwh', `cost_${r.currency}`],
        r.rows.map((x) => [x.month, x.department, x.kwh, x.cost]),
      ),
    );
  };
  return (
    <div className="flex flex-col gap-4" data-testid="energy-cost-page">
      <div>
        <h1 className="text-xl font-semibold">{t('reports.energyCost.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('reports.energyCost.subtitle')}</p>
      </div>
      <ReportsNav />
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={String(months)}
          onChange={(e) => setMonths(Number(e.target.value))}
          className="w-40"
        >
          {[3, 6, 12].map((m) => (
            <option key={m} value={m}>
              {t('reports.energyCost.months', { count: m })}
            </option>
          ))}
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={!r}
          data-testid="export-csv"
        >
          <Download aria-hidden /> {t('reports.exportCsv')}
        </Button>
      </div>
      {query.isPending && <p className="text-sm text-muted-foreground">{t('app.loading')}</p>}
      {r && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('reports.energyCost.chart')}</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows(r)} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} width={56} />
                  <Tooltip formatter={(v) => formatMoney(Number(v), r.currency, l)} />
                  <Legend />
                  {r.departments.map((d, i) => (
                    <Bar
                      key={d}
                      dataKey={d}
                      stackId="cost"
                      fill={COLOURS[i % COLOURS.length]}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('reports.energyCost.department')}</TableHead>
                  {r.months.map((m) => (
                    <TableHead key={m} className="text-end" dir="ltr">
                      {m}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.departments.map((d) => (
                  <TableRow key={d}>
                    <TableCell className="font-medium">
                      {t(`departments.${d}`, { defaultValue: d })}
                    </TableCell>
                    {r.months.map((m) => {
                      const row = r.rows.find((x) => x.month === m && x.department === d);
                      return (
                        <TableCell key={m} className="text-end" dir="ltr">
                          <div>{formatMoney(row?.cost ?? 0, r.currency, l)}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatKwh(row?.kwh ?? 0, l)}
                          </div>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell>{t('reports.total')}</TableCell>
                  {r.totals.map((m) => (
                    <TableCell key={m.month} className="text-end" dir="ltr">
                      <div>{formatMoney(m.cost, r.currency, l)}</div>
                      <div className="text-xs text-muted-foreground">{formatKwh(m.kwh, l)}</div>
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </>
      )}
      <SnapshotsPanel kind="energy-cost" me={me} />
    </div>
  );
}
