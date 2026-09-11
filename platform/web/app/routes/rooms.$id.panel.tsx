import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Hourglass, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Navigate, redirect, useParams } from 'react-router';
import {
  BookingSchema,
  RoomDetailSchema,
  type MeResponse,
  type RoomStatus,
} from '@platform/shared/dto';
import { roomOccupancy, roomPowerW } from '~/components/floor-plan-svg';
import { Button } from '~/components/ui/button';
import { api, isApiError } from '~/lib/api';
import { isAuthenticated } from '~/lib/auth';
import { formatClockTime, useBusinessClock } from '~/lib/clock';
import { formatKwh, formatMoney, formatPowerW } from '~/lib/format';
import { LiveProvider, useLive } from '~/lib/live';
import { useMe } from '~/lib/me';
import { cn } from '~/lib/utils';

export function clientLoader() {
  if (!isAuthenticated()) throw redirect('/login');
  return null;
}

const ACTION_ROLES = new Set(['TENANT_ADMIN', 'OPS_MANAGER', 'FIELD_OPERATOR']);

const STATUS_STYLE: Record<RoomStatus, string> = {
  FREE: 'bg-emerald-600 text-white',
  BUSY: 'bg-red-600 text-white',
  BOOKED: 'bg-amber-500 text-white',
};

/** Full-screen room sign for a tablet outside the door: status, bookings, energy and two actions. */
export default function RoomPanelRoute() {
  const { t } = useTranslation();
  const me = useMe();
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  if (me.isPending || !me.data) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        {t('app.loading')}
      </div>
    );
  }
  return (
    <LiveProvider>
      <Panel me={me.data} />
    </LiveProvider>
  );
}

