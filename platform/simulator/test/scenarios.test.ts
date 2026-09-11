import { describe, expect, it } from 'vitest';
import { HEATER_LOAD_W } from '../src/scenarios.js';
import { buildSimulation, flush, monday } from './helpers.js';

describe('demo scenarios', () => {
  it('move-laptop relocates a laptop to a meeting room and back', async () => {
    const now = { value: monday(10) };
    const { sim, registry } = buildSimulation(now);
    await sim.start();
    await flush();
    sim.tick();
    const laptop = registry.laptops().find((d) => d.spec.laptop?.persona?.key === 'standard')!;
    const before = Number(registry.get('OCC-1.3')!.values.count);
    const r = sim.scenario('alpha', 'move-laptop', { code: laptop.code, room: '1.3' });
    expect(r.accepted).toBe(true);
    expect(laptop.laptopLocation(now.value)).toMatchObject({ room: '1.3', docked: false });
    now.value += 10_000;
    sim.tick();
    expect(laptop.values.ap).toBe('AP-1E');
    expect(Number(registry.get('OCC-1.3')!.values.count)).toBe(before + 1);
    // back to the desk room clears the override
    const home = laptop.spec.laptop!.deskRoom!;
    expect(sim.scenario('alpha', 'move-laptop', { code: laptop.code, room: home }).accepted).toBe(
      true,
    );
    expect(laptop.laptopLocation(now.value)).toMatchObject({ room: home, docked: true });
    expect(sim.scenario('alpha', 'move-laptop', { code: laptop.code, room: '9.9' }).accepted).toBe(
      false,
    );
    expect(sim.scenario('alpha', 'move-laptop', { code: 'LIGHT-1.1', room: '1.3' }).accepted).toBe(
      false,
    );
    sim.stop();
  });

  it('late-worker-stays keeps one laptop online through the evening and everyone-leaves', async () => {
    const now = { value: monday(10) };
    const { sim, registry } = buildSimulation(now);
    await sim.start();
    await flush();
    sim.tick();
    const standard = registry.laptops().filter((d) => d.spec.laptop?.persona?.key === 'standard');
    const late = standard[0]!;
    const other = standard[1]!;
    const r = sim.scenario('alpha', 'late-worker-stays', {
      employeeId: late.spec.laptop!.employeeCode,
    });
    expect(r.accepted).toBe(true);
    expect(r.message).toContain(late.code);
    now.value = monday(21);
    sim.tick();
    expect(sim.link('alpha', late.code)!.active).toBe(true);
    expect(sim.link('alpha', other.code)!.active).toBe(false);
    expect(sim.scenario('alpha', 'everyone-leaves', {}).accepted).toBe(true);
    sim.tick();
    expect(sim.link('alpha', late.code)!.active).toBe(true);
    now.value = monday(23, 45);
    sim.tick();
    expect(sim.link('alpha', late.code)!.active).toBe(false);
    expect(sim.scenario('alpha', 'late-worker-stays', { employeeId: 'E999' }).accepted).toBe(false);
    // the laptop code form also works
    expect(sim.scenario('alpha', 'late-worker-stays', { employeeId: other.code }).accepted).toBe(
      true,
    );
    sim.stop();
  });

  it('heater-left-on adds 1500 W to a pantry plug and toggles off again', async () => {
    const now = { value: monday(10) };
    const { sim, registry } = buildSimulation(now);
    await sim.start();
    await flush();
    for (let i = 0; i < 3; i++) {
      now.value += 10_000;
      sim.tick();
    }
    const meter = registry.get('RM-1.P')!;
    const before = Number(meter.values.power_w);
    const on = sim.scenario('alpha', 'heater-left-on', { room: '1.P' });
    expect(on.accepted).toBe(true);
    expect(on.details?.heaterOn).toBe(true);
    now.value += 10_000;
    sim.tick();
    const during = Number(meter.values.power_w);
    expect(during - before).toBeGreaterThan(HEATER_LOAD_W * 0.85);
    expect(during - before).toBeLessThan(HEATER_LOAD_W * 1.15);
    expect(Number(registry.get('FM-1')!.values.power_w)).toBeGreaterThan(during);
    const off = sim.scenario('alpha', 'heater-left-on', { room: '1.P' });
    expect(off.details?.heaterOn).toBe(false);
    now.value += 10_000;
    sim.tick();
    expect(Math.abs(Number(meter.values.power_w) - before)).toBeLessThan(HEATER_LOAD_W * 0.3);
    expect(sim.scenario('alpha', 'heater-left-on', { room: 'F1' }).accepted).toBe(false);
    sim.stop();
  });

  it('ac-filter-degrade pushes the current past 1.25 x nominal within ten minutes, and resets', async () => {
    const now = { value: monday(10) };
    const { sim, registry } = buildSimulation(now);
    await sim.start();
    await flush();
    sim.tick();
    const ac = registry.get('AC-2.3')!;
    const nominal = ac.spec.world?.type === 'ac' ? ac.spec.world.nominalCurrentA : 0;
    expect(nominal).toBeGreaterThan(0);
    expect(sim.scenario('alpha', 'ac-filter-degrade', { code: ac.code }).details?.accelerated).toBe(
      true,
    );
    let crossedAt: number | null = null;
    for (let i = 0; i < 60; i++) {
      now.value += 10_000;
      sim.tick();
      if (Number(ac.values.current_a) > nominal * 1.25) {
        crossedAt = i * 10;
        break;
      }
    }
    expect(crossedAt).not.toBeNull();
    expect(crossedAt!).toBeLessThanOrEqual(600);
    const reset = sim.scenario('alpha', 'ac-filter-degrade', { code: ac.code });
    expect(reset.details?.accelerated).toBe(false);
    now.value += 10_000;
    sim.tick();
    expect(Number(ac.values.current_a)).toBeLessThan(nominal * 1.25);
    expect(sim.scenario('alpha', 'ac-filter-degrade', { code: 'LIGHT-1.1' }).accepted).toBe(false);
    sim.stop();
  });

  it('ghost-meeting is an accepted no-op owned by the API', () => {
    const { sim } = buildSimulation({ value: monday(10) });
    const r = sim.scenario('alpha', 'ghost-meeting', { room: '1.4' });
    expect(r.accepted).toBe(true);
    expect(r.message).toMatch(/API/);
  });
});
