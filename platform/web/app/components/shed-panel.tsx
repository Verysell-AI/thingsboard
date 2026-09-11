import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Activity, RotateCcw, TrendingDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AutomationRunSchema,
  PeakStateResponseSchema,
  type MeResponse,
} from '@platform/shared/dto';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { api, isApiError } from '~/lib/api';
import { useLive } from '~/lib/live';

const SHED_ROLES = new Set(['TENANT_ADMIN', 'OPS_MANAGER', 'FIELD_OPERATOR']);
export const PEAK_KEY = ['automations', 'peak'] as const;

/** Peak-shedding state machine with "Shed now" / "Restore"; a viewer's click is refused with a toast-like alert. */
export function ShedPanel({ me }: { me: MeResponse }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const live = useLive();
  const query = useQuery({
    queryKey: PEAK_KEY,
    queryFn: () => api.get('/automations/peak/state', PeakStateResponseSchema),
    refetchInterval: 30_000,
  });
  const lastRun = live.events.find(
    (e) => e.kind === 'automation.run' && e.automationKey === 'peak_shedding',
  )?.id;
  useEffect(() => {
    if (lastRun) void queryClient.invalidateQueries({ queryKey: PEAK_KEY });
  }, [lastRun, queryClient]);
  const run = useMutation({
    mutationFn: (action: 'shed' | 'restore') =>
      api.post('/automations/peak_shedding/run', { action }, AutomationRunSchema),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PEAK_KEY });
      void queryClient.invalidateQueries({ queryKey: ['automations'] });
    },
  });
  const s = query.data;
  const fmt = (kw: number | null | undefined) =>
    kw === null || kw === undefined
      ? '—'
      : `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(kw)} kW`;
  const status = s?.state.status ?? 'NORMAL';
  const variant = status === 'NORMAL' ? 'success' : status === 'SHEDDING' ? 'warning' : 'secondary';
  const canShed = SHED_ROLES.has(me.user.role);
  return (
    <Card data-testid="shed-panel" data-status={status}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4" aria-hidden /> {t('energy.peak.title')}
          <Badge variant={variant}>{t(`energy.peak.status.${status}`)}</Badge>
        </CardTitle>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={run.isPending || !s}
            onClick={() => run.mutate('shed')}
            title={canShed ? undefined : t('energy.peak.forbidden')}
            data-testid="shed-now"
          >
            <TrendingDown aria-hidden /> {t('energy.peak.shedNow')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={run.isPending || !s || s.state.level === 0}
            onClick={() => run.mutate('restore')}
            data-testid="shed-restore"
          >
            <RotateCcw aria-hidden /> {t('energy.peak.restore')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Item label={t('energy.peak.load')} value={fmt(s?.buildingKw)} />
          <Item label={t('energy.peak.threshold')} value={fmt(s?.thresholdKw)} />
          <Item
            label={t('energy.peak.window')}
            value={
              s
                ? `${s.window} · ${s.inWindow ? t('energy.peak.inWindow') : t('energy.peak.outsideWindow')}`
                : '—'
            }
          />
          <Item
            label={t('energy.peak.title')}
            value={s ? t('energy.peak.level', { level: s.state.level, total: 3 }) : '—'}
          />
        </dl>
        {s && !s.enabled && (
          <p className="text-xs text-muted-foreground">{t('energy.peak.disabled')}</p>
        )}
        {s && s.state.steps.length > 0 && (
          <ul className="flex flex-wrap gap-2 text-xs" dir="ltr">
            {s.state.steps.map((step, i) => (
              <li key={i} className="rounded-md border px-2 py-1">
                {i + 1}. {step.step} · {step.undo.length}
              </li>
            ))}
          </ul>
        )}
        {run.isSuccess && (
          <p className="text-xs text-muted-foreground" data-testid="shed-result">
            {t('energy.peak.done', { count: Number(run.data.summary.commandsSent ?? 0) })}
          </p>
        )}
        {run.isError && (
          <Alert variant="destructive" data-testid="shed-error">
            <AlertDescription>
              {isApiError(run.error) && run.error.status === 403
                ? t('energy.peak.forbidden')
                : isApiError(run.error)
                  ? (run.error.detail ?? run.error.title)
                  : String(run.error)}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/60 px-2 py-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold" dir="ltr">
        {value}
      </dd>
    </div>
  );
}
