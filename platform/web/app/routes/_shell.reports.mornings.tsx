import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, FileText, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router';
import {
  MorningReportDataSchema,
  ReportSchema,
  ReportsResponseSchema,
  type MeResponse,
  type MorningReportData,
  type Report,
} from '@platform/shared/dto';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { api, isApiError } from '~/lib/api';
import { formatDate, formatDateTime, formatKwh, formatMoney } from '~/lib/format';

const GENERATE_ROLES = new Set(['TENANT_ADMIN', 'OPS_MANAGER']);
const READ_ROLES = new Set(['TENANT_ADMIN', 'OPS_MANAGER', 'FINANCE']);
export const REPORTS_KEY = ['reports', 'morning'] as const;

/** Reads the loosely typed report payload; a report from an older shape still renders. */
export function morningData(report: Report): MorningReportData | null {
  const parsed = MorningReportDataSchema.safeParse(report.data);
  return parsed.success ? parsed.data : null;
}

export default function MorningReportsRoute() {
  const { t, i18n } = useTranslation();
  const me = useOutletContext<MeResponse>();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: REPORTS_KEY,
    queryFn: () => api.get('/reports?kind=morning&pageSize=30', ReportsResponseSchema),
    enabled: READ_ROLES.has(me.user.role),
  });
  const generate = useMutation({
    mutationFn: () => api.post('/reports/morning/run', {}, ReportSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: REPORTS_KEY }),
  });

  if (!READ_ROLES.has(me.user.role)) {
    return (
      <Alert variant="info" className="max-w-xl">
        <AlertDescription>{t('reports.forbidden')}</AlertDescription>
      </Alert>
    );
  }
  const items = query.data?.items ?? [];
  return (
    <div className="flex flex-col gap-4" data-testid="reports-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('reports.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('reports.subtitle')}</p>
        </div>
        {GENERATE_ROLES.has(me.user.role) && (
          <Button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            data-testid="generate-report"
          >
            <RefreshCw className={generate.isPending ? 'animate-spin' : undefined} aria-hidden />{' '}
            {t('reports.generate')}
          </Button>
        )}
      </div>
      {generate.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {isApiError(generate.error)
              ? (generate.error.detail ?? generate.error.title)
              : String(generate.error)}
          </AlertDescription>
        </Alert>
      )}
      {query.isPending && <p className="text-sm text-muted-foreground">{t('app.loading')}</p>}
      {!query.isPending && items.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
            <FileText className="size-6" aria-hidden />
            {t('reports.none')}
          </CardContent>
        </Card>
      )}
      {items.map((r) => (
        <MorningReportCard key={r.id} report={r} me={me} locale={i18n.language} />
      ))}
    </div>
  );
}

function MorningReportCard({
  report,
  me,
  locale,
}: {
  report: Report;
  me: MeResponse;
  locale: string;
}) {
  const { t } = useTranslation();
  const data = morningData(report);
  const sweep = data?.sweep ?? null;
  const currency = data?.currency ?? me.tenant.currency;
  return (
    <Card data-testid="morning-report">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>
            {t('reports.period')} {formatDate(report.period, locale)}
          </CardTitle>
          <CardDescription>
            {t('reports.generatedAt')}{' '}
            {formatDateTime(report.generatedAt, locale, me.tenant.timeZone)}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data && (
            <Badge variant={data.emailedTo.length ? 'success' : 'secondary'}>
              {data.emailedTo.length
                ? `${t('reports.emailedTo')} ${data.emailedTo.join(', ')}`
                : t('reports.notEmailed')}
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              api.download(
                `/reports/${report.id}/pdf`,
                `${me.tenant.key}-morning-${report.period}.pdf`,
              )
            }
            data-testid="download-pdf"
          >
            <FileDown aria-hidden /> PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!sweep && <p className="text-sm text-muted-foreground">{t('reports.noSweep')}</p>}
        {sweep && (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label={t('reports.roomsOff')} value={String(sweep.roomsOff.length)} />
              <Stat label={t('reports.roomsKept')} value={String(sweep.roomsSkipped.length)} />
              <Stat
                label={
                  sweep.measuredKwhSaved === null
                    ? t('reports.saving')
                    : t('reports.measuredSaving')
                }
                value={formatKwh(sweep.measuredKwhSaved ?? sweep.estimatedKwhSaved, locale)}
              />
              <Stat
                label={t('reports.cost')}
                value={formatMoney(
                  sweep.measuredCostSaved ?? sweep.estimatedCostSaved,
                  currency,
                  locale,
                )}
              />
            </dl>
            {sweep.measuredKwhSaved === null && (
              <p className="text-xs text-muted-foreground">{t('reports.estimatedNote')}</p>
            )}
            {sweep.roomsOff.length > 0 && (
              <p className="text-sm">
                <span className="text-muted-foreground">{t('reports.roomsOff')}: </span>
                <span dir="ltr">{sweep.roomsOff.join(', ')}</span>
              </p>
            )}
            {sweep.zonesKept.length > 0 && (
              <p className="text-sm">
                <span className="text-muted-foreground">{t('reports.zonesKept')}: </span>
                {sweep.zonesKept
                  .map((z) => `${z.zone}${z.employee ? ` (${z.employee})` : ''}`)
                  .join(', ')}
              </p>
            )}
            {sweep.roomsSkipped.length > 0 && (
              <ul className="flex flex-col gap-0.5 text-sm">
                {sweep.roomsSkipped.map((r, i) => (
                  <li key={`${r.room}-${i}`}>
                    <span dir="ltr" className="font-medium">
                      {r.room}
                    </span>{' '}
                    · {t(`automations.reasons.${r.reason}`, { defaultValue: r.reason })}
                    {r.detail && <span className="text-muted-foreground"> ({r.detail})</span>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {data && (
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Stat label={t('reports.alarms')} value={String(data.alarmsOvernight)} />
            <Stat label={t('reports.released')} value={String(data.releasedBookings)} />
            <Stat
              label={t('reports.unreachable')}
              value={data.unreachableAssets.length ? data.unreachableAssets.join(', ') : '0'}
            />
            <Stat
              label={t('reports.misplaced')}
              value={
                data.misplacedAssets.length
                  ? data.misplacedAssets.map((m) => `${m.code} → ${m.room}`).join(', ')
                  : '0'
              }
            />
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/60 px-2 py-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold break-words" dir="ltr">
        {value}
      </dd>
    </div>
  );
}
