import { describe, expect, it } from 'vitest';
import { FLOOR_CORE_LOAD_W } from '@platform/shared/behaviours';
import { applyClockCommand, liveClock, zonedDateParts } from '@platform/shared/clock';
import { TZ, buildSimulation, flush, monday } from './helpers.js';

describe('registry ticks', () => {
  it('keeps energy_kwh monotonic for plugs and room meters over 100 ticks', async () => {
    const now = { value: monday(10) };
    const { sim, registry, clients } = buildSimulation(now);
    await sim.start();
    await flush();
    const plug = registry.get('PLUG-1.P-COFFEE')!;
    const meter = registry.get('RM-1.O')!;
    let lastPlug = -1;
    let lastMeter = -1;
    for (let i = 0; i < 100; i++) {
      now.value += 10_000;
      sim.tick();
      const p = Number(plug.values.energy_kwh);
      const m = Number(meter.values.energy_kwh);
      expect(p).toBeGreaterThanOrEqual(lastPlug);
      expect(m).toBeGreaterThanOrEqual(lastMeter);
      lastPlug = p;
      lastMeter = m;
    }
    expect(lastMeter).toBeGreaterThan(0);
    const client = clients.get(meter.accessToken)!;
    const telemetry = client.published.filter((p) => p.topic === 'v1/devices/me/telemetry');
    expect(telemetry.length).toBe(100);
    const first = JSON.parse(telemetry[0]!.payload) as {
      ts: number;
      values: Record<string, number>;
    };
    expect(first.ts).toBe(monday(10) + 10_000);
    sim.stop();
  });

  it('floor meter power equals room meters plus core load', async () => {
    const now = { value: monday(10) };
    const { sim, registry } = buildSimulation(now);
    await sim.start();
    await flush();
    now.value += 10_000;
    sim.tick();
    const rooms = registry.all().filter((d) => d.type === 'room_meter' && d.floor === 1);
    const sum = rooms.reduce((acc, d) => acc + Number(d.values.power_w), 0);
    const floor = Number(registry.get('FM-1')!.values.power_w);
    expect(sum).toBeGreaterThan(1000);
    expect(floor).toBeGreaterThan(sum + FLOOR_CORE_LOAD_W * 0.96);
    expect(floor).toBeLessThan(sum + FLOOR_CORE_LOAD_W * 1.04);
    // the room meter itself reports the room's consumers plus base load
    const openPlanDevices = registry.roomPowerW('1.O');
    expect(Number(registry.get('RM-1.O')!.values.power_w)).toBeGreaterThan(openPlanDevices);
    sim.stop();
  });
});

describe('laptop presence', () => {
  it('a standard persona laptop is connected at 10:00 on a Monday and offline at 23:00', async () => {
    const now = { value: monday(10) };
    const { sim, registry } = buildSimulation(now);
    const laptop = registry.laptops().find((d) => d.spec.laptop?.persona?.key === 'standard')!;
    expect(laptop.shouldBeOnline(monday(10))).toBe(true);
    expect(laptop.shouldBeOnline(monday(23))).toBe(false);
    await sim.start();
    await flush();
    expect(sim.link('alpha', laptop.code)!.connected).toBe(true);
    expect(registry.isOnline(laptop.code)).toBe(true);
    const remote = registry.laptops().find((d) => d.spec.laptop?.persona?.key === 'remote_today')!;
    expect(sim.link('alpha', remote.code)!.active).toBe(false);

    now.value = monday(23);
    sim.tick();
    expect(sim.link('alpha', laptop.code)!.active).toBe(false);
    expect(registry.isOnline(laptop.code)).toBe(false);
    sim.stop();
  });

  it('meeting-heavy laptops sit in a meeting room during odd hours and are counted by occupancy', async () => {
    const now = { value: monday(11, 10) };
    const { sim, registry } = buildSimulation(now);
    await sim.start();
    await flush();
    sim.tick();
    const heavy = registry.laptops().filter((d) => d.spec.laptop?.persona?.key === 'meeting_heavy');
    expect(heavy.length).toBeGreaterThan(0);
    for (const d of heavy) {
      const loc = d.laptopLocation(now.value);
      expect(registry.world.rooms.find((r) => r.code === loc.room)?.kind).toBe('meeting');
      expect(d.values.ap).toBe(loc.accessPoint);
      const occ = registry.get(`OCC-${loc.room}`)!;
      expect(Number(occ.values.count)).toBeGreaterThanOrEqual(1);
      expect(occ.values.occupied).toBe(1);
      expect(Number(registry.get(`PLUG-${loc.room}-PROJ`)!.values.power_w)).toBeGreaterThan(20);
    }
    now.value = monday(12, 10);
    sim.tick();
    for (const d of heavy) expect(d.laptopLocation(now.value).room).toBe(d.spec.laptop!.deskRoom);
    sim.stop();
  });
});

