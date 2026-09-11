import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Search, UserPlus, FileDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useOutletContext, useSearchParams } from 'react-router';
import {
  ASSET_STATUSES,
  AssetFacetsSchema,
  AssetsResponseSchema,
  type Asset,
  type AssetsQuery,
  type MeResponse,
} from '@platform/shared/dto';
import { ASSET_STATUS_VARIANT, AssetDrawer } from '~/components/asset-drawer';
import { DeviceGlyph } from '~/components/device-glyph';
import { RegisterTotals } from '~/components/register-totals';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Select } from '~/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { api } from '~/lib/api';
import { assetFiltersFrom, assetsQueryString, type AssetFilters } from '~/lib/assets';
import { deviceDot, deviceIcon, deviceStatus } from '~/lib/device-icons';
import { formatDate, formatMoney } from '~/lib/format';
import { useLive } from '~/lib/live';
import { cn } from '~/lib/utils';

const FINANCIAL_ROLES = new Set(['TENANT_ADMIN', 'OPS_MANAGER']);
const EMPLOYEE_ROLES = new Set(['TENANT_ADMIN', 'OPS_MANAGER']);
type SortKey = NonNullable<AssetsQuery['sort']>;

export default function AssetsRoute() {
  const { t, i18n } = useTranslation();
  const me = useOutletContext<MeResponse>();
  const [params, setParams] = useSearchParams();
  const live = useLive();
  const filters = assetFiltersFrom(params);
  const selectedAsset = params.get('asset');

  const facets = useQuery({
    queryKey: ['asset-facets'],
    queryFn: () => api.get('/assets/facets', AssetFacetsSchema),
    staleTime: 5 * 60_000,
  });
  const qs = assetsQueryString(filters);
  const assets = useQuery({
    queryKey: ['assets', qs],
    queryFn: () => api.get(`/assets${qs}`, AssetsResponseSchema),
    placeholderData: (prev) => prev,
  });

  const setFilters = (patch: Partial<AssetFilters>) => {
    const next = { ...filters, ...patch, page: patch.page ?? 0 };
    const sp = new URLSearchParams(assetsQueryString(next).replace(/^\?/, ''));
    if (selectedAsset) sp.set('asset', selectedAsset);
    setParams(sp, { replace: true });
  };
  const openAsset = (id: string | null) => {
    const sp = new URLSearchParams(params);
    if (id) sp.set('asset', id);
    else sp.delete('asset');
    setParams(sp, { replace: true });
  };
  const toggleSort = (key: SortKey) => {
    const order = filters.sort === key && (filters.order ?? 'asc') === 'asc' ? 'desc' : 'asc';
    setFilters({ sort: key, order });
  };

  const data = assets.data;
  const pageSize = data?.pageSize ?? filters.pageSize ?? 50;
  const page = data?.page ?? filters.page ?? 0;
  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const currency = me.tenant.currency;

  const SortHead = ({ k, label }: { k: SortKey; label: string }) => (
    <TableHead>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => toggleSort(k)}
      >
        {label}
        {filters.sort === k || (k === 'code' && !filters.sort) ? (
          (filters.order ?? 'asc') === 'asc' ? (
            <ArrowUp className="size-3" aria-hidden />
          ) : (
            <ArrowDown className="size-3" aria-hidden />
          )
        ) : null}
      </button>
    </TableHead>
  );

  return (
    <div className="flex flex-col gap-4" data-testid="assets-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('assets.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {data ? t('assets.count', { count: data.total }) : t('app.loading')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/assets/fleet">{t('fleet.title')}</Link>
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              api.download(
                `/assets/export.pdf${window.location.search}`,
                `${me.tenant.key}-asset-register.pdf`,
              )
            }
            data-testid="export-register"
          >
            <FileDown aria-hidden /> {t('assets.exportPdf')}
          </Button>
          {EMPLOYEE_ROLES.has(me.user.role) && (
            <Button asChild>
              <Link to="/employees/new">
                <UserPlus aria-hidden /> {t('employees.new')}
              </Link>
            </Button>
          )}
        </div>
      </div>
      {FINANCIAL_ROLES.has(me.user.role) && <RegisterTotals me={me} />}

      <div className="grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <div className="relative sm:col-span-2">
          <Search
            className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            aria-label={t('assets.search')}
            placeholder={t('assets.searchPlaceholder')}
            className="ps-8"
            value={filters.search ?? ''}
            onChange={(e) => setFilters({ search: e.target.value || undefined })}
          />
        </div>
        <Select
          aria-label={t('assets.columns.class')}
          value={filters.class ?? ''}
          onChange={(e) => setFilters({ class: e.target.value || undefined })}
        >
          <option value="">{t('assets.filters.anyClass')}</option>
          {(facets.data?.classes ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('assets.columns.type')}
          value={filters.type ?? ''}
          onChange={(e) => setFilters({ type: e.target.value || undefined })}
        >
          <option value="">{t('assets.filters.anyType')}</option>
          {(facets.data?.types ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('assets.filters.floor')}
          value={filters.floor?.toString() ?? ''}
          onChange={(e) =>
            setFilters({ floor: e.target.value ? Number(e.target.value) : undefined })
          }
        >
          <option value="">{t('assets.filters.anyFloor')}</option>
          {(facets.data?.floors ?? []).map((f) => (
            <option key={f} value={f}>
              {t('floor.title', { floor: f })}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('assets.filters.room')}
          value={filters.room ?? ''}
          onChange={(e) => setFilters({ room: e.target.value || undefined })}
        >
          <option value="">{t('assets.filters.anyRoom')}</option>
          {(facets.data?.rooms ?? []).map((r) => (
            <option key={r.code} value={r.code}>
              {r.code} · {r.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('assets.columns.custodian')}
          value={filters.custodianId ?? ''}
          onChange={(e) => setFilters({ custodianId: e.target.value || undefined })}
        >
          <option value="">{t('assets.filters.anyCustodian')}</option>
          {(facets.data?.custodians ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('assets.columns.status')}
          value={filters.status ?? ''}
          onChange={(e) =>
            setFilters({ status: (e.target.value || undefined) as AssetFilters['status'] })
          }
        >
          <option value="">{t('assets.filters.anyStatus')}</option>
          {ASSET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`assets.status.${s}`)}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(filters.exceptions)}
            onChange={(e) => setFilters({ exceptions: e.target.checked || undefined })}
          />
          {t('assets.filters.exceptions')}
        </label>
      </div>

      <Table className="min-w-[900px] [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
        <TableHeader>
          <TableRow>
            <TableHead>{t('assets.columns.live')}</TableHead>
            <SortHead k="code" label={t('assets.columns.code')} />
            <SortHead k="name" label={t('assets.columns.name')} />
            <SortHead k="type" label={t('assets.columns.class')} />
            <TableHead className="hidden xl:table-cell">{t('assets.columns.brandModel')}</TableHead>
            <TableHead className="hidden 2xl:table-cell">{t('assets.columns.serial')}</TableHead>
            <SortHead k="location" label={t('assets.columns.location')} />
            <TableHead className="hidden lg:table-cell">{t('assets.columns.custodian')}</TableHead>
            <SortHead k="purchaseDate" label={t('assets.columns.purchase')} />
            <SortHead k="warrantyEnd" label={t('assets.columns.warrantyEnd')} />
            <TableHead>{t('assets.columns.bookValue')}</TableHead>
            <TableHead>{t('assets.columns.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assets.isPending && (
            <TableRow>
              <TableCell colSpan={12} className="py-8 text-center text-muted-foreground">
                {t('app.loading')}
              </TableCell>
            </TableRow>
          )}
          {data?.items.length === 0 && (
            <TableRow>
              <TableCell colSpan={12} className="py-8 text-center text-muted-foreground">
                {t('assets.empty')}
              </TableCell>
            </TableRow>
          )}
          {data?.items.map((a) => (
            <AssetRow
              key={a.id}
              asset={a}
              liveDevices={live.devices}
              currency={currency}
              locale={i18n.language}
              selected={a.id === selectedAsset}
              onOpen={() => openAsset(a.id)}
            />
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{t('assets.page', { page: page + 1, pages })}</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 0}
            onClick={() => setFilters({ page: page - 1 })}
          >
            {t('assets.prev')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= pages}
            onClick={() => setFilters({ page: page + 1 })}
          >
            {t('assets.next')}
          </Button>
        </div>
      </div>

      <AssetDrawer assetId={selectedAsset} me={me} onClose={() => openAsset(null)} />
    </div>
  );
}

function AssetRow({
  asset,
  liveDevices,
  currency,
  locale,
  selected,
  onOpen,
}: {
  asset: Asset;
  liveDevices: ReturnType<typeof useLive>['devices'];
  currency: string;
  locale: string;
  selected: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const device = {
    type: asset.deviceType ?? asset.type,
    code: asset.code,
    appliance: asset.appliance,
  };
  const live = asset.tbDeviceId ? liveDevices[asset.code] : undefined;
  const status = deviceStatus(device, live);
  return (
    <TableRow
      data-state={selected ? 'selected' : undefined}
      data-asset={asset.code}
      className={cn('cursor-pointer hover:bg-muted/60', asset.misplacedRoom && 'bg-amber-50')}
      onClick={onOpen}
    >
      <TableCell>
        <span className="flex items-center gap-2">
          <DeviceGlyph
            icon={deviceIcon(device)}
            dot={asset.tbDeviceId ? deviceDot(device, live) : null}
            size="sm"
          />
          <span className="text-xs text-muted-foreground">
            {asset.tbDeviceId
              ? asset.appliance === 'projector' && status === 'on'
                ? t('assets.inUse')
                : t(`status.${status}`)
              : ''}
          </span>
        </span>
      </TableCell>
      <TableCell className="font-mono text-xs" dir="ltr">
        {asset.code}
      </TableCell>
      <TableCell className="font-medium">{asset.name}</TableCell>
      <TableCell className="text-xs">
        {asset.class} / {asset.type}
      </TableCell>
      <TableCell className="hidden text-xs xl:table-cell">
        {[asset.brand, asset.model].filter(Boolean).join(' ') || '—'}
      </TableCell>
      <TableCell className="hidden font-mono text-xs 2xl:table-cell" dir="ltr">
        {asset.serial ?? '—'}
      </TableCell>
      <TableCell className="text-xs">
        {asset.location ? asset.location.name : '—'}
        {asset.misplacedRoom && (
          <Badge variant="destructive" className="ms-2">
            {t('assets.misplacedIn', { room: asset.misplacedRoom.code })}
          </Badge>
        )}
      </TableCell>
      <TableCell className="hidden text-xs lg:table-cell">{asset.custodian?.name ?? '—'}</TableCell>
      <TableCell className="text-xs whitespace-nowrap">
        {formatDate(asset.purchaseDate, locale)}
        <span className="block text-muted-foreground">
          {formatMoney(asset.purchaseCost, currency, locale)}
        </span>
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap">
        {formatDate(asset.warrantyEnd, locale)}
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap">
        {formatMoney(asset.bookValue, currency, locale)}
      </TableCell>
      <TableCell>
        <Badge variant={ASSET_STATUS_VARIANT[asset.status]}>
          {t(`assets.status.${asset.status}`)}
        </Badge>
      </TableCell>
    </TableRow>
  );
}
