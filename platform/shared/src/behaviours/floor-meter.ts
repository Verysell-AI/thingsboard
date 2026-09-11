import type { Step, StepInputs } from './types.js';
import { DEFAULT_POWER_FACTOR, MAINS_VOLTAGE_V, integrateKwh, jitter, round } from './types.js';

export interface FloorMeterState {
  energyKwh: number;
  powerW: number;
  coreLoadW: number;
}

export interface FloorMeterInputs extends StepInputs {
  /** Sum of power_w reported by the floor's room meters. */
  roomsPowerW: number;
}

/** Core load (lifts, corridors, network) per floor, in watts; the server room adds its own on top. */
export const FLOOR_CORE_LOAD_W = 600;
export const SERVER_ROOM_EXTRA_LOAD_W = 2500;

export function initialFloorMeterState(
  coreLoadW = FLOOR_CORE_LOAD_W,
  energyKwh = 0,
): FloorMeterState {
  return { energyKwh, powerW: 0, coreLoadW };
}

export const stepFloorMeter: Step<FloorMeterState, FloorMeterInputs> = (
  state,
  { dt, rand, roomsPowerW },
) => {
  const powerW = Math.max(0, roomsPowerW + jitter(state.coreLoadW, 0.03, rand));
  const energyKwh = integrateKwh(state.energyKwh, powerW, dt);
  const pf = round(0.9 + rand() * 0.07, 3);
  const current_a = round(powerW / MAINS_VOLTAGE_V / (pf || DEFAULT_POWER_FACTOR), 2);
  return {
    state: { ...state, energyKwh, powerW },
    telemetry: {
      power_w: round(powerW, 1),
      energy_kwh: round(energyKwh, 4),
      current_a,
      voltage_v: round(jitter(230, 0.01, rand), 1),
      pf,
    },
  };
};
