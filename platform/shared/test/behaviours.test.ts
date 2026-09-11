import { describe, expect, it } from 'vitest';
import {
  createRng,
  initialAcState,
  initialFloorMeterState,
  initialLaptopState,
  initialLightState,
  initialPlugState,
  initialRoomMeterState,
  isAtWork,
  stepAc,
  stepFloorMeter,
  stepLaptop,
  stepLight,
  stepPlug,
  stepRoomMeter,
  FLOOR_CORE_LOAD_W,
  ROOM_BASE_LOAD_W,
} from '../src/behaviours/index.js';
import type { Persona } from '../src/dataset/schema.js';

const inputs = (dt = 10) => ({ now: Date.now(), dt, rand: createRng('test') });

describe('behaviours', () => {
  it('light draws nominal power only when on', () => {
    const off = stepLight(initialLightState(60, 0), inputs());
    expect(off.telemetry.power_w).toBe(0);
    const on = stepLight(initialLightState(60, 1), inputs());
    expect(on.telemetry.power_w).toBeGreaterThan(55);
    expect(on.telemetry.power_w).toBeLessThan(65);
  });

  it('plug energy is monotonic and integrates power over time', () => {
    let state = initialPlugState(1000, 0, { on: 1, inUse: true });
    let last = 0;
    for (let i = 0; i < 360; i++) {
      const r = stepPlug(state, inputs(10));
      state = r.state;
      expect(state.energyKwh).toBeGreaterThanOrEqual(last);
      last = state.energyKwh;
    }
    // 1 kW for one hour ≈ 1 kWh (±5 % jitter)
    expect(last).toBeGreaterThan(0.9);
    expect(last).toBeLessThan(1.1);
  });

  it('AC cools towards the setpoint, accumulates runtime and degrades current when flagged', () => {
    let healthy = initialAcState(1000, 4.2, { on: 1, roomTempC: 27, setpointC: 22 });
    let degrading = initialAcState(1000, 4.2, {
      on: 1,
      roomTempC: 27,
      setpointC: 22,
      filterDegrading: true,
    });
    for (let i = 0; i < 720; i++) {
      healthy = stepAc(healthy, inputs(10)).state;
      degrading = stepAc(degrading, inputs(10)).state;
    }
    expect(healthy.roomTempC).toBeLessThan(23);
    expect(healthy.runtimeH).toBeCloseTo(2, 1);
    expect(healthy.degradeFactor).toBe(1);
    expect(degrading.degradeFactor).toBeGreaterThan(1.015);
    const off = stepAc(initialAcState(1000, 4.2), inputs());
    expect(off.telemetry.power_w).toBe(0);
    expect(off.telemetry.current_a).toBe(0);
  });

  it('room meter equals device power plus base load, floor meter equals rooms plus core load', () => {
    const room = stepRoomMeter(initialRoomMeterState(), { ...inputs(), devicesPowerW: 1000 });
    expect(room.telemetry.power_w).toBeGreaterThan(1000 + ROOM_BASE_LOAD_W * 0.8);
    expect(room.telemetry.power_w).toBeLessThan(1000 + ROOM_BASE_LOAD_W * 1.2);
    const floor = stepFloorMeter(initialFloorMeterState(), { ...inputs(), roomsPowerW: 5000 });
    expect(floor.telemetry.power_w).toBeGreaterThan(5000 + FLOOR_CORE_LOAD_W * 0.97);
    expect(floor.telemetry.power_w).toBeLessThan(5000 + FLOOR_CORE_LOAD_W * 1.03);
    expect(floor.telemetry.current_a).toBeGreaterThan(20);
  });

  it('laptop battery charges when docked and drains otherwise', () => {
    const docked = stepLaptop(initialLaptopState('u', 50), {
      ...inputs(3600),
      ap: 'AP-1W',
      docked: true,
    });
    const mobile = stepLaptop(initialLaptopState('u', 50), {
      ...inputs(3600),
      ap: 'AP-1E',
      docked: false,
    });
    expect(docked.state.battery).toBeGreaterThan(50);
    expect(mobile.state.battery).toBeLessThan(50);
    expect(mobile.telemetry.ap).toBe('AP-1E');
  });

  it('rng is deterministic per seed', () => {
    const a = createRng('LIGHT-1.1');
    const b = createRng('LIGHT-1.1');
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('persona schedule', () => {
  const standard: Persona = {
    key: 'standard',
    name: 'Standard',
    arrive: '09:00',
    leave: '18:00',
    meetings: 2,
  };
  const remote: Persona = {
    key: 'remote_today',
    name: 'Remote',
    arrive: null,
    leave: null,
    meetings: 0,
  };
  // Instants are built in UTC so the test is independent of the machine's zone: Dubai is UTC+4.
  const monday10 = Date.UTC(2026, 8, 7, 6, 0); // 2026-09-07 10:00 Dubai, a Monday
  const monday23 = Date.UTC(2026, 8, 7, 19, 0);
  const saturday10 = Date.UTC(2026, 8, 12, 6, 0);

  it('standard persona is at work at 10:00 and not at 23:00 on a weekday, read in Dubai time', () => {
    expect(isAtWork(standard, monday10)).toBe(true);
    expect(isAtWork(standard, monday23)).toBe(false);
    // the same instant is 09:00 in Paris (arrival) and 02:00 in New York
    expect(isAtWork(standard, monday10, 'Europe/Paris')).toBe(false);
    expect(isAtWork(standard, monday10 + 3_600_000, 'Europe/Paris')).toBe(true);
    expect(isAtWork(standard, monday10, 'America/New_York')).toBe(false);
  });

  it('nobody is at work on weekends', () => {
    expect(isAtWork(standard, saturday10)).toBe(false);
    expect(isAtWork(standard, new Date(saturday10))).toBe(false);
  });

  it('remote persona is never at work', () => {
    expect(isAtWork(remote, monday10)).toBe(false);
    expect(isAtWork(remote, monday10 + 3 * 3_600_000)).toBe(false);
  });
});
