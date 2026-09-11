import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  AssetDetailSchema,
  AssetSchema,
  EmployeesResponseSchema,
  HistoryResponseSchema,
  type AssetDetail,
  type MeResponse,
  MaintenanceResponseSchema,
} from '@platform/shared/dto';
import { AssetActions } from '~/components/asset-actions';
import { DeviceGlyph } from '~/components/device-glyph';
import { HistoryChart } from '~/components/history-chart';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
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
import { Tabs } from '~/components/ui/tabs';
import { api, isApiError } from '~/lib/api';
import { historyKeysFor } from '~/lib/assets';
import { deviceDot, deviceIcon, deviceKindKey, deviceStatus } from '~/lib/device-icons';
import { formatAgo, formatDate, formatDateTime, formatMoney, formatValues } from '~/lib/format';
import { useLive } from '~/lib/live';

type Tab = 'overview' | 'live' | 'history' | 'custody' | 'actions' | 'audit';
const TABS: Tab[] = ['overview', 'live', 'history', 'custody', 'actions', 'audit'];
const CUSTODY_ROLES = new Set(['TENANT_ADMIN', 'OPS_MANAGER']);

export const ASSET_STATUS_VARIANT: Record<
  AssetDetail['status'],
  'success' | 'secondary' | 'warning' | 'destructive'
> = {
  ACTIVE: 'success',
  IN_STOCK: 'secondary',
  IN_REPAIR: 'warning',
  RETIRED: 'secondary',
  MISSING: 'destructive',
};

/** The asset record as a side sheet, linkable through `?asset=<id>`. */
export function AssetDrawer({
  assetId,
  me,
  onClose,
}: {
  assetId: string | null;
  me: MeResponse;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('overview');
  const query = useQuery({
    queryKey: ['asset', assetId],
    queryFn: () => api.get(`/assets/${assetId}`, AssetDetailSchema),
    enabled: assetId !== null,
  });
  const asset = query.data;

  return (
    <Sheet
      open={assetId !== null}
      onClose={onClose}
      closeLabel={t('floor.close')}
      title={
        asset ? (
          <span className="flex items-center gap-2">
            <DeviceGlyph
              icon={deviceIcon({ type: asset.deviceType ?? asset.type, code: asset.code })}
              dot={null}
              size="sm"
            />
            {asset.name}
          </span>
        ) : (
          t('app.loading')
        )
      }
      description={
        asset
          ? `${asset.code} · ${t(deviceKindKey({ type: asset.deviceType ?? asset.type, code: asset.code, appliance: asset.appliance }))}`
          : undefined
      }
    >
      {query.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {isApiError(query.error) ? (query.error.detail ?? query.error.title) : t('app.error')}
          </AlertDescription>
        </Alert>
      )}
      {asset && (
        <div className="flex flex-col gap-4" data-testid="asset-drawer">
          <Tabs
            items={TABS.map((k) => ({ key: k, label: t(`assets.tabs.${k}`) }))}
            value={tab}
            onChange={setTab}
          />
          {tab === 'overview' && <OverviewTab asset={asset} me={me} />}
          {tab === 'live' && <LiveTab asset={asset} me={me} />}
          {tab === 'history' && <HistoryTab asset={asset} me={me} />}
          {tab === 'custody' && <CustodyTab asset={asset} me={me} />}
          {tab === 'actions' && <ActionsTab asset={asset} me={me} />}
          {tab === 'audit' && <AuditTab asset={asset} me={me} />}
        </div>
      )}
    </Sheet>
  );
}

function Field({ label, value, ltr }: { label: string; value: React.ReactNode; ltr?: boolean }) {
  return (
    <div className="rounded-md bg-muted/60 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words" dir={ltr ? 'ltr' : undefined}>
        {value ?? '—'}
      </dd>
    </div>
  );
}

