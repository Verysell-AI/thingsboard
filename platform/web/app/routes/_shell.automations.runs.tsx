import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useOutletContext, useSearchParams } from 'react-router';
import {
  AUTOMATION_KEYS,
  AutomationRunsResponseSchema,
  type AutomationRun,
  type MeResponse,
} from '@platform/shared/dto';
import { RunSummary } from '~/components/run-summary';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Select } from '~/components/ui/select';
import { Sheet } from '~/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { api } from '~/lib/api';
import { summarizeRun } from '~/lib/automations';
import { formatClockDate, formatClockTime } from '~/lib/clock';
import { formatDateTime } from '~/lib/format';

const PAGE_SIZE = 25;

export default function AutomationRunsRoute() {
  const { t, i18n } = useTranslation();
  const me = useOutletContext<MeResponse>();
  const [params, setParams] = useSearchParams();
  const key = params.get('key') ?? '';
  const page = Number(params.get('page') ?? '0');
  const [selected, setSelected] = useState<AutomationRun | null>(null);
  const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (key) qs.set('key', key);
  const query = useQuery({
    queryKey: ['automation-runs', qs.toString()],
    queryFn: () => api.get(`/automations/runs?${qs}`, AutomationRunsResponseSchema),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
  const setParam = (k: string, v: string) => {
    const sp = new URLSearchParams(params);
    if (v) sp.set(k, v);
    else sp.delete(k);
    if (k !== 'page') sp.delete('page');
    setParams(sp, { replace: true });
  };
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const tz = me.tenant.timeZone;
  const l = i18n.language;

  return (
    <div className="flex flex-col gap-4" data-testid="automation-runs-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" aria-label={t('automations.back')}>
            <Link to="/automations">
              <ArrowLeft className="rtl:rotate-180" aria-hidden />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{t('automations.runs')}</h1>
            <p className="text-sm text-muted-foreground">{t('automations.runsSubtitle')}</p>
          </div>
        </div>
        <Select
          aria-label={t('automations.filterKey')}
          value={key}
          onChange={(e) => setParam('key', e.target.value)}
          className="w-52"
        >
          <option value="">{t('automations.allKeys')}</option>
          {AUTOMATION_KEYS.map((k) => (
            <option key={k} value={k}>
              {t(`automations.names.${k}`)}
            </option>
          ))}
        </Select>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('automations.columns.automation')}</TableHead>
            <TableHead>{t('automations.columns.businessTime')}</TableHead>
            <TableHead>{t('automations.columns.started')}</TableHead>
            <TableHead>{t('automations.columns.trigger')}</TableHead>
            <TableHead>{t('automations.summary.roomsOff')}</TableHead>
            <TableHead>{t('automations.summary.roomsSkipped')}</TableHead>
            <TableHead>{t('automations.summary.commands')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(query.data?.items ?? []).map((run) => {
            const s = summarizeRun(run);
            return (
              <TableRow
                key={run.id}
                className="cursor-pointer hover:bg-muted/40"
                onClick={() => setSelected(run)}
                data-run={run.id}
              >
                <TableCell className="font-medium">
                  {t(`automations.names.${run.key}`, { defaultValue: run.key })}
                </TableCell>
                <TableCell className="whitespace-nowrap" dir="ltr">
                  {s.businessTime !== null
                    ? `${formatClockDate(s.businessTime, tz, l)} ${formatClockTime(s.businessTime, tz, l, { seconds: false })}`
                    : '—'}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground" dir="ltr">
                  {formatDateTime(run.startedAt, l, tz)}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {t(`automations.trigger.${s.trigger ?? 'schedule'}`, {
                      defaultValue: s.trigger ?? '',
                    })}
                  </Badge>
                </TableCell>
                <TableCell dir="ltr">{s.roomsOff.length}</TableCell>
                <TableCell dir="ltr">{s.roomsSkipped.length}</TableCell>
                <TableCell dir="ltr">{s.commandsSent}</TableCell>
              </TableRow>
            );
          })}
          {!query.isPending && total === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                {t('automations.noRuns')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{t('assets.page', { page: page + 1, pages })}</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setParam('page', String(page - 1))}
          >
            {t('assets.prev')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= pages}
            onClick={() => setParam('page', String(page + 1))}
          >
            {t('assets.next')}
          </Button>
        </div>
      </div>
      <Sheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={
          selected ? t(`automations.names.${selected.key}`, { defaultValue: selected.key }) : ''
        }
        description={selected?.id}
        closeLabel={t('floor.close')}
      >
        {selected && <RunSummary run={selected} timeZone={tz} detailed />}
      </Sheet>
    </div>
  );
}
