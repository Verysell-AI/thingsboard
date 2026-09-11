import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useOutletContext } from 'react-router';
import { StandbyReportSchema, type MeResponse } from '@platform/shared/dto';
import { assetDrawerLink } from '~/components/asset-drawer';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { api, isApiError } from '~/lib/api';
import { formatKwh, formatMoney, formatPowerW } from '~/lib/format';

const ACK_ROLES = new Set(['TENANT_ADMIN', 'OPS_MANAGER']);
export const STANDBY_KEY = ['energy', 'standby'] as const;

export default function StandbyRoute() {
  const { t, i18n } = useTranslation();
  const me = useOutletContext<MeResponse>();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: STANDBY_KEY,
    queryFn: () => api.get('/energy/standby', StandbyReportSchema),
  });
  const ack = useMutation({
    mutationFn: ({ assetId, acknowledged }: { assetId: string; acknowledged: boolean }) =>
      api.post(`/energy/standby/${assetId}/ack`, { acknowledged }, StandbyReportSchema),
    onSuccess: (data) => queryClient.setQueryData(STANDBY_KEY, data),
  });
  const r = query.data;
  const l = i18n.language;
  return (
    <div className="flex flex-col gap-4" data-testid="standby-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('energy.standby.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('energy.standby.subtitle', { nights: r?.windowNights ?? 7 })}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/energy">{t('energy.title')}</Link>
        </Button>
      </div>
      {r && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label={t('energy.standby.devices')}
            value={String(r.items.filter((i) => !i.acknowledged).length)}
          />
          <Stat label={t('energy.standby.kwhYear')} value={formatKwh(r.totalKwhPerYear, l, 0)} />
          <Stat
            label={t('energy.standby.costYear')}
            value={formatMoney(r.totalCostPerYear, r.currency, l)}
            accent
          />
          <Stat
            label={t('energy.standby.acknowledged')}
            value={String(r.items.filter((i) => i.acknowledged).length)}
          />
        </div>
      )}
      {query.isPending && <p className="text-sm text-muted-foreground">{t('app.loading')}</p>}
      {r && r.items.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {t('energy.standby.empty')}
          </CardContent>
        </Card>
      )}
      {ack.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {isApiError(ack.error) ? (ack.error.detail ?? ack.error.title) : String(ack.error)}
          </AlertDescription>
        </Alert>
      )}
      {r && r.items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('assets.columns.code')}</TableHead>
                <TableHead>{t('assets.columns.location')}</TableHead>
                <TableHead className="text-end">{t('energy.standby.avgNight')}</TableHead>
                <TableHead className="text-end">{t('energy.standby.nights')}</TableHead>
                <TableHead className="text-end">{t('energy.standby.kwhYear')}</TableHead>
                <TableHead className="text-end">{t('energy.standby.costYear')}</TableHead>
                <TableHead>{t('energy.standby.recommendation')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.items.map((i) => (
                <TableRow
                  key={i.assetId}
                  data-testid="standby-item"
                  data-acknowledged={i.acknowledged}
                >
                  <TableCell>
                    <Link
                      to={assetDrawerLink(i.assetId)}
                      className="font-medium underline-offset-2 hover:underline"
                      dir="ltr"
                    >
                      {i.code}
                    </Link>
                    <div className="text-xs text-muted-foreground">{i.name}</div>
                  </TableCell>
                  <TableCell dir="ltr">{i.room ?? '—'}</TableCell>
                  <TableCell className="text-end" dir="ltr">
                    {formatPowerW(i.avgNightPowerW, l)}
                  </TableCell>
                  <TableCell className="text-end" dir="ltr">
                    {i.nightsFlagged} / {i.nightsObserved}
                  </TableCell>
                  <TableCell className="text-end" dir="ltr">
                    {formatKwh(i.kwhPerYear, l, 0)}
                  </TableCell>
                  <TableCell className="text-end" dir="ltr">
                    {formatMoney(i.costPerYear, r.currency, l)}
                  </TableCell>
                  <TableCell className="max-w-64 whitespace-normal text-xs">
                    {i.acknowledged ? (
                      <Badge variant="secondary">
                        {t('energy.standby.acceptedBy', { by: i.acknowledgedBy ?? '—' })}
                      </Badge>
                    ) : (
                      t('energy.standby.recommendationText')
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    {ACK_ROLES.has(me.user.role) && (
                      <Button
                        size="sm"
                        variant={i.acknowledged ? 'ghost' : 'outline'}
                        disabled={ack.isPending}
                        onClick={() =>
                          ack.mutate({ assetId: i.assetId, acknowledged: !i.acknowledged })
                        }
                        data-testid={i.acknowledged ? 'unacknowledge' : 'acknowledge'}
                      >
                        {i.acknowledged ? <Undo2 aria-hidden /> : <Check aria-hidden />}
                        {i.acknowledged ? t('energy.standby.reopen') : t('energy.standby.accept')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
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
