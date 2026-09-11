import { describe, expect, it } from 'vitest';
import type { BookingsNowResponse } from '@platform/shared/dto';
import { BookingsFeed, bookingPeople, type ActiveBooking } from '../src/bookings.js';
import { buildSimulation, flush, monday, silentLog } from './helpers.js';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

function booking(
  n: number,
  roomCode: string,
  attendance: ActiveBooking['attendance'],
  start: number,
): ActiveBooking {
  return {
    id: id(n),
    roomCode,
    start,
    end: start + 60 * 60_000,
    attendance,
    organiserCode: 'E001',
    attendees: 4,
  };
}

function fakeFetch(handler: () => BookingsNowResponse | Error): {
  fetchImpl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    const out = handler();
    if (out instanceof Error) throw out;
    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('bookingPeople', () => {
  const start = monday(10);
  it('FULL from the start, LATE twelve minutes later, GHOST never', () => {
    const full = booking(1, '1.1', 'FULL', start);
    const late = booking(2, '1.2', 'LATE', start);
    const ghost = booking(3, '1.3', 'GHOST', start);
    expect(bookingPeople(full, start)).toBe(4);
    expect(bookingPeople(full, start - 1)).toBe(0);
    expect(bookingPeople(full, start + 60 * 60_000)).toBe(0);
    expect(bookingPeople(late, start)).toBe(0);
    expect(bookingPeople(late, start + 11 * 60_000)).toBe(0);
    expect(bookingPeople(late, start + 12 * 60_000)).toBe(4);
    expect(bookingPeople(ghost, start + 30 * 60_000)).toBe(0);
  });
});

describe('BookingsFeed', () => {
  it('caches the API answer per tenant and keeps it when the API fails', async () => {
    const start = monday(10);
    let answer: BookingsNowResponse | Error = {
      tenantKey: 'alpha',
      now: start,
      items: [booking(1, '1.1', 'FULL', start)],
    };
    const { fetchImpl, calls } = fakeFetch(() => answer);
    const feed = new BookingsFeed({
      apiUrl: 'http://api.test:4000/',
      internalToken: 't',
      log: silentLog,
      fetchImpl,
    });
    expect(feed.activeBookings('alpha')).toEqual([]);
    await feed.refresh(['alpha']);
    expect(calls[0]).toBe('http://api.test:4000/internal/bookings/now?tenant=alpha');
    expect(feed.activeBookings('alpha')).toHaveLength(1);
    expect(feed.activeBookings('beta')).toEqual([]);

    answer = new Error('connection refused');
    await feed.refresh(['alpha']);
    await feed.refresh(['alpha']);
    expect(feed.activeBookings('alpha')).toHaveLength(1);

    answer = { tenantKey: 'alpha', now: start, items: [] };
    await feed.refresh(['alpha']);
    expect(feed.activeBookings('alpha')).toEqual([]);
  });
});

describe('occupancy from bookings', () => {
  it('meeting-room sensors and projectors follow FULL, LATE and GHOST bookings', async () => {
    const now = { value: monday(10) };
    const start = monday(10);
    const active: ActiveBooking[] = [
      booking(1, '1.1', 'FULL', start),
      booking(2, '1.2', 'LATE', start),
      booking(3, '1.3', 'GHOST', start),
    ];
    const { sim, registry } = buildSimulation(now, 'alpha', {
      activeBookings: (tenant) => (tenant === 'alpha' ? active : []),
    });
    // avoid meeting-heavy laptops wandering into the rooms under test: 10:00 is an even hour
    await sim.start();
    await flush();
    sim.tick();
    expect(Number(registry.get('OCC-1.1')!.values.count)).toBe(4);
    expect(registry.get('OCC-1.1')!.values.occupied).toBe(1);
    expect(Number(registry.get('OCC-1.2')!.values.count)).toBe(0);
    expect(Number(registry.get('OCC-1.3')!.values.count)).toBe(0);
    expect(Number(registry.get('PLUG-1.1-PROJ')!.values.power_w)).toBeGreaterThan(20);
    expect(Number(registry.get('PLUG-1.3-PROJ')!.values.power_w)).toBeLessThan(20);

    now.value = start + 12 * 60_000;
    sim.tick();
    expect(Number(registry.get('OCC-1.2')!.values.count)).toBe(4);
    expect(Number(registry.get('OCC-1.3')!.values.count)).toBe(0);

    // everyone-leaves still empties the building regardless of bookings
    sim.scenario('alpha', 'everyone-leaves', {});
    sim.tick();
    expect(Number(registry.get('OCC-1.1')!.values.count)).toBe(0);
    sim.stop();
  });
});

describe('runtime laptops with a persona', () => {
  it('a standard persona laptop added at runtime connects during work hours', async () => {
    const now = { value: monday(10) };
    const { sim, registry } = buildSimulation(now);
    await sim.start();
    await flush();
    sim.addRuntimeDevice({
      tenant: 'alpha',
      code: 'LAPTOP-E900',
      type: 'laptop',
      accessToken: 'alpha-LAPTOP-E900',
      attrs: { room: '1.O', user: 'new.hire', persona: 'standard' },
    });
    const laptop = registry.get('LAPTOP-E900')!;
    expect(laptop.spec.laptop?.persona?.key).toBe('standard');
    expect(sim.link('alpha', 'LAPTOP-E900')!.active).toBe(false);
    sim.tick();
    expect(sim.link('alpha', 'LAPTOP-E900')!.active).toBe(true);
    now.value = monday(19);
    sim.tick();
    expect(sim.link('alpha', 'LAPTOP-E900')!.active).toBe(false);

    // unknown persona keys leave the laptop without a schedule
    sim.addRuntimeDevice({
      tenant: 'alpha',
      code: 'LAPTOP-E901',
      type: 'laptop',
      accessToken: 'alpha-LAPTOP-E901',
      attrs: { room: '1.O', persona: 'night_owl' },
    });
    expect(registry.get('LAPTOP-E901')!.spec.laptop?.persona).toBeNull();
    sim.stop();
  });
});
