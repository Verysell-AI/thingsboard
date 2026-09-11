import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Play, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useOutletContext } from 'react-router';
import {
  AutomationRunSchema,
  AutomationSchema,
  AutomationsResponseSchema,
  type Automation,
  type AutomationKey,
  type MeResponse,
} from '@platform/shared/dto';
import { AutomationParamsForm, type ParamValues } from '~/components/automation-params-form';
import { HoldsCard } from '~/components/holds-card';
import { RunSummary } from '~/components/run-summary';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Switch } from '~/components/ui/switch';
import { api, isApiError } from '~/lib/api';
import { paramFields, paramsFromForm } from '~/lib/automations';
import { useLive } from '~/lib/live';

const MANAGE_ROLES = new Set(['TENANT_ADMIN', 'OPS_MANAGER']);
const RUN_ROLES = new Set(['TENANT_ADMIN', 'OPS_MANAGER', 'FIELD_OPERATOR']);
export const AUTOMATIONS_KEY = ['automations'] as const;

export default function AutomationsRoute() {
  const { t } = useTranslation();
  const me = useOutletContext<MeResponse>();
  const live = useLive();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: AUTOMATIONS_KEY,
    queryFn: () => api.get('/automations', AutomationsResponseSchema),
    refetchInterval: 60_000,
  });
  const lastRunEvent = live.events.find((e) => e.kind === 'automation.run')?.id;
  useEffect(() => {
    if (lastRunEvent) void queryClient.invalidateQueries({ queryKey: AUTOMATIONS_KEY });
  }, [lastRunEvent, queryClient]);

  if (me.user.role === 'FINANCE') {
    return (
      <Alert variant="info" className="max-w-xl">
        <AlertDescription>{t('automations.forbidden')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="automations-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('automations.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('automations.subtitle')}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/automations/runs">
            <History aria-hidden /> {t('automations.viewRuns')}
          </Link>
        </Button>
      </div>
      {query.isPending && <p className="text-sm text-muted-foreground">{t('app.loading')}</p>}
      {query.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {isApiError(query.error) ? (query.error.detail ?? query.error.title) : t('app.error')}
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {(query.data?.items ?? []).map((a) => (
          <AutomationCard
            key={a.key}
            automation={a}
            canManage={MANAGE_ROLES.has(me.user.role)}
            canRun={RUN_ROLES.has(me.user.role)}
            timeZone={me.tenant.timeZone}
          />
        ))}
        <HoldsCard me={me} canManage={MANAGE_ROLES.has(me.user.role)} />
      </div>
    </div>
  );
}

function AutomationCard({
  automation,
  canManage,
  canRun,
  timeZone,
}: {
  automation: Automation;
  canManage: boolean;
  canRun: boolean;
  timeZone: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const key = automation.key as AutomationKey;
  const fields = paramFields(key);
  const [values, setValues] = useState<ParamValues>(() => initialValues(automation));
  const [dirty, setDirty] = useState(false);
  // a refetch (e.g. after a live run) replaces untouched edits with the server state
  useEffect(() => {
    if (!dirty) setValues(initialValues(automation));
  }, [automation, dirty]);

  const patch = useMutation({
    mutationFn: (body: { enabled?: boolean; params?: Record<string, unknown> }) =>
      api.patch(`/automations/${key}`, body, AutomationSchema),
    onSuccess: () => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: AUTOMATIONS_KEY });
    },
  });
  const run = useMutation({
    mutationFn: () => api.post(`/automations/${key}/run`, {}, AutomationRunSchema),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AUTOMATIONS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['automation-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['rooms'] });
    },
  });
  const error = patch.error ?? run.error;

  return (
    <Card data-testid={`automation-${key}`} data-enabled={automation.enabled}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2">
            {t(`automations.names.${key}`)}
            <Badge variant={automation.enabled ? 'success' : 'secondary'}>
              {automation.enabled ? t('automations.enabled') : t('automations.disabled')}
            </Badge>
          </CardTitle>
          <CardDescription>{t(`automations.descriptions.${key}`)}</CardDescription>
        </div>
        <Switch
          checked={automation.enabled}
          disabled={!canManage || patch.isPending}
          title={canManage ? undefined : t('automations.noPermission')}
          aria-label={t('automations.enabledToggle', { name: t(`automations.names.${key}`) })}
          onCheckedChange={(enabled) => patch.mutate({ enabled })}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            patch.mutate({ params: paramsFromForm(fields, values) });
          }}
        >
          <AutomationParamsForm
            automationKey={key}
            fields={fields}
            values={values}
            disabled={!canManage || patch.isPending}
            onChange={(next) => {
              setValues(next);
              setDirty(true);
            }}
          />
          <div className="flex flex-wrap gap-2">
            {canManage && (
              <Button type="submit" size="sm" disabled={!dirty || patch.isPending}>
                <Save aria-hidden /> {t('automations.save')}
              </Button>
            )}
            {canRun && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={run.isPending}
                onClick={() => run.mutate()}
                data-testid={`run-${key}`}
              >
                <Play aria-hidden /> {run.isPending ? t('app.loading') : t('automations.runNow')}
              </Button>
            )}
          </div>
        </form>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {isApiError(error) ? (error.detail ?? error.title) : String(error)}
            </AlertDescription>
          </Alert>
        )}
        <div>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('automations.lastRun')}
          </h3>
          {automation.lastRun ? (
            <RunSummary run={automation.lastRun} timeZone={timeZone} />
          ) : (
            <p className="text-sm text-muted-foreground">{t('automations.neverRan')}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function initialValues(a: Automation): ParamValues {
  const fields = paramFields(a.key as AutomationKey);
  const out: ParamValues = {};
  for (const f of fields) {
    const stored = a.params[f.key];
    out[f.key] = stored !== undefined ? stored : f.default;
  }
  return out;
}
