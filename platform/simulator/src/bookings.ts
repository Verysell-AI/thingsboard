import { INTERNAL_TOKEN_HEADER } from '@platform/shared/contracts';
import {
  BookingsNowResponseSchema,
  LATE_ARRIVAL_MINUTES,
  type BookingsNowResponse,
} from '@platform/shared/dto';
import type { Logger } from './mqtt.js';

export type ActiveBooking = BookingsNowResponse['items'][number];

/** What the registry asks about bookings; the feed implements it, tests can fake it. */
export interface BookingsSource {
  activeBookings(tenant: string): ActiveBooking[];
}

export interface BookingsFeedOptions {
  apiUrl: string;
  internalToken: string;
  log: Logger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Polls the API for the bookings active right now (by the tenant's business clock) and keeps the
 * latest answer per tenant. A failing API is logged once and the previous data is kept, so meeting
 * rooms do not empty out because the platform restarted.
 */
export class BookingsFeed implements BookingsSource {
  private readonly cache = new Map<string, BookingsNowResponse>();
  private readonly failing = new Set<string>();
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: BookingsFeedOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  activeBookings(tenant: string): ActiveBooking[] {
    return this.cache.get(tenant)?.items ?? [];
  }

  /** Last successful answer for a tenant, if any. */
  snapshot(tenant: string): BookingsNowResponse | undefined {
    return this.cache.get(tenant);
  }

  async refresh(tenants: readonly string[]): Promise<void> {
    await Promise.all(tenants.map((t) => this.refreshTenant(t)));
  }

  private async refreshTenant(tenant: string): Promise<void> {
    const url = `${this.opts.apiUrl.replace(/\/$/, '')}/internal/bookings/now?tenant=${encodeURIComponent(tenant)}`;
    try {
      const res = await this.fetchImpl(url, {
        headers: { [INTERNAL_TOKEN_HEADER]: this.opts.internalToken },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = BookingsNowResponseSchema.parse(await res.json());
      this.cache.set(tenant, body);
      if (this.failing.delete(tenant))
        this.opts.log.info({ tenant }, 'bookings feed: API reachable again');
    } catch (err) {
      if (!this.failing.has(tenant)) {
        this.failing.add(tenant);
        this.opts.log.warn(
          { tenant, err: err instanceof Error ? err.message : String(err) },
          'bookings feed: API unavailable, keeping the last known bookings',
        );
      }
    }
  }
}

/**
 * People a booking puts in its room at business time `now`: a FULL meeting from its start, a LATE
 * one twelve minutes after, a GHOST one never.
 */
export function bookingPeople(booking: ActiveBooking, now: number): number {
  if (now < booking.start || now >= booking.end) return 0;
  switch (booking.attendance) {
    case 'FULL':
      return booking.attendees;
    case 'LATE':
      return now >= booking.start + LATE_ARRIVAL_MINUTES * 60_000 ? booking.attendees : 0;
    case 'GHOST':
      return 0;
  }
}

/** Sum over the room's active bookings. */
export function bookingPeopleInRoom(
  bookings: readonly ActiveBooking[],
  room: string,
  now: number,
): number {
  let n = 0;
  for (const b of bookings) if (b.roomCode === room) n += bookingPeople(b, now);
  return n;
}
