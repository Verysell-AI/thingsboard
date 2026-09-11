import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { cn } from '~/lib/utils';

export const REPORT_PAGES = [
  { key: 'mornings', to: '/reports/mornings' },
  { key: 'energyCost', to: '/reports/energy-cost' },
  { key: 'savings', to: '/reports/savings' },
  { key: 'assetFinancials', to: '/reports/asset-financials' },
] as const;

/** Tab strip shared by the report pages. */
export function ReportsNav() {
  const { t } = useTranslation();
  return (
    <nav role="tablist" className="flex flex-wrap gap-1 border-b" aria-label={t('nav.reports')}>
      {REPORT_PAGES.map((p) => (
        <NavLink
          key={p.key}
          to={p.to}
          role="tab"
          className={({ isActive }) =>
            cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )
          }
        >
          {t(`reports.pages.${p.key}`)}
        </NavLink>
      ))}
    </nav>
  );
}
