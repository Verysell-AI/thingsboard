import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { FinancialsReportSchema, type MeResponse } from '@platform/shared/dto';
import { api } from '~/lib/api';
import { formatMoney } from '~/lib/format';

/** Register footer: purchase cost, book value and yearly depreciation across the register. */
export function RegisterTotals({ me }: { me: MeResponse }) {
  const { t, i18n } = useTranslation();
  const query = useQuery({
    queryKey: ['reports', 'asset-financials'],
    queryFn: () => api.get('/reports/asset-financials', FinancialsReportSchema),
    staleTime: 5 * 60_000,
  });
  const r = query.data;
  if (!r) return null;
  const money = (v: number) => formatMoney(v, r.currency ?? me.tenant.currency, i18n.language);
  return (
    <Link
      to="/reports/asset-financials"
      className="grid grid-cols-2 gap-3 rounded-lg border bg-card p-3 text-sm hover:bg-muted/40 sm:grid-cols-4"
      data-testid="register-totals"
    >
      <Item label={t('reports.financials.assets')} value={String(r.totals.assets)} />
      <Item label={t('reports.financials.purchaseCost')} value={money(r.totals.purchaseCost)} />
      <Item label={t('reports.financials.bookValue')} value={money(r.totals.bookValue)} />
      <Item
        label={t('reports.financials.annualDepreciation')}
        value={money(r.totals.annualDepreciation)}
      />
    </Link>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold" dir="ltr">
        {value}
      </div>
    </div>
  );
}
