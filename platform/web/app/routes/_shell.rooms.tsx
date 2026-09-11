import { useQuery } from '@tanstack/react-query';
import { AirVent, Laptop, Lightbulb, Users } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useOutletContext, useSearchParams } from 'react-router';
import { ROOM_KINDS } from '@platform/shared/dataset';
import { RoomsResponseSchema, type MeResponse, type RoomView } from '@platform/shared/dto';
import { roomOccupancy, roomPowerW } from '~/components/floor-plan-svg';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { Select } from '~/components/ui/select';
import { api } from '~/lib/api';
import { formatClockTime } from '~/lib/clock';
import { formatKwh, formatMoney, formatPowerW } from '~/lib/format';
import { useLive } from '~/lib/live';
import { roomAcOn, roomLightsOn } from '~/lib/live-store';
import { isWasting } from '~/lib/automations';
import type { RoomPresence } from '~/lib/live-store';
import { ROOM_STATUS_VARIANT } from '~/lib/rooms';
import { cn } from '~/lib/utils';

const REFRESH_MS = 30_000;

export default function RoomsRoute() {
  const { t, i18n } = useTranslation();
  const me = useOutletContext<MeResponse>();
  const [params, setParams] = useSearchParams();
  const live = useLive();
  const floor = params.get('floor') ?? '';
  const kind = params.get('kind') ?? '';
  const qs = new URLSearchParams();
  if (floor) qs.set('floor', floor);
  if (kind) qs.set('kind', kind);
  const query = useQuery({
    queryKey: ['rooms', qs.toString()],
    queryFn: () => api.get(`/rooms${qs.size ? `?${qs}` : ''}`, RoomsResponseSchema),
    refetchInterval: REFRESH_MS,
    placeholderData: (prev) => prev,
  });

  // bookings change through automations too; a released booking arrives as a presence event
  const presenceId = live.events.find((e) => e.kind === 'room.presence')?.id;
  const refetch = query.refetch;
  useEffect(() => {
    if (presenceId) void refetch();
  }, [presenceId, refetch]);

  const setFilter = (key: string, value: string) => {
    const sp = new URLSearchParams(params);
    if (value) sp.set(key, value);
    else sp.delete(key);
    setParams(sp, { replace: true });
  };

  const rooms = query.data?.items ?? [];
  const floors = [...new Set(rooms.map((r) => r.floor).filter((f) => f !== null))].sort();

  return (
    <div className="flex flex-col gap-4" data-testid="rooms-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('rooms.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('rooms.subtitle')}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/rooms/utilisation">{t('utilisation.title')}</Link>
        </Button>
        <div className="flex gap-2">
          <Select
            aria-label={t('assets.filters.floor')}
            value={floor}
            onChange={(e) => setFilter('floor', e.target.value)}
            className="w-36"
          >
            <option value="">{t('assets.filters.anyFloor')}</option>
            {[1, 2].map((f) => (
              <option key={f} value={f}>
                {t('floor.title', { floor: f })}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('rooms.kindLabel')}
            value={kind}
            onChange={(e) => setFilter('kind', e.target.value)}
            className="w-40"
          >
            <option value="">{t('rooms.anyKind')}</option>
            {ROOM_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`rooms.kind.${k}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {query.isPending && <p className="text-sm text-muted-foreground">{t('app.loading')}</p>}
      {(floors.length ? floors : [null]).map((f) => (
        <section key={f ?? 'none'} className="flex flex-col gap-2">
          {f !== null && (
            <h2 className="text-sm font-semibold text-muted-foreground">
              {t('floor.title', { floor: f })}
            </h2>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rooms
              .filter((r) => r.floor === f)
              .map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  devices={live.devices}
                  presence={live.presence[room.code]}
                  currency={me.tenant.currency}
                  timeZone={me.tenant.timeZone}
                  locale={i18n.language}
                />
              ))}
          </div>
        </section>
      ))}
      {!query.isPending && rooms.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('rooms.empty')}</p>
      )}
    </div>
  );
}

function RoomCard({
  room,
  devices,
  presence,
  currency,
  timeZone,
  locale,
}: {
  room: RoomView;
  devices: ReturnType<typeof useLive>['devices'];
  presence?: RoomPresence;
  currency: string;
  timeZone: string;
  locale: string;
}) {
  const { t } = useTranslation();
  // live bits come from the socket so the card moves within a tick; bookings/status from the API
  const lightsOn = roomLightsOn(devices, room.code) || room.lightsOn;
  const acOn = roomAcOn(devices, room.code) || room.acOn;
  const power = roomPowerW(devices, room.code) ?? room.powerW ?? undefined;
  const people = presence
    ? presence.count
    : Math.max(roomOccupancy(devices, room.code), room.peopleCount);
  const laptopsOnline = presence ? presence.laptopsOnline : room.laptopsOnline;
  const status =
    presence && presence.occupied !== room.occupied
      ? presence.occupied
        ? 'BUSY'
        : room.currentBooking
          ? 'BOOKED'
          : 'FREE'
      : room.status;
  const booking = room.currentBooking ?? room.nextBooking;
  const isCurrent = Boolean(room.currentBooking);
  return (
    <Link
      to={`/rooms/${room.id}`}
      className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      data-room={room.code}
      data-status={status}
      data-wasting={isWasting(room) || undefined}
    >
      <Card
        className={cn(
          'h-full transition-colors hover:bg-muted/40',
          room.critical && 'border-red-300',
        )}
      >
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-semibold">
                <span dir="ltr">{room.code}</span> · {room.name}
              </div>
              <div className="text-xs text-muted-foreground">
                {t(`rooms.kind.${room.kind ?? 'other'}`)}
                {room.capacity ? ` · ${t('floor.capacity', { count: room.capacity })}` : ''}
              </div>
            </div>
            <Badge variant={ROOM_STATUS_VARIANT[status]}>{t(`rooms.status.${status}`)}</Badge>
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <Chip icon={Users} on={people > 0} label={t('telemetry.people', { count: people })} />
            <Chip
              icon={Laptop}
              on={laptopsOnline > 0}
              label={t('rooms.laptops', { count: laptopsOnline })}
            />
            <Chip
              icon={Lightbulb}
              on={lightsOn}
              label={lightsOn ? t('floor.lightOn') : t('floor.lightOff')}
            />
            <Chip icon={AirVent} on={acOn} label={acOn ? t('floor.acOn') : t('rooms.acOff')} />
            {isWasting(room) && (
              <Badge variant="warning" data-testid="waste-badge">
                {t('rooms.wastingDetail', {
                  minutes: room.wastingSinceMinutes,
                  kwh: formatKwh(room.wastedKwhToday, locale),
                })}
              </Badge>
            )}
          </div>
          <dl className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <dt className="text-muted-foreground">{t('floor.powerNow')}</dt>
              <dd className="font-medium" dir="ltr">
                {formatPowerW(power, locale)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('rooms.energyToday')}</dt>
              <dd className="font-medium" dir="ltr">
                {formatKwh(room.energyTodayKwh, locale)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('rooms.costToday')}</dt>
              <dd className="font-medium" dir="ltr">
                {formatMoney(room.costToday, currency, locale)}
              </dd>
            </div>
          </dl>
          {booking ? (
            <p className="truncate text-xs text-muted-foreground">
              {isCurrent ? t('rooms.currentBooking') : t('rooms.nextBooking')}:{' '}
              <span className="text-foreground">{booking.title}</span>{' '}
              <span dir="ltr">
                {formatClockTime(Date.parse(booking.start), timeZone, locale, { seconds: false })}–
                {formatClockTime(Date.parse(booking.end), timeZone, locale, { seconds: false })}
              </span>
            </p>
          ) : (
            room.kind === 'meeting' && (
              <p className="text-xs text-muted-foreground">{t('rooms.noBookings')}</p>
            )
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function Chip({ icon: Icon, on, label }: { icon: typeof Users; on: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5',
        on ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'text-muted-foreground',
      )}
    >
      <Icon className="size-3" aria-hidden /> {label}
    </span>
  );
}
