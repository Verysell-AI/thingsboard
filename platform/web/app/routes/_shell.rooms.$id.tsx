import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarPlus, MonitorSmartphone } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useOutletContext, useParams } from 'react-router';
import {
  BOOKING_ATTENDANCE,
  BookingSchema,
  RoomDetailSchema,
  type Booking,
  type CreateBooking,
  type MeResponse,
} from '@platform/shared/dto';
import { assetDrawerLink } from '~/components/asset-drawer';
import { BookingTimeline } from '~/components/booking-timeline';
import { DeviceGlyph } from '~/components/device-glyph';
import { roomOccupancy, roomPowerW } from '~/components/floor-plan-svg';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Select } from '~/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { api, isApiError } from '~/lib/api';
import { formatClockTime, useBusinessClock } from '~/lib/clock';
import { deviceDot, deviceIcon, deviceKindKey } from '~/lib/device-icons';
import { formatKwh, formatMoney, formatPowerW } from '~/lib/format';
import { useLive } from '~/lib/live';
import { roomAcOn, roomLightsOn } from '~/lib/live-store';
import { isWasting } from '~/lib/automations';
import { ROOM_STATUS_VARIANT, isoAtLocalTime } from '~/lib/rooms';
import { zonedDateParts } from '@platform/shared/clock';

const BOOKING_ROLES = new Set(['TENANT_ADMIN', 'OPS_MANAGER', 'FIELD_OPERATOR']);

