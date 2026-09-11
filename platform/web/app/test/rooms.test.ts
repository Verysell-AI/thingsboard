import { describe, expect, it } from 'vitest';
import type { Booking } from '@platform/shared/dto';
import { deriveRoomStatus } from '@platform/shared/dto';
import {
  ROOM_STATUS_VARIANT,
  isoAtLocalTime,
  layoutBookings,
  timelinePercent,
  timelineWindow,
} from '~/lib/rooms';

const TZ = 'Asia/Dubai';
/** 2026-09-07 10:00 Dubai */
const MON_10 = Date.UTC(2026, 8, 7, 6);

const booking = (start: string, end: string, extra: Partial<Booking> = {}): Booking => ({
  id: '00000000-0000-4000-8000-000000000001',
  roomId: '00000000-0000-4000-8000-000000000002',
  roomCode: '1.1',
  start,
  end,
  organiser: null,
  title: 'Sync',
  attendance: 'FULL',
  status: 'ACTIVE',
  createdAt: '2026-09-07T05:00:00.000Z',
  ...extra,
});

describe('room status', () => {
  it('maps occupancy and bookings to Free / Busy / Booked with a badge tone', () => {
    expect(deriveRoomStatus({ occupied: true, currentBooking: true })).toBe('BUSY');
    expect(deriveRoomStatus({ occupied: false, currentBooking: true })).toBe('BOOKED');
    expect(deriveRoomStatus({ occupied: false, currentBooking: false })).toBe('FREE');
    expect(ROOM_STATUS_VARIANT.BUSY).toBe('success');
    expect(ROOM_STATUS_VARIANT.BOOKED).toBe('warning');
  });
});

describe('booking timeline', () => {
  it('builds the 08:00–20:00 window in the tenant zone and positions instants', () => {
    const w = timelineWindow(MON_10, TZ);
    expect(w.from).toBe(Date.UTC(2026, 8, 7, 4));
    expect(w.to).toBe(Date.UTC(2026, 8, 7, 16));
    expect(timelinePercent(MON_10, w)).toBeCloseTo((2 / 12) * 100, 5);
    expect(timelinePercent(w.from - 1000, w)).toBe(0);
    expect(timelinePercent(w.to + 1000, w)).toBe(100);
  });

  it('lays out bookings as percent blocks, clipping to the window and dropping outside ones', () => {
    const w = timelineWindow(MON_10, TZ);
    const blocks = layoutBookings(
      [
        booking('2026-09-07T09:00:00+04:00', '2026-09-07T10:00:00+04:00'),
        booking('2026-09-07T19:30:00+04:00', '2026-09-07T21:00:00+04:00', {
          id: '00000000-0000-4000-8000-000000000003',
        }),
        booking('2026-09-08T09:00:00+04:00', '2026-09-08T10:00:00+04:00', {
          id: '00000000-0000-4000-8000-000000000004',
        }),
      ],
      w,
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.start).toBeCloseTo((1 / 12) * 100, 5);
    expect(blocks[0]!.width).toBeCloseTo((1 / 12) * 100, 5);
    expect(blocks[1]!.start + blocks[1]!.width).toBeCloseTo(100, 5);
  });

  it('turns a wall-clock time into an ISO instant in the zone', () => {
    expect(isoAtLocalTime(MON_10, TZ, '20:00')).toBe(
      new Date(Date.UTC(2026, 8, 7, 16)).toISOString(),
    );
  });
});