function OverviewTab({ asset, me }: { asset: AssetDetail; me: MeResponse }) {
  const { t, i18n } = useTranslation();
  const currency = me.tenant.currency;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={ASSET_STATUS_VARIANT[asset.status]}>
          {t(`assets.status.${asset.status}`)}
        </Badge>
        {asset.misplacedRoom && (
          <Badge variant="destructive">
            {t('assets.misplacedIn', { room: asset.misplacedRoom.code })}
          </Badge>
        )}
        <OpenTaskBadge assetId={asset.id} role={me.user.role} />
        {asset.location && (
          <Badge variant="outline">
            {asset.location.floor !== null
              ? `${t('floor.title', { floor: asset.location.floor })} · `
              : ''}
            {asset.location.name}
          </Badge>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Field label={t('assets.columns.code')} value={asset.code} ltr />
        <Field label={t('assets.columns.class')} value={`${asset.class} / ${asset.type}`} />
        <Field label={t('assets.columns.brand')} value={asset.brand} />
        <Field label={t('assets.columns.model')} value={asset.model} />
        <Field label={t('assets.columns.serial')} value={asset.serial} ltr />
        <Field label={t('assets.columns.category')} value={asset.category} />
        <Field
          label={t('assets.columns.custodian')}
          value={asset.custodian ? `${asset.custodian.name} · ${asset.custodian.department}` : null}
        />
        <Field
          label={t('assets.columns.purchaseDate')}
          value={formatDate(asset.purchaseDate, i18n.language)}
        />
        <Field
          label={t('assets.columns.purchaseCost')}
          value={formatMoney(asset.purchaseCost, currency, i18n.language)}
        />
        <Field
          label={t('assets.columns.bookValue')}
          value={formatMoney(asset.bookValue, currency, i18n.language)}
        />
        <Field
          label={t('assets.columns.usefulLife')}
          value={asset.usefulLifeYears ? t('assets.years', { count: asset.usefulLifeYears }) : null}
        />
        <Field
          label={t('assets.columns.warrantyEnd')}
          value={formatDate(asset.warrantyEnd, i18n.language)}
        />
      </dl>
      {Object.keys(asset.attributes).length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('assets.attributes')}
          </h3>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {Object.entries(asset.attributes).map(([k, v]) => (
              <Field key={k} label={k} value={v === null ? '—' : String(v)} ltr />
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function LiveTab({ asset, me }: { asset: AssetDetail; me: MeResponse }) {
  const { t, i18n } = useTranslation();
  const live = useLive().devices[asset.code];
  if (!asset.tbDeviceId) {
    return <p className="text-sm text-muted-foreground">{t('assets.noDevice')}</p>;
  }
  const device = {
    type: asset.deviceType ?? asset.type,
    code: asset.code,
    appliance: asset.appliance,
  };
  const status = deviceStatus(device, live);
  const values = live ? formatValues(live.values, t, i18n.language) : [];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <DeviceGlyph icon={deviceIcon(device)} dot={deviceDot(device, live)} size="lg" />
        <div>
          <Badge
            variant={
              status === 'alarm'
                ? 'destructive'
                : status === 'on' || status === 'online'
                  ? 'success'
                  : 'secondary'
            }
          >
            {asset.appliance === 'projector' && status === 'on'
              ? t('assets.inUse')
              : t(`status.${status}`)}
          </Badge>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('floor.lastUpdate', { ago: formatAgo(live?.ts, t, i18n.language) })} ·{' '}
            {t('clock.zone', { zone: me.tenant.timeZone })}
          </p>
        </div>
      </div>
      {live?.activeAlarms.length ? (
        <ul className="flex flex-col gap-1 text-sm text-destructive">
          {live.activeAlarms.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      ) : null}
      {values.length ? (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {values.map((v) => (
            <Field key={v.key} label={v.label} value={v.text} ltr />
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">{t('floor.noData')}</p>
      )}
    </div>
  );
}

function HistoryTab({ asset, me }: { asset: AssetDetail; me: MeResponse }) {
  const { t } = useTranslation();
  const keys = historyKeysFor(asset.deviceType);
  const query = useQuery({
    queryKey: ['asset-history', asset.id, keys.join(',')],
    queryFn: () =>
      api.get(
        `/assets/${asset.id}/history?keys=${encodeURIComponent(keys.join(','))}`,
        HistoryResponseSchema,
      ),
    enabled: Boolean(asset.tbDeviceId),
    staleTime: 60_000,
  });
  if (!asset.tbDeviceId) {
    return <p className="text-sm text-muted-foreground">{t('assets.noDevice')}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{t('assets.history24h')}</p>
      {query.isPending ? (
        <p className="text-sm text-muted-foreground">{t('app.loading')}</p>
      ) : query.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t('charts.unavailable')}</AlertDescription>
        </Alert>
      ) : (
        <HistoryChart series={query.data.series} timeZone={me.tenant.timeZone} />
      )}
    </div>
  );
}

function CustodyTab({ asset, me }: { asset: AssetDetail; me: MeResponse }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const canEdit = CUSTODY_ROLES.has(me.user.role);
  const employees = useQuery({
    queryKey: ['employees'],
    queryFn: () => api.get('/employees', EmployeesResponseSchema),
    enabled: canEdit,
    staleTime: 60_000,
  });
  const update = useMutation({
    mutationFn: (custodianEmployeeId: string | null) =>
      api.patch(`/assets/${asset.id}`, { custodianEmployeeId }, AssetSchema),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['asset', asset.id] });
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-1 gap-3 text-sm">
        <Field
          label={t('assets.currentCustodian')}
          value={
            asset.custodian
              ? `${asset.custodian.name} · ${asset.custodian.department} · ${asset.custodian.email}`
              : t('assets.noCustodian')
          }
        />
      </dl>
      {canEdit && (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="custodian-select">
            {t('assets.changeCustodian')}
          </label>
          <Select
            id="custodian-select"
            value={asset.custodian?.id ?? ''}
            disabled={update.isPending || employees.isPending}
            onChange={(e) => update.mutate(e.target.value || null)}
          >
            <option value="">{t('assets.noCustodian')}</option>
            {(employees.data?.items ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.department}
              </option>
            ))}
          </Select>
          {update.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                {isApiError(update.error)
                  ? (update.error.detail ?? update.error.title)
                  : String(update.error)}
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
      <div>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t('assets.custodyHistory')}
        </h3>
        {asset.custody.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('assets.noCustodyHistory')}</p>
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {asset.custody.map((c, i) => (
              <li key={i} className="flex flex-col gap-0.5 py-2">
                <span>
                  {c.from?.name ?? '—'} → {c.to?.name ?? '—'}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(c.ts, i18n.language, me.tenant.timeZone)}
                  {c.actor ? ` · ${c.actor}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ActionsTab({ asset, me }: { asset: AssetDetail; me: MeResponse }) {
  const live = useLive().devices[asset.code];
  return (
    <AssetActions asset={asset} live={live} role={me.user.role} timeZone={me.tenant.timeZone} />
  );
}

function AuditTab({ asset, me }: { asset: AssetDetail; me: MeResponse }) {
  const { t, i18n } = useTranslation();
  if (asset.audit.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('assets.noAudit')}</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('audit.when')}</TableHead>
          <TableHead>{t('audit.actor')}</TableHead>
          <TableHead>{t('audit.action')}</TableHead>
          <TableHead>{t('audit.change')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {asset.audit.map((a) => (
          <TableRow key={a.id}>
            <TableCell className="whitespace-nowrap text-xs">
              {formatDateTime(a.ts, i18n.language, me.tenant.timeZone)}
            </TableCell>
            <TableCell className="text-xs">{a.actorLabel ?? a.actorType}</TableCell>
            <TableCell className="font-mono text-xs" dir="ltr">
              {a.action}
            </TableCell>
            <TableCell className="max-w-56 truncate font-mono text-[11px]" dir="ltr">
              {a.after ? JSON.stringify(a.after) : ''}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Link that opens the drawer on the register page. */
export function assetDrawerLink(assetId: string): string {
  return `/assets?asset=${encodeURIComponent(assetId)}`;
}

/** Open maintenance task on the asset, when the role may see tasks. */
function OpenTaskBadge({ assetId, role }: { assetId: string; role: string }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['maintenance', 'asset', assetId],
    queryFn: () => api.get(`/maintenance?assetId=${assetId}&pageSize=5`, MaintenanceResponseSchema),
    enabled: role !== 'FINANCE',
    staleTime: 60_000,
  });
  const open = (query.data?.items ?? []).find(
    (x) => x.status === 'OPEN' || x.status === 'IN_PROGRESS',
  );
  if (!open) return null;
  return (
    <Link to={`/maintenance?task=${open.id}`} data-testid="open-task-badge">
      <Badge variant="warning">{t('maintenance.openTask', { title: open.title })}</Badge>
    </Link>
  );
}
