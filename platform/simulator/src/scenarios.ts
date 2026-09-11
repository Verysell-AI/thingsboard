import { zonedDateParts, zonedTimeToEpoch } from '@platform/shared/clock';
import type { ScenarioName, ScenarioParams, ScenarioResult } from '@platform/shared/dto';
import type { Registry } from './registry.js';
import type { Simulation } from './simulation.js';

export const FIRST_BOOT_ONLINE_MS = 60_000;
export const LUNCH_PEAK_MS = 10 * 60_000;
/** Load a forgotten heater adds behind a plug. */
export const HEATER_LOAD_W = 1500;
/** The late worker keeps working until this business time. */
export const LATE_WORKER_UNTIL = { hour: 23, minute: 30 };

/**
 * Applies a scenario to one tenant. Scenarios only touch device and registry state; the next tick
 * publishes the effect. Scenarios not yet supported answer with accepted=false.
 */
export function runScenario(
  sim: Simulation,
  registry: Registry,
  name: ScenarioName,
  params: ScenarioParams,
  now: number,
): ScenarioResult {
  switch (name) {
    case 'new-laptop-first-boot': {
      if (!params.code) return { scenario: name, accepted: false, message: 'code is required' };
      const device = registry.get(params.code);
      if (!device || device.type !== 'laptop') {
        return { scenario: name, accepted: false, message: `laptop ${params.code} not found` };
      }
      const until = now + FIRST_BOOT_ONLINE_MS;
      device.forceOnline(until);
      sim.link(registry.tenant, device.code)?.connect();
      // when the forced window ends the laptop stays offline for the rest of the (business) day
      const timer = setTimeout(() => {
        if (registry.get(device.code) === device) device.leaveForToday(sim.now(registry.tenant));
      }, FIRST_BOOT_ONLINE_MS);
      timer.unref?.();
      return {
        scenario: name,
        accepted: true,
        message: `${device.code} online for ${FIRST_BOOT_ONLINE_MS / 1000} s, then offline`,
        details: { code: device.code, onlineUntil: until },
      };
    }
    case 'everyone-leaves': {
      registry.everyoneLeaves(now);
      return {
        scenario: name,
        accepted: true,
        message: `${registry.laptops().length} laptops leaving; occupancy cleared until tomorrow`,
      };
    }
    case 'lunch-peak': {
      registry.startPeak(now, LUNCH_PEAK_MS);
      return {
        scenario: name,
        accepted: true,
        message: `all AC at full output and appliances in use for ${LUNCH_PEAK_MS / 60_000} min`,
        details: { until: now + LUNCH_PEAK_MS },
      };
    }
    case 'late-worker-stays': {
      const ref = params.employeeId ?? params.code;
      if (!ref) return { scenario: name, accepted: false, message: 'employeeId is required' };
      const device = registry.laptopForEmployee(ref);
      if (!device) return { scenario: name, accepted: false, message: `no laptop for ${ref}` };
      const parts = zonedDateParts(now, registry.timeZone);
      const until = zonedTimeToEpoch(
        { ...parts, hour: LATE_WORKER_UNTIL.hour, minute: LATE_WORKER_UNTIL.minute, second: 0 },
        registry.timeZone,
      );
      device.forceOnline(Math.max(until, now + 60_000));
      device.forceLocation(null);
      sim.link(registry.tenant, device.code)?.connect();
      return {
        scenario: name,
        accepted: true,
        message: `${device.code} stays online at its desk until ${String(LATE_WORKER_UNTIL.hour).padStart(2, '0')}:${String(LATE_WORKER_UNTIL.minute).padStart(2, '0')}`,
        details: { code: device.code, room: device.laptopLocation(now).room, onlineUntil: until },
      };
    }
    case 'move-laptop': {
      if (!params.code) return { scenario: name, accepted: false, message: 'code is required' };
      const device = registry.get(params.code) ?? registry.laptopForEmployee(params.code);
      if (!device || device.type !== 'laptop') {
        return { scenario: name, accepted: false, message: `laptop ${params.code} not found` };
      }
      if (!params.room) return { scenario: name, accepted: false, message: 'room is required' };
      const room = registry.world.rooms.find((r) => r.code === params.room);
      if (!room)
        return { scenario: name, accepted: false, message: `room ${params.room} not found` };
      const home = device.spec.laptop?.deskRoom ?? device.room;
      device.forceLocation(room.code === home ? null : room.code);
      const loc = device.laptopLocation(now);
      return {
        scenario: name,
        accepted: true,
        message:
          room.code === home
            ? `${device.code} is back at its desk in ${room.code}`
            : `${device.code} now reports from ${room.code} (${loc.accessPoint})`,
        details: { code: device.code, room: loc.room, accessPoint: loc.accessPoint },
      };
    }
    case 'heater-left-on': {
      if (!params.room) return { scenario: name, accepted: false, message: 'room is required' };
      const plugs = registry.plugsInRoom(params.room);
      if (plugs.length === 0) {
        return { scenario: name, accepted: false, message: `no plug in room ${params.room}` };
      }
      const running = plugs.find((p) => p.extraLoadW() > 0);
      if (running) {
        running.setExtraLoadW(0);
        return {
          scenario: name,
          accepted: true,
          message: `heater off: ${running.code} back to normal`,
          details: { code: running.code, room: params.room, heaterOn: false },
        };
      }
      const preferred =
        plugs.find((p) =>
          ['heater', 'other'].includes(p.spec.world?.type === 'plug' ? p.spec.world.appliance : ''),
        ) ?? plugs[0]!;
      preferred.setExtraLoadW(HEATER_LOAD_W);
      return {
        scenario: name,
        accepted: true,
        message: `heater on: ${preferred.code} draws an extra ${HEATER_LOAD_W} W`,
        details: {
          code: preferred.code,
          room: params.room,
          heaterOn: true,
          extraLoadW: HEATER_LOAD_W,
        },
      };
    }
    case 'ac-filter-degrade': {
      if (!params.code) return { scenario: name, accepted: false, message: 'code is required' };
      const device = registry.get(params.code);
      if (!device || device.type !== 'ac') {
        return { scenario: name, accepted: false, message: `AC unit ${params.code} not found` };
      }
      const accelerate = !device.filterDriftAccelerated;
      device.setFilterDrift(accelerate);
      return {
        scenario: name,
        accepted: true,
        message: accelerate
          ? `${device.code} filter clogging at demo speed: current +3 % per minute`
          : `${device.code} filter reset to healthy`,
        details: { code: device.code, accelerated: accelerate },
      };
    }
    case 'ghost-meeting':
      return {
        scenario: name,
        accepted: true,
        message: 'ghost meetings are bookings: the platform API creates them, nothing to simulate',
        details: { room: params.room ?? null },
      };
  }
}