function Panel({ me }: { me: MeResponse }) {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const queryClient = useQueryClient();
  const live = useLive();
  const clock = useBusinessClock({ demoMode: me.tenant.demoMode, timeZone: me.tenant.timeZone });
  const tz = me.tenant.timeZone;
  const l = i18n.language;
  const query = useQuery({
    queryKey: ['room', id],
    queryFn: () => api.get(`/rooms/${id}`, RoomDetailSchema),
    refetchInterval: 30_000,
  });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['room', id] });
    void queryClient.invalidateQueries({ queryKey: ['rooms'] });
  };
  const release = useMutation({
    mutationFn: (bookingId: string) =>
      api.post(`/bookings/${bookingId}/release`, undefined, BookingSchema),
    onSuccess: invalidate,
  });
  const extend = useMutation({
    mutationFn: (bookingId: string) =>
      api.post(`/bookings/${bookingId}/extend`, { minutes: 30 }, BookingSchema),
    onSuccess: invalidate,
  });

  if (query.isPending)
    return <div className="flex h-screen items-center justify-center">{t('app.loading')}</div>;
  if (query.isError || !query.data) {
    return (
      <div className="flex h-screen items-center justify-center text-destructive">
        {isApiError(query.error) ? (query.error.detail ?? query.error.title) : t('app.error')}
      </div>
    );
  }
  const room = query.data;
  const presence = live.presence[room.code];
  const people = presence
    ? presence.count
    : Math.max(roomOccupancy(live.devices, room.code), room.peopleCount);
  const occupiedLive = presence ? presence.occupied : room.occupied;
  const status: RoomStatus = occupiedLive ? 'BUSY' : room.currentBooking ? 'BOOKED' : 'FREE';
  const power = roomPowerW(live.devices, room.code) ?? room.powerW ?? undefined;
  const current = room.currentBooking;
  const minutesLeft = current
    ? Math.max(0, Math.round((Date.parse(current.end) - clock.now) / 60_000))
    : null;
  const canAct =
    ACTION_ROLES.has(me.user.role) ||
    current?.organiser?.email?.toLowerCase() === me.user.email.toLowerCase();
  const error = release.error ?? extend.error;

  return (
    <main
      className="flex min-h-screen flex-col bg-background text-foreground"
      data-testid="room-panel"
      data-status={status}
    >
      <header className={cn('flex flex-col gap-2 px-8 py-10', STATUS_STYLE[status])}>
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-4xl font-bold">
            <span dir="ltr">{room.code}</span> · {room.name}
          </h1>
          <span className="text-2xl tabular-nums" dir="ltr">
            {formatClockTime(clock.now, tz, l, { seconds: false })}
          </span>
        </div>
        <div className="text-6xl font-extrabold tracking-tight">{t(`rooms.status.${status}`)}</div>
        <div className="flex flex-wrap items-center gap-6 text-lg opacity-90">
          {room.capacity ? <span>{t('floor.capacity', { count: room.capacity })}</span> : null}
          <span className="inline-flex items-center gap-2">
            <Users className="size-5" aria-hidden /> {t('telemetry.people', { count: people })}
          </span>
          <span dir="ltr">{formatPowerW(power, l)}</span>
        </div>
      </header>

      <section className="grid flex-1 gap-8 px-8 py-8 md:grid-cols-2">
        <div className="flex flex-col gap-6">
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              {t('rooms.currentBooking')}
            </h2>
            {current ? (
              <div className="mt-2">
                <div className="text-3xl font-semibold">{current.title}</div>
                <div className="text-lg text-muted-foreground" dir="ltr">
                  {formatClockTime(Date.parse(current.start), tz, l, { seconds: false })}–
                  {formatClockTime(Date.parse(current.end), tz, l, { seconds: false })}
                </div>
                {current.organiser && (
                  <div className="text-muted-foreground">{current.organiser.name}</div>
                )}
                {minutesLeft !== null && (
                  <div className="mt-1 inline-flex items-center gap-2 text-lg">
                    <Hourglass className="size-5" aria-hidden />
                    {t('panel.minutesLeft', { count: minutesLeft })}
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-2 text-2xl text-muted-foreground">{t('panel.noCurrent')}</p>
            )}
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              {t('rooms.nextBooking')}
            </h2>
            {room.nextBooking ? (
              <div className="mt-2 inline-flex items-center gap-3 text-xl">
                <CalendarClock className="size-6" aria-hidden />
                <span>
                  {room.nextBooking.title} ·{' '}
                  <span dir="ltr">
                    {formatClockTime(Date.parse(room.nextBooking.start), tz, l, {
                      seconds: false,
                    })}
                  </span>
                </span>
              </div>
            ) : (
              <p className="mt-2 text-xl text-muted-foreground">{t('panel.noNext')}</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="rounded-2xl border bg-card p-6">
            <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              {t('rooms.energyToday')}
            </h2>
            <p className="mt-2 text-3xl font-semibold" dir="ltr">
              {t('panel.usedToday', {
                kwh: formatKwh(room.energyTodayKwh, l),
                cost: formatMoney(room.costToday, me.tenant.currency, l),
              })}
            </p>
            {room.wastingSinceMinutes !== null && room.wastingSinceMinutes > 0 && (
              <p className="mt-2 text-amber-700">
                {t('rooms.wastingDetail', {
                  minutes: room.wastingSinceMinutes,
                  kwh: formatKwh(room.wastedKwhToday, l),
                })}
              </p>
            )}
          </div>
          {current && canAct && (
            <div className="flex flex-wrap gap-4">
              <Button
                size="lg"
                variant="outline"
                className="h-16 flex-1 text-xl"
                disabled={release.isPending}
                onClick={() => release.mutate(current.id)}
                data-testid="panel-release"
              >
                {t('panel.release')}
              </Button>
              <Button
                size="lg"
                className="h-16 flex-1 text-xl"
                disabled={extend.isPending}
                onClick={() => extend.mutate(current.id)}
                data-testid="panel-extend"
              >
                {t('panel.extend')}
              </Button>
            </div>
          )}
          {error && (
            <p className="text-destructive">
              {isApiError(error) ? (error.detail ?? error.title) : String(error)}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