export default function RoomDetailRoute() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const me = useOutletContext<MeResponse>();
  const queryClient = useQueryClient();
  const live = useLive();
  const clock = useBusinessClock({ demoMode: me.tenant.demoMode, timeZone: me.tenant.timeZone });
  const [showForm, setShowForm] = useState(false);
  const query = useQuery({
    queryKey: ['room', id],
    queryFn: () => api.get(`/rooms/${id}`, RoomDetailSchema),
    refetchInterval: 30_000,
  });
  const cancel = useMutation({
    mutationFn: (bookingId: string) =>
      api.post(`/bookings/${bookingId}/cancel`, undefined, BookingSchema),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['room', id] });
      void queryClient.invalidateQueries({ queryKey: ['rooms'] });
    },
  });

  if (query.isPending) return <p className="text-sm text-muted-foreground">{t('app.loading')}</p>;
  if (query.isError || !query.data) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {isApiError(query.error) ? (query.error.detail ?? query.error.title) : t('app.error')}
        </AlertDescription>
      </Alert>
    );
  }
  const room = query.data;
  const canBook = BOOKING_ROLES.has(me.user.role);
  const lightsOn = roomLightsOn(live.devices, room.code) || room.lightsOn;
  const acOn = roomAcOn(live.devices, room.code) || room.acOn;
  const power = roomPowerW(live.devices, room.code) ?? room.powerW ?? undefined;
  const presence = live.presence[room.code];
  const people = presence
    ? presence.count
    : Math.max(roomOccupancy(live.devices, room.code), room.peopleCount);
  const laptopsOnline = presence ? presence.laptopsOnline : room.laptopsOnline;
  const bookings = [...room.bookingsToday].sort((a, b) => a.start.localeCompare(b.start));

  return (
    <div className="flex flex-col gap-4" data-testid="room-detail">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" aria-label={t('rooms.back')}>
            <Link to="/rooms">
              <ArrowLeft className="rtl:rotate-180" aria-hidden />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">
              <span dir="ltr">{room.code}</span> · {room.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {room.floor !== null ? `${t('floor.title', { floor: room.floor })} · ` : ''}
              {t(`rooms.kind.${room.kind ?? 'other'}`)}
              {room.capacity ? ` · ${t('floor.capacity', { count: room.capacity })}` : ''}
              {room.zone ? ` · ${room.zone}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {room.critical && <Badge variant="destructive">{t('floor.critical')}</Badge>}
          {isWasting(room) && (
            <Badge variant="warning" className="text-sm" data-testid="waste-badge">
              {t('rooms.wastingDetail', {
                minutes: room.wastingSinceMinutes,
                kwh: formatKwh(room.wastedKwhToday, i18n.language),
              })}
            </Badge>
          )}
          <Badge variant={ROOM_STATUS_VARIANT[room.status]} className="text-sm">
            {t(`rooms.status.${room.status}`)}
          </Badge>
          <Button asChild variant="outline" size="sm">
            <a
              href={`/rooms/${room.id}/panel`}
              target="_blank"
              rel="noreferrer"
              data-testid="open-panel"
            >
              <MonitorSmartphone aria-hidden /> {t('panel.open')}
            </a>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label={t('floor.people')} value={String(people)} />
        <Stat label={t('rooms.laptopsLabel')} value={String(laptopsOnline)} />
        <Stat label={t('devices.light')} value={lightsOn ? t('status.on') : t('status.off')} />
        <Stat label={t('devices.ac')} value={acOn ? t('status.on') : t('status.off')} />
        <Stat label={t('floor.powerNow')} value={formatPowerW(power, i18n.language)} />
        <Stat
          label={t('rooms.energyToday')}
          value={`${formatKwh(room.energyTodayKwh, i18n.language)} · ${formatMoney(room.costToday, me.tenant.currency, i18n.language)}`}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('rooms.today')}</CardTitle>
          {canBook && (
            <Button size="sm" onClick={() => setShowForm((v) => !v)}>
              <CalendarPlus aria-hidden /> {t('bookings.new')}
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <BookingTimeline
            bookings={bookings}
            now={clock.now}
            timeZone={me.tenant.timeZone}
            showAttendance={me.tenant.demoMode}
          />
          {showForm && (
            <BookingForm
              roomId={room.id}
              me={me}
              now={clock.now}
              onDone={() => {
                setShowForm(false);
                void queryClient.invalidateQueries({ queryKey: ['room', id] });
                void queryClient.invalidateQueries({ queryKey: ['rooms'] });
              }}
            />
          )}
          {bookings.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('rooms.noBookings')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('bookings.time')}</TableHead>
                  <TableHead>{t('bookings.title')}</TableHead>
                  <TableHead>{t('bookings.organiser')}</TableHead>
                  {me.tenant.demoMode && <TableHead>{t('bookings.attendanceLabel')}</TableHead>}
                  <TableHead>{t('bookings.status')}</TableHead>
                  {canBook && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.map((b) => (
                  <BookingRow
                    key={b.id}
                    booking={b}
                    me={me}
                    canCancel={canBook && b.status === 'ACTIVE'}
                    onCancel={() => cancel.mutate(b.id)}
                    cancelling={cancel.isPending}
                  />
                ))}
              </TableBody>
            </Table>
          )}
          {cancel.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                {isApiError(cancel.error)
                  ? (cancel.error.detail ?? cancel.error.title)
                  : String(cancel.error)}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('floor.devicesInRoom', { count: room.devices.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y">
            {room.devices.map((d) => {
              const device = { type: d.type, code: d.code, appliance: d.appliance };
              const liveState = live.devices[d.code];
              return (
                <li key={d.assetId}>
                  <Link
                    to={assetDrawerLink(d.assetId)}
                    className="flex items-center gap-3 py-2 text-sm hover:bg-muted/60"
                  >
                    <DeviceGlyph
                      icon={deviceIcon(device)}
                      dot={deviceDot(device, liveState)}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{d.name}</span>
                      <span className="block truncate text-xs text-muted-foreground" dir="ltr">
                        {d.code} · {t(deviceKindKey(device))}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="truncate text-xs text-muted-foreground">{label}</div>
        <div className="truncate font-semibold" dir="ltr">
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function BookingRow({
  booking,
  me,
  canCancel,
  onCancel,
  cancelling,
}: {
  booking: Booking;
  me: MeResponse;
  canCancel: boolean;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const { t, i18n } = useTranslation();
  const tz = me.tenant.timeZone;
  return (
    <TableRow data-booking={booking.id}>
      <TableCell className="whitespace-nowrap" dir="ltr">
        {formatClockTime(Date.parse(booking.start), tz, i18n.language, { seconds: false })}–
        {formatClockTime(Date.parse(booking.end), tz, i18n.language, { seconds: false })}
      </TableCell>
      <TableCell className="font-medium">{booking.title}</TableCell>
      <TableCell className="text-xs">{booking.organiser?.name ?? '—'}</TableCell>
      {me.tenant.demoMode && (
        <TableCell className="text-xs">{t(`bookings.attendance.${booking.attendance}`)}</TableCell>
      )}
      <TableCell>
        <Badge
          variant={
            booking.status === 'ACTIVE'
              ? 'success'
              : booking.status === 'RELEASED'
                ? 'warning'
                : 'secondary'
          }
        >
          {t(`bookings.statusLabel.${booking.status}`)}
        </Badge>
      </TableCell>
      {canCancel !== undefined && (
        <TableCell className="text-end">
          {canCancel && (
            <Button variant="ghost" size="sm" disabled={cancelling} onClick={onCancel}>
              {t('bookings.cancel')}
            </Button>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}

function BookingForm({
  roomId,
  me,
  now,
  onDone,
}: {
  roomId: string;
  me: MeResponse;
  now: number;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const tz = me.tenant.timeZone;
  const p = zonedDateParts(now, tz);
  const nextHour = Math.min(19, p.hour + 1);
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(`${String(nextHour).padStart(2, '0')}:00`);
  const [end, setEnd] = useState(`${String(Math.min(20, nextHour + 1)).padStart(2, '0')}:00`);
  const [attendance, setAttendance] = useState<CreateBooking['attendance']>('FULL');
  const create = useMutation({
    mutationFn: (body: CreateBooking) => api.post('/bookings', body, BookingSchema),
    onSuccess: onDone,
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({
      roomId,
      title: title.trim(),
      start: isoAtLocalTime(now, tz, start),
      end: isoAtLocalTime(now, tz, end),
      ...(me.tenant.demoMode ? { attendance } : {}),
    });
  };
  return (
    <form
      className="grid items-end gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-[2fr_1fr_1fr_auto_auto]"
      onSubmit={onSubmit}
      data-testid="booking-form"
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="bk-title">{t('bookings.title')}</Label>
        <Input id="bk-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="bk-start">{t('bookings.start')}</Label>
        <Input
          id="bk-start"
          type="time"
          required
          value={start}
          onChange={(e) => setStart(e.target.value)}
          dir="ltr"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="bk-end">{t('bookings.end')}</Label>
        <Input
          id="bk-end"
          type="time"
          required
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          dir="ltr"
        />
      </div>
      {me.tenant.demoMode ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor="bk-att">{t('bookings.attendanceLabel')}</Label>
          <Select
            id="bk-att"
            value={attendance}
            onChange={(e) => setAttendance(e.target.value as CreateBooking['attendance'])}
          >
            {BOOKING_ATTENDANCE.map((a) => (
              <option key={a} value={a}>
                {t(`bookings.attendance.${a}`)}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <span />
      )}
      <Button type="submit" disabled={create.isPending || start >= end}>
        {t('bookings.save')}
      </Button>
      {create.isError && (
        <p className="text-xs text-destructive sm:col-span-5">
          {isApiError(create.error)
            ? (create.error.detail ?? create.error.title)
            : String(create.error)}
        </p>
      )}
    </form>
  );
}
