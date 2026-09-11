import type { Step, StepInputs } from './types.js';
import { integrateKwh, jitter, round } from './types.js';

export interface PlugState {
  /** Relay state; 0 means no power flows. */
  on: 0 | 1;
  /** Whether the appliance behind the plug is actively working (projector showing, fridge compressor). */
  inUse: boolean;
  nominalPowerW: number;
  standbyPowerW: number;
  /** Extra load injected by scenarios (a heater left on). */
  extraLoadW: number;
  energyKwh: number;
  powerW: number;
}

/** A projector plug above this draw means the projector is in use (context: Level 1 inference). */
export const PROJECTOR_IN_USE_THRESHOLD_W = 20;

export interface PlugInputs extends StepInputs {
  /** Overrides inUse for this step (e.g. projector on while a meeting is running). */
  inUse?: boolean;
}

export function initialPlugState(
  nominalPowerW: number,
  standbyPowerW = 0,
  opts: Partial<Pick<PlugState, 'on' | 'inUse' | 'energyKwh'>> = {},
): PlugState {
  return {
    on: opts.on ?? 1,
    inUse: opts.inUse ?? false,
    nominalPowerW,
    standbyPowerW,
    extraLoadW: 0,
    energyKwh: opts.energyKwh ?? 0,
    powerW: 0,
  };
}

export const stepPlug: Step<PlugState, PlugInputs> = (state, { dt, rand, inUse }) => {
  const active = inUse ?? state.inUse;
  let powerW = 0;
  if (state.on) {
    powerW =
      jitter(active ? state.nominalPowerW : state.standbyPowerW, 0.05, rand) + state.extraLoadW;
  }
  const energyKwh = integrateKwh(state.energyKwh, powerW, dt);
  const next: PlugState = { ...state, inUse: active, energyKwh, powerW };
  return {
    state: next,
    telemetry: { state: state.on, power_w: round(powerW, 1), energy_kwh: round(energyKwh, 4) },
  };
};

export function plugPowerW(state: PlugState): number {
  return state.on ? state.powerW : 0;
}
