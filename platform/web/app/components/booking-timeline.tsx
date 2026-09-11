import { useTranslation } from 'react-i18next';
import type { Booking } from '@platform/shared/dto';
import { formatClockTime } from '~/lib/clock';
import {
  ATTENDANCE_COLOUR,
  layoutBookings,
  timelineHours,
  timelinePercent,
  timelineWindow,
} from '~/lib/rooms';
import { cn } from '~/lib/utils';

/** One day of a room's bookings on a horizontal band with a "now" marker. */
export function BookingTimeline({
  bookings,
  now,
  timeZone,
  showAttendance,
  onSelect,
}: {
  bookings: Booking[];
  now: number;
  timeZone: string;
  showAttendance: boolean;
  onSelect?: (booking: Booking) => void;
}) {
  const { t, i18n } = useTranslation();
  const window = timelineWindow(now, timeZone);
  const blocks = layoutBookings(bookings, window);
  const nowPct = timelinePercent(now, window);
  const inWindow = now >= window.from && now <= window.to;
  const hours = timelineHours();

  return (
    <div dir="ltr" data-testid="booking-timeline">
      <div className="relative h-12 rounded-md border bg-muted/40">
        {hours.map((h) => {
          const pct = ((h - hours[0]!) / (hours[hours.length - 1]! - hours[0]!)) * 100;
          return (
            <span
              key={h}
              className="absolute top-0 bottom-0 border-s border-border/70"
              style={{ left: `${pct}%` }}
              aria-hidden
            />
          );
        })}
        {blocks.map(({ booking, start, width }) => {
          const cancelled = booking.status === 'CANCELLED' || booking.status === 'RELEASED';
          return (
            <button
              key={booking.id}
              type="button"
              onClick={() => onSelect?.(booking)}
              title={`${booking.title} · ${formatClockTime(Date.parse(booking.start), timeZone, i18n.language, { seconds: false })}–${formatClockTime(Date.parse(booking.end), timeZone, i18n.language, { seconds: false })}`}
              className={cn(
                'absolute top-1.5 bottom-1.5 overflow-hidden rounded px-1 text-start text-[11px] leading-tight text-white',
                cancelled ? 'bg-gray-400/70 line-through' : ATTENDANCE_COLOUR[booking.attendance],
                !showAttendance && !cancelled && 'bg-primary',
              )}
              style={{ left: `${start}%`, width: `${width}%` }}
              data-booking={booking.id}
            >
              <span className="block truncate font-medium">{booking.title}</span>
              {showAttendance && !cancelled && (
                <span className="block truncate opacity-90">
                  {t(`bookings.attendance.${booking.attendance}`)}
                </span>
              )}
            </button>
          );
        })}
        {inWindow && (
          <span
            className="absolute top-0 bottom-0 w-0.5 bg-red-600"
            style={{ left: `${nowPct}%` }}
            data-testid="timeline-now"
            aria-label={t('rooms.now')}
          />
        )}
      </div>
      <div className="relative mt-1 h-4 text-[10px] text-muted-foreground">
        {hours.map((h) => {
          const pct = ((h - hours[0]!) / (hours[hours.length - 1]! - hours[0]!)) * 100;
          return (
            <span
              key={h}
              className="absolute -translate-x-1/2 tabular-nums"
              style={{ left: `${pct}%` }}
            >
              {String(h).padStart(2, '0')}
            </span>
          );
        })}
      </div>
    </div>
  );
}
