import { useQuery } from '@tanstack/react-query';
import { Coins, Gauge, TriangleAlert, Zap } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useOutletContext, useSearchParams } from 'react-router';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ENERGY_RANGES,
  EnergyBreakdownSchema,
  EnergySummarySchema,
  EnergyTrendSchema,
  TopConsumersSchema,
  type EnergyRange,
  type EnergyTrend,
  type MeResponse,
} from '@platform/shared/dto';
import { assetDrawerLink } from '~/components/asset-drawer';
import { ShedPanel } from '~/components/shed-panel';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Select } from '~/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { Tabs } from '~/components/ui/tabs';
import { api } from '~/lib/api';
import { formatKwh, formatMoney, formatPowerW } from '~/lib/format';
import { cn } from '~/lib/utils';

type Tab = 'overview' | 'floors' | 'rooms';
const ACCENT = 'var(--brand-accent)';

export default function EnergyRoute() {
  const { t } = useTranslation();
  const me = useOutletContext<MeResponse>();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'overview';
  const setTab = (next: Tab) => {
    const sp = new URLSearchParams(params);
    sp.set('tab', next);
    setParams(sp, { replace: true });
  };
  return (
    <div className="flex flex-col gap-4" data-testid="energy-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('energy.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('energy.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/energy/standby">{t('energy.standby.title')}</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/energy/ac-health">{t('energy.acHealth.title')}</Link>
          </Button>
        </div>
      </div>
      <Tabs
        items={(['overview', 'floors', 'rooms'] as Tab[]).map((k) => ({
          key: k,
          label: t(`energy.tabs.${k}`),
        }))}
        value={tab}
        onChange={setTab}
      />
      {tab === 'overview' && <OverviewTab me={me} />}
      {tab === 'floors' && <FloorsTab me={me} />}
      {tab === 'rooms' && <RoomsTab me={me} />}
    </div>
  );
}

function useTrend(
  scope: 'building' | 'floor' | 'room',
  code: string | undefined,
  range: EnergyRange,
) {
  const sp = new URLSearchParams({ scope, range });
  if (code) sp.set('code', code);
  return useQuery({
    queryKey: ['energy-trend', scope, code ?? '', range],
    queryFn: () => api.get(`/energy/trend?${sp}`, EnergyTrendSchema),
    staleTime: 60_000,
    refetchInterval: 60_000,
    enabled: scope === 'building' || Boolean(code),
  });
}

function RangeSwitch({
  value,
  onChange,
}: {
  value: EnergyRange;
  onChange: (r: EnergyRange) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-1" role="radiogroup">
      {ENERGY_RANGES.map((r) => (
        <Button
          key={r}
          size="sm"
          variant={r === value ? 'default' : 'outline'}
          role="radio"
          aria-checked={r === value}
          onClick={() => onChange(r)}
        >
          {t(`energy.range.${r}`)}
        </Button>
      ))}
    </div>
  );
}

