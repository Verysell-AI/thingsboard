import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router';
import { FinancialsReportSchema, type MeResponse } from '@platform/shared/dto';
import { ReportsNav } from '~/components/reports-nav';
import { SnapshotsPanel } from '~/components/snapshots-panel';
import { Alert, AlertDescription } from '~/components/ui/alert';
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
import { downloadCsv, toCsv } from '~/lib/csv';
import { formatDate, formatMoney } from '~/lib/format';

const READ_ROLES = new Set(['TENANT_ADMIN', 'OPS_MANAGER', 'FINANCE']);
export const FINANCIALS_KEY = ['reports', 'asset-financials'] as const;

export default function AssetFinancialsRoute() {
  const { t, i18n } = useTranslation();
  const me = useOutletContext<MeResponse>();
  const query = useQuery({
    queryKey: FINANCIALS_KEY,
    queryFn: () => api.get('/reports/asset-financials', FinancialsReportSchema),
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
  const money = (v: number) => formatMoney(v, r?.currency ?? me.tenant.currency, l);
  return (
    <div className="flex flex-col gap-4" data-testid="financials-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('reports.financials.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('reports.financials.subtitle')}{' '}
            {r && `· ${t('reports.financials.asOf')} ${formatDate(r.asOf, l)}`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!r}
          onClick={() =>
            r &&
            downloadCsv(
              `asset-financials-${r.asOf}.csv`,
              toCsv(
                [
                  'category',
                  'assets',
                  `purchase_cost_${r.currency}`,
                  `book_value_${r.currency}`,
                  `annual_depreciation_${r.currency}`,
                ],
                r.categories.map((c) => [
                  c.category,
                  c.assets,
                  c.purchaseCost,
                  c.bookValue,
                  c.annualDepreciation,
                ]),
              ),
            )
          }
        >
          <Download aria-hidden /> {t('reports.exportCsv')}
        </Button>
      </div>
      <ReportsNav />
      {query.isPending && <p className="text-sm text-muted-foreground">{t('app.loading')}</p>}
      {r && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('assets.columns.category')}</TableHead>
                <TableHead className="text-end">{t('reports.financials.assets')}</TableHead>
                <TableHead className="text-end">{t('reports.financials.purchaseCost')}</TableHead>
                <TableHead className="text-end">{t('reports.financials.bookValue')}</TableHead>
                <TableHead className="text-end">
                  {t('reports.financials.annualDepreciation')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.categories.map((c) => (
                <TableRow key={c.category}>
                  <TableCell className="font-medium">{c.category}</TableCell>
                  <TableCell className="text-end" dir="ltr">
                    {c.assets}
                  </TableCell>
                  <TableCell className="text-end" dir="ltr">
                    {money(c.purchaseCost)}
                  </TableCell>
                  <TableCell className="text-end" dir="ltr">
                    {money(c.bookValue)}
                  </TableCell>
                  <TableCell className="text-end" dir="ltr">
                    {money(c.annualDepreciation)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold" data-testid="financials-total">
                <TableCell>{t('reports.total')}</TableCell>
                <TableCell className="text-end" dir="ltr">
                  {r.totals.assets}
                </TableCell>
                <TableCell className="text-end" dir="ltr">
                  {money(r.totals.purchaseCost)}
                </TableCell>
                <TableCell className="text-end" dir="ltr">
                  {money(r.totals.bookValue)}
                </TableCell>
                <TableCell className="text-end" dir="ltr">
                  {money(r.totals.annualDepreciation)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
      <SnapshotsPanel kind="asset-financials" me={me} />
    </div>
  );
}
