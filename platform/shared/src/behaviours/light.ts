import type { Step } from './types.js';
import { jitter, round } from './types.js';

export interface LightState {
  on: 0 | 1;
  nominalPowerW: number;
}

/** Default nominal power by room kind (context §5.3). */
export const LIGHT_POWER_W = { meeting: 60, open_plan: 240, other: 40 } as const;

export function initialLightState(nominalPowerW: number, on: 0 | 1 = 0): LightState {
  return { on, nominalPowerW };
}

export const stepLight: Step<LightState> = (state, { rand }) => {
  const power_w = state.on ? round(jitter(state.nominalPowerW, 0.02, rand), 1) : 0;
  return { state, telemetry: { state: state.on, power_w } };
};

export function lightPowerW(state: LightState): number {
  return state.on ? state.nominalPowerW : 0;
}
