import type { Step, StepInputs } from './types.js';
import { integrateKwh, jitter, round } from './types.js';

/** Always-on base load of a room (sensors, controllers), in watts. */
export const ROOM_BASE_LOAD_W = 15;

export interface RoomMeterState {
  energyKwh: number;
  powerW: number;
}

export interface RoomMeterInputs extends StepInputs {
  /** Sum of power_w of every device in the room. */
  devicesPowerW: number;
}

export function initialRoomMeterState(energyKwh = 0): RoomMeterState {
  return { energyKwh, powerW: 0 };
}

export const stepRoomMeter: Step<RoomMeterState, RoomMeterInputs> = (
  state,
  { dt, rand, devicesPowerW },
) => {
  const powerW = Math.max(0, devicesPowerW + jitter(ROOM_BASE_LOAD_W, 0.2, rand));
  const energyKwh = integrateKwh(state.energyKwh, powerW, dt);
  const voltage_v = round(jitter(230, 0.01, rand), 1);
  const pf = round(0.9 + rand() * 0.08, 3);
  return {
    state: { energyKwh, powerW },
    telemetry: { power_w: round(powerW, 1), energy_kwh: round(energyKwh, 4), voltage_v, pf },
  };
};