describe('rpc', () => {
  it('setState 0 on an AC unit replies ok and drops power on the next step', async () => {
    const now = { value: monday(10) };
    const { sim, registry, clients } = buildSimulation(now);
    await sim.start();
    await flush();
    sim.tick();
    const ac = registry.get('AC-1.2')!;
    expect(Number(ac.values.power_w)).toBeGreaterThan(0);
    const client = clients.get(ac.accessToken)!;
    client.deliverRpc('7', { method: 'setState', params: { state: 0 } });
    const reply = client.published.find((p) => p.topic === 'v1/devices/me/rpc/response/7');
    expect(reply).toBeDefined();
    expect(JSON.parse(reply!.payload)).toEqual({ ok: true, state: 0 });
    now.value += 10_000;
    sim.tick();
    expect(ac.values.state).toBe(0);
    expect(ac.values.power_w).toBe(0);
    expect(ac.currentPowerW()).toBe(0);

    expect(ac.applyRpc({ method: 'setSetpoint', params: { setpoint_c: 21 } })).toEqual({
      ok: true,
      setpoint_c: 21,
    });
    expect(ac.applyRpc({ method: 'nope' }).ok).toBe(false);
    expect(registry.get('RM-1.2')!.applyRpc({ method: 'setState', params: { state: 1 } }).ok).toBe(
      false,
    );
    sim.stop();
  });
});

describe('scenarios', () => {
  it('new-laptop-first-boot connects a remote laptop; everyone-leaves takes all offline; lunch-peak raises load', async () => {
    const now = { value: monday(10) };
    const { sim, registry } = buildSimulation(now);
    await sim.start();
    await flush();
    sim.tick();
    const remote = registry.laptops().find((d) => d.spec.laptop?.persona?.key === 'remote_today')!;
    const r = sim.scenario('alpha', 'new-laptop-first-boot', { code: remote.code });
    expect(r.accepted).toBe(true);
    sim.tick();
    expect(sim.link('alpha', remote.code)!.active).toBe(true);
    expect(sim.scenario('alpha', 'new-laptop-first-boot', { code: 'LIGHT-1.1' }).accepted).toBe(
      false,
    );

    // let the AC units settle at their setpoint before measuring the peak
    for (let i = 0; i < 90; i++) {
      now.value += 10_000;
      sim.tick();
    }
    const before = Number(registry.get('FM-1')!.values.power_w);
    sim.scenario('alpha', 'lunch-peak', {});
    now.value += 10_000;
    sim.tick();
    now.value += 10_000;
    sim.tick();
    const during = Number(registry.get('FM-1')!.values.power_w);
    expect(during).toBeGreaterThan(before * 1.2);
    expect(registry.get('AC-1.1')!.values.setpoint_c).toBe(18);

    expect(sim.scenario('alpha', 'everyone-leaves', {}).accepted).toBe(true);
    sim.tick();
    for (const d of registry.laptops()) expect(sim.link('alpha', d.code)!.active).toBe(false);
    expect(registry.get('OCC-1.1')!.values.occupied).toBe(0);

    now.value += 11 * 60_000;
    sim.tick();
    expect(registry.get('AC-1.1')!.values.setpoint_c).toBe(23);
    expect(sim.scenario('alpha', 'ghost-meeting', {}).accepted).toBe(true);
    expect(sim.scenario('nope', 'lunch-peak', {}).accepted).toBe(false);
    sim.stop();
  });
});

