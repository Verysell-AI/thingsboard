import { useQuery } from '@tanstack/react-query';
import { Laptop, Lightbulb, Users, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLoaderData } from 'react-router';
import type { DeviceLiveState, FloorPlan } from '@platform/shared/dto';
import { AssetsResponseSchema, FloorPlanSchema, RoomsResponseSchema } from '@platform/shared/dto';
import type { Route } from './+types/_shell.floors.$floor';
import { FloorDetailsPanel } from '~/components/floor-details-panel';
import { FloorLegend } from '~/components/floor-legend';
import { FloorPlanSvg, roomOccupancy, type FloorSelection } from '~/components/floor-plan-svg';
import { SweepBannerView, sweepBannerFrom } from '~/components/sweep-banner';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { api, isApiError } from '~/lib/api';
import { formatPowerW } from '~/lib/format';
import { isWasting } from '~/lib/automations';
import { useLive } from '~/lib/live';
import { roomLightsOn, type RoomPresence } from '~/lib/live-store';

const FLOORS = [1, 2];

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  try {
    const plan = await api.get(`/locations/floors/${params.floor}/plan`, FloorPlanSchema);
    return { plan, floor: Number(params.floor) };
  } catch (e) {
    if (isApiError(e) && e.status === 404) return { plan: null, floor: Number(params.floor) };
    throw e;
  }
}

/** Headline numbers for the floor, all derived from the live device map. */
export function floorSummary(
  plan: FloorPlan,
  devices: Record<string, DeviceLiveState>,
  floor: number,
  presence: Record<string, RoomPresence> = {},
) {
  const laptops = plan.devices.filter((d) => d.type === 'laptop');
  const laptopsOnline = laptops.filter((d) => devices[d.code]?.online).length;
  const roomsLit = plan.rooms.filter((r) => roomLightsOn(devices, r.code)).length;
  const people =
    plan.rooms.reduce(
      (sum, r) => sum + (presence[r.code]?.count ?? roomOccupancy(devices, r.code)),
      0,
    ) + laptopsOnline;
  const meter = Object.values(devices).find(
    (d) =>
      d.deviceCode === `FM-${floor}` ||
      (d.deviceType === 'floor_meter' && d.room === null && d.deviceCode.endsWith(String(floor))),
  );
  const powerW = meter ? Number(meter.values.power_w) : undefined;
  return {
    laptops: laptops.length,
    laptopsOnline,
    rooms: plan.rooms.length,
    roomsLit,
    people,
    powerW,
  };
}

export default function FloorRoute() {
  const { t, i18n } = useTranslation();
  const { plan, floor } = useLoaderData<typeof clientLoader>();
  const live = useLive();
  const [selected, setSelected] = useState<FloorSelection | null>(null);
  const summary = plan ? floorSummary(plan, live.devices, floor, live.presence) : null;

  // waste and misplaced flags are decided by the API; refreshed on presence changes and every minute
  const rooms = useQuery({
    queryKey: ['rooms', `floor=${floor}`],
    queryFn: () => api.get(`/rooms?floor=${floor}`, RoomsResponseSchema),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
  const exceptions = useQuery({
    queryKey: ['assets-exceptions'],
    queryFn: () => api.get('/assets?exceptions=true&pageSize=200', AssetsResponseSchema),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
  const presenceId = live.events.find((e) => e.kind === 'room.presence')?.id;
  const refetchRooms = rooms.refetch;
  useEffect(() => {
    if (presenceId) void refetchRooms();
  }, [presenceId, refetchRooms]);
  const wasting = new Set((rooms.data?.items ?? []).filter(isWasting).map((r) => r.code));
  const misplaced = new Set(
    (exceptions.data?.items ?? []).filter((a) => a.misplacedRoom).map((a) => a.code),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('floor.title', { floor })}</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('floor.switch')}</span>
          {FLOORS.map((f) => (
            <Button key={f} asChild size="sm" variant={f === floor ? 'default' : 'outline'}>
              <Link to={`/floors/${f}`} onClick={() => setSelected(null)}>
                {f}
              </Link>
            </Button>
          ))}
          <Badge variant={live.connected ? 'success' : 'secondary'} data-testid="live-status">
            {live.connected ? t('floor.live') : t('floor.offline')}
          </Badge>
        </div>
      </div>

      <SweepBannerView banner={sweepBannerFrom(live.events, Date.now())} />

      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="floor-summary">
          <StatTile
            icon={Zap}
            label={t('floor.powerNow')}
            value={formatPowerW(summary.powerW, i18n.language)}
          />
          <StatTile
            icon={Laptop}
            label={t('floor.laptopsOnline')}
            value={`${summary.laptopsOnline} / ${summary.laptops}`}
          />
          <StatTile
            icon={Lightbulb}
            label={t('floor.roomsLit')}
            value={`${summary.roomsLit} / ${summary.rooms}`}
          />
          <StatTile icon={Users} label={t('floor.people')} value={String(summary.people)} />
        </div>
      )}

      {plan ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4">
            <FloorPlanSvg
              plan={plan}
              devices={live.devices}
              presence={live.presence}
              wasting={wasting}
              misplaced={misplaced}
              selected={selected}
              onSelect={setSelected}
            />
            <FloorLegend />
          </div>
          <div className="min-w-0">
            <FloorDetailsPanel
              plan={plan}
              devices={live.devices}
              selected={selected}
              onSelect={setSelected}
            />
          </div>
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {t('floor.empty')}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Zap;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
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