function TrendChart({
  trend,
  timeZone,
  range,
}: {
  trend: EnergyTrend | undefined;
  timeZone: string;
  range: EnergyRange;
}) {
  const { t, i18n } = useTranslation();
  if (!trend || trend.power.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{t('charts.noData')}</p>;
  }
  const fmt = new Intl.DateTimeFormat(i18n.language, {
    timeZone,
    ...(range === 'day'
      ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
      : {
          month: 'short',
          day: 'numeric',
          hour: range === 'week' ? '2-digit' : undefined,
          hourCycle: 'h23',
        }),
  });
  const data = trend.power.map((p) => ({ ts: p.ts, kw: Math.round(p.value / 10) / 100 }));
  return (
    <div className="h-64" dir="ltr" data-testid="energy-trend">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="kwFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(v) => fmt.format(new Date(Number(v)))}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            minTickGap={48}
          />
          <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} width={44} unit=" kW" />
          <Tooltip
            labelFormatter={(v) => fmt.format(new Date(Number(v)))}
            formatter={(value) => [`${value} kW`, t('floor.powerNow')]}
          />
          <Area
            type="monotone"
            dataKey="kw"
            stroke={ACCENT}
            strokeWidth={2}
            fill="url(#kwFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function OverviewTab({ me }: { me: MeResponse }) {
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState<EnergyRange>('day');
  const summary = useQuery({
    queryKey: ['energy-summary'],
    queryFn: () => api.get('/energy/summary', EnergySummarySchema),
    refetchInterval: 30_000,
  });
  const top = useQuery({
    queryKey: ['energy-top'],
    queryFn: () => api.get('/energy/top?limit=5', TopConsumersSchema),
    refetchInterval: 30_000,
  });
  const trend = useTrend('building', undefined, range);
  const s = summary.data;
  const currency = me.tenant.currency;
  const l = i18n.language;
  return (
    <div className="flex flex-col gap-4">
      <div
        className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8"
        data-testid="energy-tiles"
      >
        <Tile
          icon={Zap}
          label={t('energy.powerNow')}
          value={formatPowerW(s?.powerNowW ?? undefined, l)}
          accent
        />
        <Tile icon={Gauge} label={t('energy.kwhToday')} value={formatKwh(s?.kwhToday, l)} />
        <Tile icon={Gauge} label={t('energy.kwhWeek')} value={formatKwh(s?.kwhWeek, l, 0)} />
        <Tile icon={Gauge} label={t('energy.kwhMonth')} value={formatKwh(s?.kwhMonth, l, 0)} />
        <Tile
          icon={Coins}
          label={t('energy.costToday')}
          value={formatMoney(s?.costToday, currency, l)}
        />
        <Tile
          icon={Coins}
          label={t('energy.costMonth')}
          value={formatMoney(s?.costMonth, currency, l)}
        />
        <Tile
          icon={TriangleAlert}
          label={t('energy.wastedToday')}
          value={formatKwh(s?.wastedTodayKwh, l)}
        />
        <Tile
          icon={Gauge}
          label={t('energy.powerFactor')}
          value={
            s?.powerFactor != null
              ? new Intl.NumberFormat(l, { maximumFractionDigits: 2 }).format(s.powerFactor)
              : '—'
          }
        />
      </div>
      <ShedPanel me={me} />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('energy.buildingTrend')}</CardTitle>
          <RangeSwitch value={range} onChange={setRange} />
        </CardHeader>
        <CardContent>
          <TrendChart trend={trend.data} timeZone={me.tenant.timeZone} range={range} />
          <p className="mt-2 text-xs text-muted-foreground">
            {t('energy.tariff', {
              tariff: formatMoney(s?.tariffPerKwh ?? me.tenant.tariffPerKwh, currency, l),
            })}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('energy.topConsumers')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>{t('assets.columns.name')}</TableHead>
                <TableHead>{t('assets.filters.room')}</TableHead>
                <TableHead>{t('floor.powerNow')}</TableHead>
                <TableHead>{t('energy.kwhToday')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(top.data?.items ?? []).map((c, i) => (
                <TableRow key={c.assetId}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>
                    <Link
                      to={assetDrawerLink(c.assetId)}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {c.name}
                    </Link>
                    <span className="block font-mono text-xs text-muted-foreground" dir="ltr">
                      {c.code}
                    </span>
                  </TableCell>
                  <TableCell dir="ltr">{c.room ?? '—'}</TableCell>
                  <TableCell dir="ltr">{formatPowerW(c.powerNowW, l)}</TableCell>
                  <TableCell dir="ltr">{formatKwh(c.kwhToday, l)}</TableCell>
                </TableRow>
              ))}
              {top.data?.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                    {t('charts.noData')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Zap;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span
          className={cn(
            'inline-flex size-9 shrink-0 items-center justify-center rounded-md',
            accent ? 'bg-accent/15 text-accent' : 'bg-primary/10 text-primary',
          )}
        >
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="truncate text-xs text-muted-foreground">{label}</div>
          <div className="truncate text-lg font-semibold" dir="ltr">
            {value}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BreakdownBars({
  items,
  locale,
  currency,
}: {
  items: {
    code: string;
    name: string;
    share: number | null;
    kwhToday: number | null;
    costToday: number | null;
    powerNowW: number | null;
  }[];
  locale: string;
  currency: string;
}) {
  const { t } = useTranslation();
  const data = items.map((i) => ({
    name: i.code,
    kwh: Math.round((i.kwhToday ?? 0) * 100) / 100,
    cost: i.costToday ?? 0,
  }));
  return (
    <div className="h-56" dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} />
          <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} width={44} unit=" kWh" />
          <Tooltip
            formatter={(value, name) => [
              name === 'kwh'
                ? formatKwh(Number(value), locale)
                : formatMoney(Number(value), currency, locale),
              name === 'kwh' ? t('energy.kwhToday') : t('energy.costToday'),
            ]}
          />
          <Bar dataKey="kwh" fill={ACCENT} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function FloorsTab({ me }: { me: MeResponse }) {
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState<EnergyRange>('day');
  const [floor, setFloor] = useState<string>('1');
  const breakdown = useQuery({
    queryKey: ['energy-breakdown', 'floor'],
    queryFn: () => api.get('/energy/breakdown?scope=floor', EnergyBreakdownSchema),
    refetchInterval: 60_000,
  });
  const trend = useTrend('floor', floor, range);
  const items = breakdown.data?.items ?? [];
  const l = i18n.language;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('energy.perFloor')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <BreakdownBars items={items} locale={l} currency={me.tenant.currency} />
          <ul className="flex flex-col divide-y text-sm">
            {items.map((i) => (
              <li key={i.code} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {i.name}
                  <span className="block text-xs text-muted-foreground" dir="ltr">
                    {formatPowerW(i.powerNowW ?? undefined, l)} · {formatKwh(i.kwhToday, l)}
                  </span>
                </span>
                <Badge variant="outline">
                  {i.share != null ? `${Math.round(i.share * 100)} %` : '—'}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('energy.floorTrend')}</CardTitle>
          <div className="flex items-center gap-2">
            <Select
              aria-label={t('assets.filters.floor')}
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              className="w-32"
            >
              {(items.length
                ? items
                : [
                    { code: '1', floor: 1 },
                    { code: '2', floor: 2 },
                  ]
              ).map((i) => (
                <option
                  key={i.code}
                  value={String((i as { floor: number | null }).floor ?? i.code)}
                >
                  {t('floor.title', { floor: (i as { floor: number | null }).floor ?? i.code })}
                </option>
              ))}
            </Select>
            <RangeSwitch value={range} onChange={setRange} />
          </div>
        </CardHeader>
        <CardContent>
          <TrendChart trend={trend.data} timeZone={me.tenant.timeZone} range={range} />
        </CardContent>
      </Card>
    </div>
  );
}

function RoomsTab({ me }: { me: MeResponse }) {
  const { t, i18n } = useTranslation();
  const [floor, setFloor] = useState<string>('');
  const [range, setRange] = useState<EnergyRange>('day');
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const breakdown = useQuery({
    queryKey: ['energy-breakdown', 'room', floor],
    queryFn: () =>
      api.get(
        `/energy/breakdown?scope=room${floor ? `&floor=${floor}` : ''}`,
        EnergyBreakdownSchema,
      ),
    refetchInterval: 60_000,
  });
  const items = [...(breakdown.data?.items ?? [])].sort(
    (a, b) => (b.kwhToday ?? 0) - (a.kwhToday ?? 0),
  );
  const room = selected ?? items[0]?.code;
  const trend = useTrend('room', room, range);
  const l = i18n.language;
  const max = Math.max(1, ...items.map((i) => i.kwhToday ?? 0));
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('energy.perRoom')}</CardTitle>
          <Select
            aria-label={t('assets.filters.floor')}
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            className="w-36"
          >
            <option value="">{t('assets.filters.anyFloor')}</option>
            {[1, 2].map((f) => (
              <option key={f} value={f}>
                {t('floor.title', { floor: f })}
              </option>
            ))}
          </Select>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('assets.filters.room')}</TableHead>
                <TableHead>{t('floor.powerNow')}</TableHead>
                <TableHead className="w-1/3">{t('energy.kwhToday')}</TableHead>
                <TableHead>{t('energy.costToday')}</TableHead>
                <TableHead>{t('energy.share')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i) => (
                <TableRow
                  key={i.code}
                  data-state={i.code === room ? 'selected' : undefined}
                  className="cursor-pointer hover:bg-muted/60"
                  onClick={() => setSelected(i.code)}
                >
                  <TableCell>
                    <span dir="ltr">{i.code}</span> · {i.name}
                  </TableCell>
                  <TableCell dir="ltr">{formatPowerW(i.powerNowW ?? undefined, l)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2" dir="ltr">
                      <span className="h-2 flex-1 overflow-hidden rounded bg-muted">
                        <span
                          className="block h-full rounded bg-accent"
                          style={{ width: `${((i.kwhToday ?? 0) / max) * 100}%` }}
                        />
                      </span>
                      <span className="w-20 text-end text-xs">{formatKwh(i.kwhToday, l)}</span>
                    </div>
                  </TableCell>
                  <TableCell dir="ltr">{formatMoney(i.costToday, me.tenant.currency, l)}</TableCell>
                  <TableCell dir="ltr">
                    {i.share != null ? `${Math.round(i.share * 100)} %` : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>{room ? t('energy.roomTrend', { room }) : t('energy.perRoom')}</CardTitle>
          <RangeSwitch value={range} onChange={setRange} />
        </CardHeader>
        <CardContent>
          <TrendChart trend={trend.data} timeZone={me.tenant.timeZone} range={range} />
        </CardContent>
      </Card>
    </div>
  );
}