describe('business clock (time machine)', () => {
  it('a jump to the evening takes leavers offline and keeps the late worker; telemetry keeps real ts', async () => {
    const now = { value: monday(10) };
    const { sim, registry, clients } = buildSimulation(now);
    await sim.start();
    await flush();
    sim.tick();
    const standard = registry.laptops().find((d) => d.spec.laptop?.persona?.key === 'standard')!;
    const late = registry.laptops().find((d) => d.spec.laptop?.persona?.key === 'late_worker')!;
    expect(sim.link('alpha', standard.code)!.active).toBe(true);
    expect(sim.clock('alpha')!.live).toBe(true);

    const evening = applyClockCommand(
      liveClock(),
      { op: 'jumpToTime', time: '20:00', dayOffset: 0 },
      now.value,
      TZ,
    );
    const snapshot = sim.setClock('alpha', evening);
    expect(zonedDateParts(snapshot.virtualNow, TZ)).toMatchObject({ hour: 20, minute: 0 });
    expect(zonedDateParts(sim.now('alpha'), TZ).hour).toBe(20);
    expect(sim.now('beta' /* unknown tenant */)).toBe(now.value);

    now.value += 10_000;
    sim.tick();
    expect(sim.link('alpha', standard.code)!.active).toBe(false);
    expect(sim.link('alpha', late.code)!.active).toBe(true);
    // meeting rooms are empty at 20:00, so the projector plugs idle
    expect(Number(registry.get('PLUG-1.1-PROJ')!.values.power_w)).toBeLessThan(20);
    // published timestamps are the real clock, not the virtual one
    const client = clients.get(registry.get('RM-1.O')!.accessToken)!;
    const last = client.published.filter((p) => p.topic === 'v1/devices/me/telemetry').at(-1)!;
    expect((JSON.parse(last.payload) as { ts: number }).ts).toBe(now.value);
    sim.stop();
  });

  it('a fast clock integrates energy by virtual time and sub-steps long spans', async () => {
    const now = { value: monday(10) };
    const { sim, registry } = buildSimulation(now);
    await sim.start();
    await flush();
    sim.tick();
    const meter = registry.get('RM-1.O')!;
    const before = Number(meter.values.energy_kwh);
    const power = Number(meter.values.power_w);

    // 60x: ten real seconds are ten virtual minutes
    sim.setClock(
      'alpha',
      applyClockCommand(liveClock(), { op: 'speed', speed: 60 }, now.value, TZ),
    );
    now.value += 10_000;
    sim.tick();
    const after = Number(meter.values.energy_kwh);
    const expected = (power * 600) / 3_600_000;
    expect(after - before).toBeGreaterThan(expected * 0.8);
    expect(after - before).toBeLessThan(expected * 1.25);
    expect(zonedDateParts(sim.now('alpha'), TZ)).toMatchObject({ hour: 10, minute: 10 });

    // an eight-hour jump settles AC temperatures at the setpoint instead of exploding
    sim.setClock(
      'alpha',
      applyClockCommand(
        sim.clock('alpha')!.state,
        { op: 'jumpBy', ms: 8 * 3_600_000 },
        now.value,
        TZ,
      ),
    );
    now.value += 10_000;
    sim.tick();
    const ac = registry.get('AC-1.1')!;
    expect(Number(ac.values.room_temp_c)).toBeGreaterThanOrEqual(16);
    expect(Number(ac.values.room_temp_c)).toBeLessThanOrEqual(35);
    expect(Number(meter.values.energy_kwh)).toBeGreaterThan(after + 1);

    // paused: virtual time stands still and energy stops accumulating
    sim.setClock(
      'alpha',
      applyClockCommand(sim.clock('alpha')!.state, { op: 'speed', speed: 0 }, now.value, TZ),
    );
    const frozen = sim.now('alpha');
    const kwh = Number(meter.values.energy_kwh);
    now.value += 60_000;
    sim.tick();
    expect(sim.now('alpha')).toBe(frozen);
    expect(Number(meter.values.energy_kwh)).toBeCloseTo(kwh, 3);
    expect(sim.state().clocks.alpha?.speed).toBe(0);

    // reset: back to the real clock
    sim.setClock('alpha', liveClock());
    expect(sim.now('alpha')).toBe(now.value);
    expect(sim.clock('alpha')!.live).toBe(true);
    sim.stop();
  });
});
