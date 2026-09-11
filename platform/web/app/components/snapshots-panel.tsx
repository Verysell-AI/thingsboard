import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, FileDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ReportSchema, ReportsResponseSchema, type MeResponse } from '@platform/shared/dto';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { api, isApiError } from '~/lib/api';
import { formatDateTime } from '~/lib/format';

const GENERATE_ROLES = new Set(['TENANT_ADMIN', 'OPS_MANAGER']);

/** Stored snapshots of one report kind with PDF downloads, and "Snapshot now" for operations. */
export function SnapshotsPanel({
  kind,
  me,
}: {
  kind: 'energy-cost' | 'savings' | 'asset-financials';
  me: MeResponse;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const key = ['reports', 'snapshots', kind] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.get(`/reports?kind=${kind}&pageSize=12`, ReportsResponseSchema),
  });
  const snapshot = useMutation({
    mutationFn: () => api.post(`/reports/${kind}/run`, {}, ReportSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const download = useMutation({
    mutationFn: (r: { id: string; period: string }) =>
      api.download(`/reports/${r.id}/pdf`, `${me.tenant.key}-${kind}-${r.period}.pdf`),
  });
  const items = query.data?.items ?? [];
  const error = snapshot.error ?? download.error;
  return (
    <Card data-testid="snapshots-panel">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">{t('reports.snapshots.title')}</CardTitle>
          <CardDescription>{t('reports.snapshots.help')}</CardDescription>
        </div>
        {GENERATE_ROLES.has(me.user.role) && (
          <Button
            size="sm"
            variant="outline"
            disabled={snapshot.isPending}
            onClick={() => snapshot.mutate()}
            data-testid="snapshot-now"
          >
            <Camera aria-hidden /> {t('reports.snapshots.now')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('reports.snapshots.none')}</p>
        ) : (
          <ul className="divide-y text-sm">
            {items.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-3 py-2"
                data-testid="snapshot"
              >
                <span className="font-medium" dir="ltr">
                  {r.period}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(r.generatedAt, i18n.language, me.tenant.timeZone)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ms-auto"
                  disabled={download.isPending}
                  onClick={() => download.mutate({ id: r.id, period: r.period })}
                  data-testid="download-pdf"
                >
                  <FileDown aria-hidden /> PDF
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <Alert variant="destructive" className="mt-3">
            <AlertDescription>
              {isApiError(error) ? (error.detail ?? error.title) : String(error)}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
